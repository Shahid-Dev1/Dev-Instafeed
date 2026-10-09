import type { Deps } from '../../deps.js';
import type { TenantDb } from '../../lib/tenant-guard.js';
import { shopifyAdmin, type ShopifyAdmin } from '../shopify/admin.js';
import {
  PRODUCT_PAGE_SIZE,
  PRODUCT_QUERY,
  PRODUCT_VARIANTS_QUERY,
  PRODUCTS_QUERY,
  type PageInfo,
  type ProductNode,
  type ProductsPage,
  type VariantNode,
} from './shopify-products.js';

async function allVariants(admin: ShopifyAdmin, node: ProductNode): Promise<VariantNode[]> {
  const variants = [...node.variants.nodes];
  let page: PageInfo = node.variants.pageInfo;
  while (page.hasNextPage) {
    const data = await admin.query<{ product: { variants: { pageInfo: PageInfo; nodes: VariantNode[] } } | null }>(
      PRODUCT_VARIANTS_QUERY,
      { id: node.id, after: page.endCursor },
    );
    if (!data.product) break;
    variants.push(...data.product.variants.nodes);
    page = data.product.variants.pageInfo;
  }
  return variants;
}

/** Idempotently writes one product and its full variant set; variants no longer in Shopify are removed. */
export async function upsertProduct(db: TenantDb, storeId: string, node: ProductNode, variants: VariantNode[], syncedAt: Date) {
  const prices = variants.map((v) => Number(v.price)).filter(Number.isFinite);
  const data = {
    handle: node.handle,
    title: node.title,
    status: node.status,
    imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
    priceMin: prices.length ? Math.min(...prices).toFixed(2) : null,
    priceMax: prices.length ? Math.max(...prices).toFixed(2) : null,
    totalVariants: variants.length,
    shopifyUpdatedAt: new Date(node.updatedAt),
    syncedAt,
    deletedAt: null,
  };
  await db.$transaction(async (tx) => {
    const product = await tx.product.upsert({
      where: { storeId_shopifyId: { storeId, shopifyId: node.id } },
      create: { storeId, shopifyId: node.id, ...data },
      update: data,
    });
    for (const v of variants) {
      const vdata = {
        productId: product.id,
        title: v.title,
        sku: v.sku || null,
        price: v.price,
        availableForSale: v.availableForSale,
        options: v.selectedOptions,
        imageUrl: v.image?.url ?? null,
        position: v.position,
      };
      await tx.variant.upsert({
        where: { storeId_shopifyId: { storeId, shopifyId: v.id } },
        create: { storeId, shopifyId: v.id, ...vdata },
        update: vdata,
      });
    }
    await tx.variant.deleteMany({ where: { storeId, productId: product.id, shopifyId: { notIn: variants.map((v) => v.id) } } });
  });
}

export async function markProductDeleted(db: TenantDb, storeId: string, shopifyId: string): Promise<number> {
  const res = await db.product.updateMany({ where: { storeId, shopifyId, deletedAt: null }, data: { deletedAt: new Date() } });
  return res.count;
}

/**
 * Full catalog sync with reconciliation: every product Shopify returns is upserted with this run's
 * timestamp; products not seen (and not refreshed by a webhook meanwhile) are marked deleted.
 */
export async function runFullSync(deps: Deps, storeId: string, syncRunId: string): Promise<void> {
  const startedAt = new Date();
  await deps.db.syncRun.update({ where: { id: syncRunId, storeId }, data: { status: 'RUNNING', startedAt, error: null } });
  try {
    const admin = await shopifyAdmin(deps, storeId);
    let after: string | null = null;
    let upserted = 0;
    do {
      const page: ProductsPage = await admin.query<ProductsPage>(PRODUCTS_QUERY, { first: PRODUCT_PAGE_SIZE, after });
      for (const node of page.products.nodes) {
        await upsertProduct(deps.db, storeId, node, await allVariants(admin, node), startedAt);
        upserted++;
      }
      after = page.products.pageInfo.hasNextPage ? page.products.pageInfo.endCursor : null;
    } while (after);

    const removed = await deps.db.product.updateMany({
      where: { storeId, deletedAt: null, syncedAt: { lt: startedAt } },
      data: { deletedAt: new Date() },
    });
    await deps.db.syncRun.update({
      where: { id: syncRunId, storeId },
      data: { status: 'SUCCEEDED', upserted, deleted: removed.count, finishedAt: new Date() },
    });
  } catch (err) {
    await deps.db.syncRun.update({
      where: { id: syncRunId, storeId },
      data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error', finishedAt: new Date() },
    });
    throw err;
  }
}

/** Re-reads one product from Shopify (webhook-triggered), so stored data always reflects Shopify's latest state. */
export async function refreshProduct(deps: Deps, storeId: string, shopifyId: string): Promise<'upserted' | 'deleted'> {
  const admin = await shopifyAdmin(deps, storeId);
  const data = await admin.query<{ product: ProductNode | null }>(PRODUCT_QUERY, { id: shopifyId });
  if (!data.product) {
    await markProductDeleted(deps.db, storeId, shopifyId);
    return 'deleted';
  }
  await upsertProduct(deps.db, storeId, data.product, await allVariants(admin, data.product), new Date());
  return 'upserted';
}
