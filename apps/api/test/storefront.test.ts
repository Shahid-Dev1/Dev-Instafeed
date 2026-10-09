import { createHmac } from 'node:crypto';
import { defaultWidgetConfig } from '@instafeed/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { enqueueFullSync } from '../src/modules/products/jobs.js';
import { runFullSync } from '../src/modules/products/sync.js';
import { verifyProxySignature } from '../src/modules/storefront/proxy-signature.js';
import { TEST_SHOPIFY } from './env.js';
import { createTestContext, fakeProduct, installShop, resetData, sessionToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));

const SHOP = 'storefront.myshopify.com';
let storeId: string;
let videoIds: string[];
let productIds: string[];

/** Builds a query string signed the way Shopify's App Proxy signs it. */
function signed(params: Record<string, string>, secret = TEST_SHOPIFY.apiSecret) {
  const all = { shop: SHOP, path_prefix: '/apps/instafeed', timestamp: String(Math.floor(Date.now() / 1000)), ...params };
  const message = Object.entries(all).map(([k, v]) => `${k}=${v}`).sort().join('');
  const signature = createHmac('sha256', secret).update(message).digest('hex');
  return new URLSearchParams({ ...all, signature }).toString();
}
const get = (params: Record<string, string>, secret?: string) => t.app.inject({ method: 'GET', url: `/proxy/widgets?${signed(params, secret)}` });
const api = (method: 'POST' | 'PATCH', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${sessionToken(SHOP, '1')}` }, ...(payload ? { payload } : {}) });

async function widget(type: string, vids: string[], targeting?: object, publish = true) {
  const w = (await api('POST', '/api/v1/widgets', { name: type, type })).json().widget;
  await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, videoIds: vids, ...(targeting ? { targeting } : {}) });
  if (publish) await api('POST', `/api/v1/widgets/${w.id}/publish`);
  return w.id as string;
}

beforeEach(async () => {
  await resetData(t.deps);
  storeId = await installShop(t, SHOP);
  t.shopify.catalogs[SHOP] = [fakeProduct(11), fakeProduct(12)];
  const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
  await runFullSync(t.deps, storeId, run.id);
  productIds = (await t.deps.db.product.findMany({ where: { storeId }, orderBy: { handle: 'asc' } })).map((p) => p.id);
  videoIds = [];
  for (const i of [0, 1]) {
    const v = await t.deps.db.video.create({ data: { storeId, source: 'UPLOAD', externalId: `s${i}`, status: 'READY', title: `Clip ${i}`, playbackUrl: `https://vz.b-cdn.net/s${i}/playlist.m3u8` } });
    videoIds.push(v.id);
  }
  await t.deps.db.videoProduct.create({ data: { storeId, videoId: videoIds[0]!, productId: productIds[0]!, position: 0 } });
});

describe('App Proxy signature', () => {
  it('accepts Shopify-signed queries, including repeated keys, and rejects tampering', () => {
    const q = signed({ ids: 'a' });
    expect(verifyProxySignature(q, TEST_SHOPIFY.apiSecret)).toBe(true);
    expect(verifyProxySignature(q.replace('ids=a', 'ids=b'), TEST_SHOPIFY.apiSecret)).toBe(false);
    expect(verifyProxySignature(q.replace(/&?signature=[^&]+/, ''), TEST_SHOPIFY.apiSecret)).toBe(false);
    const msg = 'extra=1,2shop=x.myshopify.com';
    const sig = createHmac('sha256', 's').update(msg).digest('hex');
    expect(verifyProxySignature(`extra=1&extra=2&shop=x.myshopify.com&signature=${sig}`, 's')).toBe(true);
  });

  it('rejects unsigned and wrongly signed requests', async () => {
    expect((await t.app.inject({ method: 'GET', url: `/proxy/widgets?shop=${SHOP}` })).statusCode).toBe(401);
    expect((await get({}, 'not-the-secret')).statusCode).toBe(401);
  });
});

describe('published widgets for the storefront', () => {
  it('serves the published snapshot for block ids, never the draft', async () => {
    const id = await widget('CAROUSEL', [videoIds[0]!]);
    const cfg = { ...defaultWidgetConfig('CAROUSEL'), cta: { label: 'Draft only', action: 'POPUP' as const } };
    await api('PATCH', `/api/v1/widgets/${id}`, { version: 2, config: cfg, videoIds: [videoIds[1]] });
    const res = await get({ ids: id, page_type: 'index', path: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const [w] = res.json().widgets;
    expect(w.placement).toBe('block');
    expect(w.payload.config.cta.label).toBe('Shop now');
    expect(w.payload.videos.map((v: { id: string }) => v.id)).toEqual([videoIds[0]]);
    expect(JSON.stringify(res.json())).not.toMatch(/accessToken|refreshToken|shpat_|bunnyVideoId/);
  });

  it('omits drafts, unpublished widgets and widgets whose videos are no longer playable', async () => {
    const draft = await widget('CAROUSEL', [videoIds[0]!], undefined, false);
    const pub = await widget('GRID', [videoIds[1]!]);
    await api('POST', `/api/v1/widgets/${pub}/unpublish`);
    const third = await widget('BANNER', [videoIds[0]!]);
    await t.deps.db.video.update({ where: { id: videoIds[0]!, storeId }, data: { status: 'UNAVAILABLE' } });
    expect((await get({ ids: [draft, pub, third].join(',') })).json().widgets).toEqual([]);
  });

  it('applies targeting to app-embed (floating) widgets', async () => {
    const homeOnly = await widget('FLOATING', [videoIds[0]!], { rules: [{ type: 'home' }] });
    const tagged = await widget('FLOATING', [videoIds[0]!], { rules: [{ type: 'tagged_products' }] });
    await widget('CAROUSEL', [videoIds[0]!], { rules: [{ type: 'home' }] }); // not floating: never auto-injected
    const ids = (r: { json: () => { widgets: { payload: { id: string } }[] } }) => r.json().widgets.map((w) => w.payload.id);
    expect(ids(await get({ embed: '1', page_type: 'index', path: '/' }))).toEqual([homeOnly]);
    expect(ids(await get({ embed: '1', page_type: 'product', path: '/products/product-11', product_id: '11' }))).toEqual([tagged]);
    expect(ids(await get({ embed: '1', page_type: 'product', path: '/products/product-12', product_id: '12' }))).toEqual([]);
  });

  it('serves product galleries with videos tagged to the product being viewed', async () => {
    const gallery = await widget('PRODUCT_GALLERY', []);
    const res = await get({ ids: gallery, page_type: 'product', product_id: '11' });
    expect(res.json().widgets[0].payload.videos.map((v: { id: string }) => v.id)).toEqual([videoIds[0]]);
    expect((await get({ ids: gallery, page_type: 'product', product_id: '12' })).json().widgets).toEqual([]);
  });

  it('isolates stores: another shop cannot load these widgets by id', async () => {
    const id = await widget('CAROUSEL', [videoIds[0]!]);
    await installShop(t, 'other-sf.myshopify.com');
    expect((await get({ shop: 'other-sf.myshopify.com', ids: id })).json().widgets).toEqual([]);
    expect((await get({ shop: 'unknown.myshopify.com', ids: id })).json().widgets).toEqual([]);
  });

  it('serves nothing for uninstalled stores and validates parameters', async () => {
    const id = await widget('CAROUSEL', [videoIds[0]!]);
    expect((await get({ ids: id, product_id: 'abc' })).statusCode).toBe(400);
    await t.deps.rawDb.store.update({ where: { id: storeId }, data: { uninstalledAt: new Date() } });
    expect((await get({ ids: id })).json().widgets).toEqual([]);
  });
});
