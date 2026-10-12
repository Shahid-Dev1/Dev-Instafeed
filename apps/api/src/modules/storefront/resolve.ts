import { matchesTargeting, targetingSchema, widgetConfigSchema, type PageContext, type WidgetPayload } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { entitlements, WIDGET_FEATURE } from '../billing/entitlements.js';
import { storefrontIntegrations } from '../integrations/service.js';
import { productGid } from '../products/shopify-products.js';
import { buildPayload } from '../widgets/service.js';

const PAGE_TYPES = new Set(['index', 'product', 'collection', 'page']);

export interface StorefrontQuery {
  ids?: string;
  embed?: '0' | '1';
  page_type: string;
  path: string;
  product_id?: string;
  collection?: string;
}

/**
 * Published widgets for one storefront page. Only published snapshots with playable videos are returned, limited
 * to widget types in the store's plan; nothing is served once the over-usage grace period has ended.
 */
export async function resolveStorefront(deps: Deps, storeId: string, q: StorefrontQuery) {
  const ent = await entitlements(deps, storeId);
  const [integrations, settings] = await Promise.all([
    storefrontIntegrations(deps, storeId),
    deps.db.storeSettings.findUnique({ where: { storeId }, select: { customCss: true } }),
  ]);
  const extras = {
    integrations: ent.features.includes('integrations') ? integrations : {},
    customCss: ent.features.includes('custom_css') ? (settings?.customCss ?? '') : '',
  };
  if (ent.paused) return { widgets: [], ...extras };

  const ids = (q.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const product = q.product_id
    ? await deps.db.product.findUnique({ where: { storeId_shopifyId: { storeId, shopifyId: productGid(q.product_id) } }, select: { id: true } })
    : null;
  const page: PageContext = {
    pageType: (PAGE_TYPES.has(q.page_type) ? q.page_type : 'other') as PageContext['pageType'],
    path: q.path,
    productId: product?.id ?? null,
    collectionHandle: q.collection ?? null,
  };
  const rows = await deps.db.widget.findMany({
    where: { storeId, status: 'PUBLISHED', OR: [{ id: { in: ids } }, ...(q.embed === '1' ? [{ type: 'FLOATING' as const }] : [])] },
    orderBy: { publishedAt: 'desc' },
  });
  const taggedVideoIds = product
    ? new Set((await deps.db.videoProduct.findMany({ where: { storeId, productId: product.id }, select: { videoId: true } })).map((t) => t.videoId))
    : new Set<string>();

  const widgets: { placement: 'block' | 'embed'; payload: WidgetPayload }[] = [];
  for (const w of rows) {
    if (!ent.features.includes(WIDGET_FEATURE[w.type]!)) continue; // e.g. after a downgrade
    const config = widgetConfigSchema.parse(w.publishedConfig);
    const placement = ids.includes(w.id) ? 'block' : 'embed';
    if (placement === 'embed') {
      const targeting = targetingSchema.parse(w.publishedTargeting);
      const productTagged = w.publishedVideoIds.some((id) => taggedVideoIds.has(id));
      if (!matchesTargeting(targeting, { ...page, productTagged })) continue;
    }
    const payload = await buildPayload(deps, storeId, { id: w.id, type: w.type, version: w.publishedVersion ?? w.version, config, videoIds: w.publishedVideoIds }, { productId: product?.id });
    if (payload.videos.length) widgets.push({ placement, payload });
  }
  return { widgets, ...extras };
}
