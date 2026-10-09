import { defaultWidgetConfig } from '@instafeed/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { enqueueFullSync } from '../src/modules/products/jobs.js';
import { runFullSync } from '../src/modules/products/sync.js';
import { appEmbedState } from '../src/modules/widgets/onboarding.js';
import { createTestContext, fakeProduct, installShop, ORIGIN, registerUser, resetData, sessionToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));

const SHOP = 'widgets.myshopify.com';
const OTHER = 'other-widgets.myshopify.com';
let storeId: string;
let videoIds: string[];
let productIds: string[];

const api = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, shop = SHOP) =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${sessionToken(shop, '1')}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function createWidget(type = 'CAROUSEL', name = 'Homepage carousel') {
  return (await api('POST', '/api/v1/widgets', { name, type })).json().widget;
}

beforeEach(async () => {
  await resetData(t.deps);
  t.providers.reset();
  storeId = await installShop(t, SHOP);
  t.shopify.catalogs[SHOP] = [fakeProduct(1, 2), fakeProduct(2, 1)];
  const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
  await runFullSync(t.deps, storeId, run.id);
  productIds = (await t.deps.db.product.findMany({ where: { storeId }, orderBy: { handle: 'asc' } })).map((p) => p.id);
  videoIds = [];
  for (const [i, status] of (['READY', 'READY', 'PROCESSING'] as const).entries()) {
    const v = await t.deps.db.video.create({
      data: { storeId, source: 'UPLOAD', externalId: `g${i}`, bunnyVideoId: `g${i}`, status, title: `Video ${i}`, thumbnailUrl: `https://vz.b-cdn.net/g${i}/thumbnail.jpg`, playbackUrl: `https://vz.b-cdn.net/g${i}/playlist.m3u8` },
    });
    videoIds.push(v.id);
  }
  await t.deps.db.videoProduct.create({ data: { storeId, videoId: videoIds[0]!, productId: productIds[0]!, position: 0 } });
});

describe('widget CRUD and validation', () => {
  it('creates each type with valid defaults and default targeting', async () => {
    const w = await createWidget('PRODUCT_GALLERY', 'PDP gallery');
    expect(w).toMatchObject({ type: 'PRODUCT_GALLERY', status: 'DRAFT', version: 1, config: { source: 'product_tagged' }, targeting: { rules: [{ type: 'tagged_products' }] } });
    expect((await api('POST', '/api/v1/widgets', { name: '', type: 'CAROUSEL' })).statusCode).toBe(400);
    expect((await api('POST', '/api/v1/widgets', { name: 'x', type: 'POPUP' })).statusCode).toBe(400);
  });

  it('saves config, targeting and ordered videos with optimistic concurrency', async () => {
    const w = await createWidget();
    const config = { ...defaultWidgetConfig('CAROUSEL'), cta: { label: 'Buy now', action: 'PDP' as const } };
    const res = await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, config, targeting: { rules: [{ type: 'all_products' }] }, videoIds: [videoIds[1], videoIds[0]] });
    expect(res.statusCode).toBe(200);
    expect(res.json().widget).toMatchObject({ version: 2, config: { cta: { label: 'Buy now' } }, videoIds: [videoIds[1], videoIds[0]] });
    const stale = await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, name: 'Overwrite' });
    expect(stale.statusCode).toBe(409);
    expect((await api('GET', `/api/v1/widgets/${w.id}`)).json().widget.name).toBe('Homepage carousel');
  });

  it('rejects invalid config, unknown keys and foreign videos', async () => {
    const w = await createWidget();
    const bad = { ...defaultWidgetConfig('CAROUSEL'), style: { ...defaultWidgetConfig('CAROUSEL').style, accentColor: 'javascript:alert(1)' } };
    expect((await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, config: bad })).statusCode).toBe(400);
    expect((await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, customJs: 'x' })).statusCode).toBe(400);
    expect((await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, videoIds: [videoIds[0], videoIds[0]] })).statusCode).toBe(400);
    await installShop(t, OTHER);
    const otherStore = (await t.deps.rawDb.store.findUniqueOrThrow({ where: { shopDomain: OTHER } })).id;
    const foreign = await t.deps.db.video.create({ data: { storeId: otherStore, source: 'UPLOAD', externalId: 'x', status: 'READY', title: 'theirs' } });
    expect((await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, videoIds: [foreign.id] })).statusCode).toBe(400);
  });
});

describe('publishing', () => {
  it('requires a ready video, snapshots the draft and tracks unpublished changes', async () => {
    const w = await createWidget();
    expect((await api('POST', `/api/v1/widgets/${w.id}/publish`)).statusCode).toBe(400);
    await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, videoIds: [videoIds[2]] });
    expect((await api('POST', `/api/v1/widgets/${w.id}/publish`)).statusCode).toBe(400); // only a processing video
    await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 2, videoIds: [videoIds[0]] });
    const pub = (await api('POST', `/api/v1/widgets/${w.id}/publish`)).json().widget;
    expect(pub).toMatchObject({ status: 'PUBLISHED', hasUnpublishedChanges: false });

    await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 3, name: 'Renamed only' });
    expect((await api('GET', `/api/v1/widgets/${w.id}`)).json().widget.hasUnpublishedChanges).toBe(false);
    const cfg = { ...defaultWidgetConfig('CAROUSEL'), cta: { label: 'Draft label', action: 'POPUP' as const } };
    const edited = (await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 4, config: cfg })).json().widget;
    expect(edited.hasUnpublishedChanges).toBe(true);
    const row = await t.deps.db.widget.findFirstOrThrow({ where: { storeId, id: w.id } });
    expect((row.publishedConfig as { cta: { label: string } }).cta.label).toBe('Shop now');
    expect(row.publishedVideoIds).toEqual([videoIds[0]]);

    expect((await api('POST', `/api/v1/widgets/${w.id}/unpublish`)).json().widget.status).toBe('DRAFT');
  });

  it('product-tagged galleries publish without a manual video list', async () => {
    const w = await createWidget('PRODUCT_GALLERY');
    expect((await api('POST', `/api/v1/widgets/${w.id}/publish`)).statusCode).toBe(200);
  });
});

describe('preview payload', () => {
  it('includes only ready, non-archived videos with live products, in widget order, capped by maxProducts', async () => {
    await t.deps.db.videoProduct.create({ data: { storeId, videoId: videoIds[0]!, productId: productIds[1]!, position: 1 } });
    const w = await createWidget();
    const cfg = defaultWidgetConfig('CAROUSEL');
    cfg.product.maxProducts = 1;
    await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, config: cfg, videoIds: [videoIds[1], videoIds[2], videoIds[0]] });
    const { payload } = (await api('GET', `/api/v1/widgets/${w.id}/preview`)).json();
    expect(payload.videos.map((v: { id: string }) => v.id)).toEqual([videoIds[1], videoIds[0]]);
    expect(payload.videos[1].products).toHaveLength(1);
    expect(payload.videos[1].products[0]).toMatchObject({ shopifyId: 'gid://shopify/Product/1', price: '10.00' });
    expect(payload.currency).toBe('INR');

    await t.deps.db.video.update({ where: { id: videoIds[1]!, storeId }, data: { archivedAt: new Date() } });
    await t.deps.db.product.update({ where: { id: productIds[0]!, storeId }, data: { deletedAt: new Date() } });
    const after = (await api('GET', `/api/v1/widgets/${w.id}/preview`)).json().payload;
    expect(after.videos.map((v: { id: string }) => v.id)).toEqual([videoIds[0]]);
    // The deleted product is skipped; the next live tag fills the slot.
    expect(after.videos[0].products.map((p: { shopifyId: string }) => p.shopifyId)).toEqual(['gid://shopify/Product/2']);
  });

  it('product galleries use the videos tagged with the given product', async () => {
    const w = await createWidget('PRODUCT_GALLERY');
    const p = (await api('GET', `/api/v1/widgets/${w.id}/preview?productId=${productIds[0]}`)).json().payload;
    expect(p.videos.map((v: { id: string }) => v.id)).toEqual([videoIds[0]]);
    expect((await api('GET', `/api/v1/widgets/${w.id}/preview`)).json().payload.videos).toEqual([]);
  });
});

describe('isolation and roles', () => {
  it('other stores cannot see or change widgets', async () => {
    const w = await createWidget();
    await installShop(t, OTHER);
    expect((await api('GET', '/api/v1/widgets', undefined, OTHER)).json().items).toEqual([]);
    for (const [m, path] of [['GET', ''], ['PATCH', ''], ['DELETE', ''], ['POST', '/publish'], ['GET', '/preview']] as const) {
      const res = await api(m, `/api/v1/widgets/${w.id}${path}`, m === 'PATCH' ? { version: 1, name: 'x' } : undefined, OTHER);
      expect(res.statusCode, `${m} ${path}`).toBe(404);
    }
  });

  it('analysts can view but not edit', async () => {
    const w = await createWidget();
    const cookie = await registerUser(t.app, 'analyst@w.co');
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'analyst@w.co' } });
    await t.deps.db.membership.create({ data: { storeId, userId: user.id, role: 'ANALYST' } });
    const h = { cookie, origin: ORIGIN, 'x-store-id': storeId };
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/widgets/${w.id}/preview`, headers: h })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'POST', url: `/api/v1/widgets/${w.id}/publish`, headers: h })).statusCode).toBe(403);
  });
});

describe('onboarding', () => {
  const embed = (disabled: boolean) =>
    `/* auto-generated */\n${JSON.stringify({ current: { blocks: { '123': { type: 'shopify://apps/instafeed/blocks/instafeed-embed/abc-uuid', disabled } } } })}`;

  it('detects the app embed state from the main theme settings', () => {
    expect(appEmbedState(embed(false))).toBe('enabled');
    expect(appEmbedState(embed(true))).toBe('disabled');
    expect(appEmbedState(undefined)).toBe('disabled');
  });

  it('reports checklist progress and a theme editor deep link', async () => {
    t.shopify.themeSettings[SHOP] = embed(false);
    const w = await createWidget();
    await api('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, videoIds: [videoIds[0]] });
    await api('POST', `/api/v1/widgets/${w.id}/publish`);
    const res = (await api('GET', '/api/v1/onboarding')).json();
    expect(res).toEqual({
      productsSynced: true,
      videoCount: 3,
      publishedWidgets: 1,
      appEmbed: 'enabled',
      themeEditorUrl: `https://${SHOP}/admin/themes/current/editor?context=apps&activateAppId=test-api-key/instafeed-embed`,
    });
  });
});
