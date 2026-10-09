import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { enqueueFullSync, processProductJob } from '../src/modules/products/jobs.js';
import { refreshProduct, runFullSync } from '../src/modules/products/sync.js';
import {
  createTestContext,
  fakeProduct,
  installShop,
  ORIGIN,
  registerUser,
  resetData,
  sessionToken,
  webhookHeaders,
  type TestContext,
} from './helpers.js';

let t: TestContext & { sleeps: number[] };
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));

const SHOP = 'catalog.myshopify.com';
let storeId: string;

beforeEach(async () => {
  await resetData(t.deps);
  t.shopify.catalogs = {};
  t.shopify.throttleNext = 0;
  t.shopify.calls = [];
  t.sleeps.length = 0;
  storeId = await installShop(t, SHOP);
});

async function sync() {
  const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
  await runFullSync(t.deps, storeId, run.id);
  return t.deps.db.syncRun.findUniqueOrThrow({ where: { id: run.id, storeId } });
}

const products = () => t.deps.db.product.findMany({ where: { storeId, deletedAt: null }, orderBy: { shopifyId: 'asc' } });
const auth = { authorization: `Bearer ${sessionToken(SHOP, '1')}` };

describe('full product sync', () => {
  it('enqueues an initial sync on install', async () => {
    const run = await t.deps.db.syncRun.findFirst({ where: { storeId } });
    expect(run).toMatchObject({ trigger: 'INSTALL', status: 'QUEUED' });
    expect(await t.deps.queues.products.getJob(`full-sync-${storeId}-${run!.id}`)).toBeTruthy();
  });

  it('paginates products (multiple pages) and stores Shopify gids', async () => {
    t.shopify.catalogs[SHOP] = Array.from({ length: 23 }, (_, i) => fakeProduct(i + 1));
    const run = await sync();
    expect(run).toMatchObject({ status: 'SUCCEEDED', upserted: 23, deleted: 0 });
    const rows = await products();
    expect(rows).toHaveLength(23);
    expect(rows[0]!.shopifyId).toMatch(/^gid:\/\/shopify\/Product\/\d+$/);
    const pages = t.shopify.calls.filter((c) => String(c.body.query ?? '').includes('query Products('));
    expect(pages).toHaveLength(3); // 10 + 10 + 3
  });

  it('fetches additional variant pages for products with many variants', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1, 180)];
    await sync();
    const [p] = await products();
    expect(p!.totalVariants).toBe(180);
    expect(await t.deps.db.variant.count({ where: { storeId, productId: p!.id } })).toBe(180);
    expect(p!.priceMin?.toFixed(2)).toBe('10.00');
    expect(p!.priceMax?.toFixed(2)).toBe('189.00');
  });

  it('is idempotent: re-syncing does not duplicate products or variants', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1), fakeProduct(2)];
    await sync();
    await sync();
    expect(await t.deps.db.product.count({ where: { storeId } })).toBe(2);
    expect(await t.deps.db.variant.count({ where: { storeId } })).toBe(4);
  });

  it('reconciles products deleted in Shopify and restores ones that return', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1), fakeProduct(2), fakeProduct(3)];
    await sync();
    t.shopify.catalogs[SHOP] = [fakeProduct(1), fakeProduct(3)];
    const run = await sync();
    expect(run.deleted).toBe(1);
    expect((await products()).map((p) => p.handle)).toEqual(['product-1', 'product-3']);
    t.shopify.catalogs[SHOP] = [fakeProduct(1), fakeProduct(2), fakeProduct(3)];
    await sync();
    expect(await products()).toHaveLength(3);
  });

  it('applies variant changes: price updates, removals and additions', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1, 3)];
    await sync();
    const changed = fakeProduct(1, 3);
    changed.variants = [{ ...changed.variants[0]!, price: '99.50' }, changed.variants[2]!, { ...changed.variants[1]!, id: 'gid://shopify/ProductVariant/77' }];
    t.shopify.catalogs[SHOP] = [changed];
    await sync();
    const variants = await t.deps.db.variant.findMany({ where: { storeId }, orderBy: { shopifyId: 'asc' } });
    expect(variants.map((v) => v.shopifyId).sort()).toEqual(
      ['gid://shopify/ProductVariant/1000', 'gid://shopify/ProductVariant/1002', 'gid://shopify/ProductVariant/77'].sort(),
    );
    expect(variants.find((v) => v.shopifyId.endsWith('/1000'))!.price.toFixed(2)).toBe('99.50');
  });

  it('waits out GraphQL cost throttling and then succeeds', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1)];
    t.shopify.throttleNext = 2;
    const run = await sync();
    expect(run.status).toBe('SUCCEEDED');
    // (520 - 20) / 100 points per second = 5s, scaled by attempt number.
    expect(t.sleeps).toEqual([5000, 10000]);
  });

  it('marks the run failed when Shopify keeps throttling', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1)];
    t.shopify.throttleNext = 100;
    const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
    await expect(runFullSync(t.deps, storeId, run.id)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const after = await t.deps.db.syncRun.findUniqueOrThrow({ where: { id: run.id, storeId } });
    expect(after.status).toBe('FAILED');
    expect(after.error).toMatch(/cost limit/);
  });

  it('allows only one active sync per store and expires stuck runs', async () => {
    const a = await enqueueFullSync(t.deps, storeId, 'MANUAL');
    const b = await enqueueFullSync(t.deps, storeId, 'MANUAL');
    expect(b.id).toBe(a.id);
    await t.deps.db.syncRun.update({ where: { id: a.id, storeId }, data: { createdAt: new Date(Date.now() - 3 * 3600_000) } });
    const c = await enqueueFullSync(t.deps, storeId, 'MANUAL');
    expect(c.id).not.toBe(a.id);
  });

  it('runs a queued full-sync job through the job processor', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(5)];
    const run = await t.deps.db.syncRun.findFirstOrThrow({ where: { storeId } });
    await processProductJob(t.deps, { name: 'full-sync', data: { storeId, syncRunId: run.id } });
    expect(await products()).toHaveLength(1);
  });
});

describe('webhook-driven updates', () => {
  const send = (topic: string, payload: object, id?: string) => {
    const body = JSON.stringify(payload);
    return t.app.inject({ method: 'POST', url: '/webhooks/shopify', headers: webhookHeaders(topic, SHOP, body, id), payload: body });
  };

  it('products/update enqueues a refresh that re-reads the product from GraphQL', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1)];
    await sync();
    t.shopify.catalogs[SHOP] = [fakeProduct(1, 2, { title: 'Renamed', updatedAt: '2026-10-05T00:00:00Z' })];
    const res = await send('products/update', { id: 1, admin_graphql_api_id: 'gid://shopify/Product/1', updated_at: '2026-10-05T00:00:00Z' });
    expect(res.statusCode).toBe(200);
    const jobs = await t.deps.queues.products.getJobs(['waiting']);
    const job = jobs.find((j) => j.name === 'refresh')!;
    expect(job.data).toEqual({ storeId, shopifyId: 'gid://shopify/Product/1' });
    await processProductJob(t.deps, job);
    expect((await products())[0]!.title).toBe('Renamed');
  });

  it('a stale or out-of-order update still converges on Shopify’s current state', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1, 2, { title: 'Latest' })];
    await refreshProduct(t.deps, storeId, 'gid://shopify/Product/1');
    // An older webhook processed later re-reads the product and gets the same latest data.
    await refreshProduct(t.deps, storeId, 'gid://shopify/Product/1');
    expect((await products())[0]!.title).toBe('Latest');
  });

  it('products/delete marks the product deleted; refresh of a missing product does too', async () => {
    t.shopify.catalogs[SHOP] = [fakeProduct(1), fakeProduct(2)];
    await sync();
    expect((await send('products/delete', { id: 1 })).statusCode).toBe(200);
    expect((await products()).map((p) => p.handle)).toEqual(['product-2']);
    t.shopify.catalogs[SHOP] = [];
    expect(await refreshProduct(t.deps, storeId, 'gid://shopify/Product/2')).toBe('deleted');
    expect(await products()).toHaveLength(0);
  });

  it('ignores product webhooks for uninstalled stores', async () => {
    await t.deps.rawDb.store.update({ where: { id: storeId }, data: { uninstalledAt: new Date() } });
    await send('products/update', { id: 9, admin_graphql_api_id: 'gid://shopify/Product/9', updated_at: '2026-10-05T00:00:00Z' });
    expect((await t.deps.queues.products.getJobs(['waiting'])).filter((j) => j.name === 'refresh')).toHaveLength(0);
  });

  it('reconcile-all enqueues a sync for each installed store', async () => {
    const other = await installShop(t, 'other.myshopify.com');
    await t.deps.db.syncRun.updateMany({ where: { storeId }, data: { status: 'SUCCEEDED' } });
    await t.deps.db.syncRun.updateMany({ where: { storeId: other }, data: { status: 'SUCCEEDED' } });
    expect(await processProductJob(t.deps, { name: 'reconcile-all', data: {} })).toBe(2);
    expect(await t.deps.db.syncRun.count({ where: { storeId, trigger: 'SCHEDULED' } })).toBe(1);
  });
});

describe('product API', () => {
  beforeEach(async () => {
    t.shopify.catalogs[SHOP] = [
      fakeProduct(1, 2, { title: 'Vitamin C Serum' }),
      fakeProduct(2, 2, { title: 'Coffee Body Scrub', status: 'DRAFT' }),
      ...Array.from({ length: 30 }, (_, i) => fakeProduct(100 + i)),
    ];
    await sync();
  });

  it('searches by title and SKU and filters by status', async () => {
    const q = (qs: string) => t.app.inject({ method: 'GET', url: `/api/v1/products?${qs}`, headers: auth }).then((r) => r.json());
    expect((await q('q=serum')).items.map((p: { title: string }) => p.title)).toEqual(['Vitamin C Serum']);
    expect((await q('q=sku-2-1')).items.map((p: { title: string }) => p.title)).toEqual(['Coffee Body Scrub']);
    expect((await q('status=DRAFT')).items).toHaveLength(1);
  });

  it('paginates with a cursor without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await t.app.inject({ method: 'GET', url: `/api/v1/products?limit=7${cursor ? `&cursor=${cursor}` : ''}`, headers: auth });
      const body = res.json() as { items: { id: string }[]; nextCursor: string | null };
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(32);
    expect(new Set(seen).size).toBe(32);
  });

  it('returns product detail with variants', async () => {
    const list = await t.app.inject({ method: 'GET', url: '/api/v1/products?q=serum', headers: auth });
    const id = list.json().items[0].id;
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/products/${id}`, headers: auth });
    expect(res.json()).toMatchObject({ title: 'Vitamin C Serum', variants: [{ sku: 'SKU-1-0', price: '10.00', availableForSale: true }, { sku: 'SKU-1-1' }] });
  });

  it('validates query parameters', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/products?limit=1000', headers: auth })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/products?status=BOGUS', headers: auth })).statusCode).toBe(400);
  });

  it('isolates stores: another store sees none of these products', async () => {
    await installShop(t, 'other.myshopify.com');
    const otherAuth = { authorization: `Bearer ${sessionToken('other.myshopify.com', '1')}` };
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/products', headers: otherAuth })).json().items).toHaveLength(0);
    const id = (await products())[0]!.id;
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/products/${id}`, headers: otherAuth })).statusCode).toBe(404);
  });

  it('analysts can read but only editors+ can start a sync', async () => {
    const cookie = await registerUser(t.app, 'analyst@shop.co');
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'analyst@shop.co' } });
    await t.deps.db.membership.create({ data: { storeId, userId: user.id, role: 'ANALYST' } });
    const h = { cookie, origin: ORIGIN, 'x-store-id': storeId };
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/products', headers: h })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/products/sync', headers: h })).statusCode).toBe(403);
    const ok = await t.app.inject({ method: 'POST', url: '/api/v1/products/sync', headers: auth });
    expect(ok.statusCode).toBe(202);
    const status = await t.app.inject({ method: 'GET', url: '/api/v1/products/sync/status', headers: auth });
    expect(status.json().syncRun).toMatchObject({ status: 'QUEUED', trigger: 'MANUAL' });
  });
});
