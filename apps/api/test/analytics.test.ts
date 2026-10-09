import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { processAnalyticsJob } from '../src/modules/analytics/jobs.js';
import { ingestEvents } from '../src/modules/analytics/ingest.js';
import { attributeOrder } from '../src/modules/analytics/orders.js';
import { toCsv } from '../src/modules/analytics/reports.js';
import { ensureWebPixel } from '../src/modules/analytics/pixel.js';
import { toMinor } from '../src/modules/analytics/time.js';
import { enqueueFullSync } from '../src/modules/products/jobs.js';
import { runFullSync } from '../src/modules/products/sync.js';
import { TEST_SHOPIFY } from './env.js';
import { createTestContext, fakeProduct, installShop, ORIGIN, registerUser, resetData, sessionToken, webhookHeaders } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));

const SHOP = 'analytics.myshopify.com';
let storeId: string;
let widgetId: string;
let videoId: string;
let p1: string; // product 1 (gid .../Product/1)
let p2: string;

const NOW = Date.now();
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  v: 1, eventId: randomUUID(), type, visitorId: 'visitor-a', widgetId, videoId, occurredAt: NOW - 60_000, ...extra,
});
const api = (url: string, shop = SHOP) => t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${sessionToken(shop, '1')}` } });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(NOW - 60_000));
const range = `from=${today}&to=${today}`;

function orderPayload(id: number, opts: { visitor?: string; createdAt?: string; lines?: { product: number; price: string; qty?: number; discount?: string }[]; total?: string; currency?: string; test?: boolean } = {}) {
  const currency = opts.currency ?? 'INR';
  return {
    id,
    name: `#${id}`,
    created_at: opts.createdAt ?? new Date(NOW).toISOString(),
    currency,
    total_price: opts.total ?? '1000.00',
    total_price_set: { shop_money: { amount: opts.total ?? '1000.00', currency_code: currency } },
    test: opts.test ?? false,
    note_attributes: opts.visitor ? [{ name: '_ifv', value: opts.visitor }] : [],
    line_items: (opts.lines ?? [{ product: 1, price: '499.00' }]).map((l) => ({
      product_id: l.product, variant_id: l.product * 1000, quantity: l.qty ?? 1, price: l.price,
      price_set: { shop_money: { amount: l.price, currency_code: currency } },
      discount_allocations: l.discount ? [{ amount: l.discount, amount_set: { shop_money: { amount: l.discount, currency_code: currency } } }] : [],
    })),
  };
}
async function sendOrder(payload: object, topic = 'orders/create', webhookId?: string) {
  const body = JSON.stringify(payload);
  return t.app.inject({ method: 'POST', url: '/webhooks/shopify', headers: webhookHeaders(topic, SHOP, body, webhookId), payload: body });
}
async function attributeAll() {
  for (const job of await t.deps.queues.analytics.getJobs(['delayed', 'waiting'])) if (job.name === 'attribute-order') await processAnalyticsJob(t.deps, job);
}

beforeEach(async () => {
  await resetData(t.deps);
  storeId = await installShop(t, SHOP); // FakeShopify reports Asia/Kolkata and INR
  t.shopify.catalogs[SHOP] = [fakeProduct(1), fakeProduct(2)];
  const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
  await runFullSync(t.deps, storeId, run.id);
  [p1, p2] = (await t.deps.db.product.findMany({ where: { storeId }, orderBy: { handle: 'asc' } })).map((p) => p.id) as [string, string];
  videoId = (await t.deps.db.video.create({ data: { storeId, source: 'UPLOAD', externalId: 'a1', status: 'READY', title: 'Serum demo' } })).id;
  widgetId = (await t.deps.db.widget.create({ data: { storeId, name: 'Home carousel', type: 'CAROUSEL', config: {}, targeting: {} } })).id;
});

describe('event ingestion', () => {
  it('deduplicates by eventId so retries never double count', async () => {
    const batch = [ev('widget_impression'), ev('video_open'), ev('product_click', { productId: p1 })];
    const first = await ingestEvents(t.deps, storeId, batch, new Date(NOW));
    const retry = await ingestEvents(t.deps, storeId, [...batch, ev('video_open')], new Date(NOW));
    expect(first).toMatchObject({ inserted: 3, duplicates: 0 });
    expect(retry).toMatchObject({ inserted: 1, duplicates: 3 });
    const s = (await api(`/api/v1/analytics/summary?${range}`)).json();
    expect(s.metrics).toMatchObject({ widgetImpressions: 1, videoOpens: 2, productClicks: 1 });
  });

  it('rejects invalid or wrong-version events and drops references to other stores', async () => {
    await installShop(t, 'other-an.myshopify.com');
    const otherStore = (await t.deps.rawDb.store.findUniqueOrThrow({ where: { shopDomain: 'other-an.myshopify.com' } })).id;
    const foreignVideo = await t.deps.db.video.create({ data: { storeId: otherStore, source: 'UPLOAD', externalId: 'x', status: 'READY', title: 'x' } });
    const res = await ingestEvents(t.deps, storeId, [
      ev('video_open', { v: 2 }), ev('bogus'), { nope: 1 }, ev('video_open', { injected: '<script>' }),
      ev('video_open', { videoId: foreignVideo.id }),
    ], new Date(NOW));
    expect(res).toMatchObject({ received: 5, invalid: 4, inserted: 1 });
    expect((await t.deps.db.analyticsEvent.findFirstOrThrow({ where: { storeId } })).videoId).toBeNull();
  });

  it('buckets by store-local day and clamps untrusted clocks', async () => {
    // 20:00 UTC on Oct 1 is 01:30 on Oct 2 in Asia/Kolkata.
    const received = new Date('2026-10-01T20:00:00Z');
    await ingestEvents(t.deps, storeId, [
      ev('video_open', { occurredAt: received.getTime() }),
      ev('video_open', { occurredAt: received.getTime() + 86_400_000 * 30 }), // far future → received time
    ], received);
    const rows = await t.deps.db.dailyStat.findMany({ where: { storeId } });
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(['2026-10-02']);
    expect(rows[0]!.videoOpens).toBe(2);
  });

  it('accepts signed App Proxy batches (JSON or sendBeacon text/plain) and enqueues them', async () => {
    const sign = (params: Record<string, string>) => {
      const all = { shop: SHOP, timestamp: '1', ...params };
      const msg = Object.entries(all).map(([k, v]) => `${k}=${v}`).sort().join('');
      return new URLSearchParams({ ...all, signature: createHmac('sha256', TEST_SHOPIFY.apiSecret).update(msg).digest('hex') });
    };
    const body = JSON.stringify({ events: [ev('video_open')] });
    const res = await t.app.inject({ method: 'POST', url: `/proxy/events?${sign({})}`, headers: { 'content-type': 'text/plain' }, payload: body });
    expect(res.statusCode).toBe(202);
    expect((await t.app.inject({ method: 'POST', url: `/proxy/events?shop=${SHOP}&signature=bad`, headers: { 'content-type': 'application/json' }, payload: body })).statusCode).toBe(401);
    const tooMany = JSON.stringify({ events: Array.from({ length: 51 }, () => ev('video_open')) });
    expect((await t.app.inject({ method: 'POST', url: `/proxy/events?${sign({})}`, headers: { 'content-type': 'application/json' }, payload: tooMany })).statusCode).toBe(400);
    const job = (await t.deps.queues.analytics.getJobs(['waiting'])).find((j) => j.name === 'ingest')!;
    expect(await processAnalyticsJob(t.deps, job)).toMatchObject({ inserted: 1 });
  });

  it('pixel checkout events are only accepted for visitors already seen in the store', async () => {
    const send = (visitorId: string) =>
      t.app.inject({ method: 'POST', url: '/pixel/events', headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ shop: SHOP, events: [ev('checkout_start', { visitorId, widgetId: undefined, videoId: undefined })] }) });
    const ingestJobs = async () => (await t.deps.queues.analytics.getJobs(['waiting'])).filter((j) => j.name === 'ingest');
    await send('stranger');
    expect(await ingestJobs()).toHaveLength(0);
    await ingestEvents(t.deps, storeId, [ev('video_open')], new Date(NOW));
    await send('visitor-a');
    expect(await ingestJobs()).toHaveLength(1);
  });
});

describe('order attribution', () => {
  it('records each order once, even for duplicate and repeated deliveries', async () => {
    await sendOrder(orderPayload(5001), 'orders/create', 'hook-1');
    await sendOrder(orderPayload(5001), 'orders/create', 'hook-1');
    await sendOrder(orderPayload(5001), 'orders/create', 'hook-2');
    expect(await t.deps.db.order.count({ where: { storeId } })).toBe(1);
  });

  it('DIRECT: a widget add-to-cart of an ordered product; revenue = matching lines after discounts', async () => {
    await ingestEvents(t.deps, storeId, [ev('video_open'), ev('add_to_cart', { productId: p1, value: 49900, currency: 'INR', quantity: 2 })], new Date(NOW));
    await sendOrder(orderPayload(5002, { visitor: 'visitor-a', total: '1297.00', lines: [{ product: 1, price: '499.00', qty: 2, discount: '100.00' }, { product: 2, price: '399.00' }] }));
    await attributeAll();
    const o = await t.deps.db.order.findFirstOrThrow({ where: { storeId } });
    expect(o).toMatchObject({ attribution: 'DIRECT', attributedMinor: 89800n, attributedWidgetId: widgetId, attributedVideoId: videoId, totalMinor: 129700n });
    const s = (await api(`/api/v1/analytics/summary?${range}`)).json();
    expect(s.orders).toEqual({ storeOrders: 1, storeRevenue: 129700, directOrders: 1, directRevenue: 89800, assistedOrders: 0, assistedRevenue: 0 });
    expect(s.metrics.addToCartValue).toBe(49900);
    const products = (await api(`/api/v1/analytics/products?${range}`)).json().rows;
    expect(products.find((r: { id: string }) => r.id === p1)).toMatchObject({ directRevenue: 89800, addToCarts: 1 });
    expect((await api(`/api/v1/analytics/videos?${range}`)).json().rows[0]).toMatchObject({ id: videoId, title: 'Serum demo', directRevenue: 89800 });
  });

  it('ASSISTED: engagement without adding an ordered product; NONE without a visitor id', async () => {
    await ingestEvents(t.deps, storeId, [ev('video_open'), ev('add_to_cart', { productId: p2 })], new Date(NOW));
    await sendOrder(orderPayload(5003, { visitor: 'visitor-a' }));
    await sendOrder(orderPayload(5004));
    await attributeAll();
    const byId = Object.fromEntries((await t.deps.db.order.findMany({ where: { storeId } })).map((o) => [o.shopifyOrderId, o.attribution]));
    expect(byId).toEqual({ '5003': 'ASSISTED', '5004': 'NONE' });
  });

  it('respects the configurable attribution window, with a small grace for late events', async () => {
    const created = new Date(NOW);
    await ingestEvents(t.deps, storeId, [ev('add_to_cart', { productId: p1, occurredAt: NOW - 3 * 86_400_000 })], new Date(NOW));
    await sendOrder(orderPayload(5005, { visitor: 'visitor-a', createdAt: created.toISOString() }));
    const order = await t.deps.db.order.findFirstOrThrow({ where: { storeId } });
    expect((await attributeOrder(t.deps, storeId, order.id))!.attribution).toBe('DIRECT');
    const admin = { authorization: `Bearer ${sessionToken(SHOP, '1')}` };
    const patched = await t.app.inject({ method: 'PATCH', url: '/api/v1/settings/attribution', headers: admin, payload: { attributionWindowDays: 2 } });
    expect(patched.statusCode).toBe(200);
    expect((await attributeOrder(t.deps, storeId, order.id))!.attribution).toBe('NONE');
    // An event arriving a few minutes after order creation (queue lag) still counts.
    await ingestEvents(t.deps, storeId, [ev('add_to_cart', { productId: p1, occurredAt: NOW + 5 * 60_000 })], new Date(NOW + 5 * 60_000));
    expect((await attributeOrder(t.deps, storeId, order.id))!.attribution).toBe('DIRECT');
    expect((await t.app.inject({ method: 'PATCH', url: '/api/v1/settings/attribution', headers: admin, payload: { attributionWindowDays: 90 } })).statusCode).toBe(400);
  });

  it('excludes cancelled and test orders from reports and converts currency exponents', async () => {
    await sendOrder(orderPayload(5006));
    await sendOrder(orderPayload(5007, { test: true }));
    await sendOrder({ id: 5006, cancelled_at: new Date(NOW).toISOString() }, 'orders/cancelled');
    expect((await api(`/api/v1/analytics/summary?${range}`)).json().orders.storeOrders).toBe(0);
    expect(toMinor('1500', 'JPY')).toBe(1500n);
    expect(toMinor('12.345', 'KWD')).toBe(12345n);
    expect(toMinor('19.99', 'USD')).toBe(1999n);
  });
});

describe('reports', () => {
  it('fills every day in the range and validates the range', async () => {
    await ingestEvents(t.deps, storeId, [ev('video_open')], new Date(NOW));
    const days = (await api(`/api/v1/analytics/timeseries?from=2026-01-01&to=2026-01-03`)).json().days;
    expect(days.map((d: { date: string }) => d.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect((await api('/api/v1/analytics/summary?from=2026-02-01&to=2026-01-01')).statusCode).toBe(400);
    expect((await api('/api/v1/analytics/summary?from=2024-01-01&to=2026-01-01')).statusCode).toBe(400);
    expect((await api('/api/v1/analytics/summary?from=yesterday&to=today')).statusCode).toBe(400);
  });

  it('computes rates and filters by widget', async () => {
    await ingestEvents(t.deps, storeId, [
      ev('widget_impression'), ev('widget_impression'), ev('widget_impression'), ev('widget_impression'),
      ev('video_open'), ev('video_open'), ev('product_click', { productId: p1 }), ev('add_to_cart', { productId: p1 }),
      ev('video_open', { widgetId: undefined }),
    ], new Date(NOW));
    const s = (await api(`/api/v1/analytics/summary?${range}&widgetId=${widgetId}`)).json();
    expect(s.metrics.videoOpens).toBe(2);
    expect(s.rates).toEqual({ engagementRate: 0.5, ctr: 0.5, addToCartRate: 1, conversionRate: 0 });
    expect((await api(`/api/v1/analytics/widgets?${range}`)).json().rows[0]).toMatchObject({ id: widgetId, title: 'Home carousel', widgetImpressions: 4 });
  });

  it('exports CSV safely', async () => {
    expect(toCsv([{ title: '=HYPERLINK("http://evil")', n: 1 }, { title: 'a,"b"', n: 2 }])).toBe(
      'title,n\r\n"\'=HYPERLINK(""http://evil"")",1\r\n"a,""b""",2\r\n',
    );
    await ingestEvents(t.deps, storeId, [ev('video_open')], new Date(NOW));
    const res = await api(`/api/v1/analytics/export.csv?${range}&report=videos`);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/instafeed-videos/);
    expect(res.body.split('\r\n')[0]).toMatch(/^id,title,widgetImpressions/);
    expect((await api(`/api/v1/analytics/export.csv?${range}&report=secrets`)).statusCode).toBe(400);
  });

  it('isolates stores and enforces roles', async () => {
    await ingestEvents(t.deps, storeId, [ev('video_open')], new Date(NOW));
    await installShop(t, 'other-an2.myshopify.com');
    expect((await api(`/api/v1/analytics/summary?${range}`, 'other-an2.myshopify.com')).json().metrics.videoOpens).toBe(0);
    const cookie = await registerUser(t.app, 'analyst@an.co');
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'analyst@an.co' } });
    await t.deps.db.membership.create({ data: { storeId, userId: user.id, role: 'ANALYST' } });
    const h = { cookie, origin: ORIGIN, 'x-store-id': storeId };
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/analytics/summary?${range}`, headers: h })).json().metrics.videoOpens).toBe(1);
    expect((await t.app.inject({ method: 'PATCH', url: '/api/v1/settings/attribution', headers: h, payload: { attributionWindowDays: 3 } })).statusCode).toBe(403);
  });
});

describe('checkout web pixel activation', () => {
  it('is queued on install, creates the pixel once and re-points it when the app URL changes', async () => {
    expect((await t.deps.queues.analytics.getJobs(['waiting'])).some((j) => j.name === 'ensure-pixel')).toBe(true);
    t.shopify.pixels = {};
    expect(await ensureWebPixel(t.deps, storeId)).toBe('created');
    expect(JSON.parse(t.shopify.pixels[SHOP]!)).toEqual({ endpoint: 'https://app.test/pixel/events', shop: SHOP });
    expect(await ensureWebPixel(t.deps, storeId)).toBe('unchanged');
    t.shopify.pixels[SHOP] = JSON.stringify({ endpoint: 'https://old-tunnel.example/pixel/events', shop: SHOP });
    expect(await ensureWebPixel(t.deps, storeId)).toBe('updated');
  });
});
