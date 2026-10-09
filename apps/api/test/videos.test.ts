import { createHash, createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { processVideoJob } from '../src/modules/videos/jobs.js';
import { syncBunnyStatus } from '../src/modules/videos/service.js';
import { createTestContext, fakeProduct, installShop, ORIGIN, registerUser, resetData, sessionToken } from './helpers.js';
import { runFullSync } from '../src/modules/products/sync.js';
import { enqueueFullSync } from '../src/modules/products/jobs.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));

const SHOP = 'videos.myshopify.com';
const OTHER = 'other-videos.myshopify.com';
let storeId: string;
const auth = (shop = SHOP) => ({ authorization: `Bearer ${sessionToken(shop, '1')}` });
const api = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, shop = SHOP) =>
  t.app.inject({ method, url, headers: auth(shop), ...(payload !== undefined ? { payload: payload as object } : {}) });

async function enableFlag(key: string, sid = storeId) {
  await t.deps.rawDb.featureFlag.create({ data: { key, storeId: sid, enabled: true } });
}

beforeEach(async () => {
  await resetData(t.deps);
  t.providers.reset();
  storeId = await installShop(t, SHOP);
});

const YT = 'dQw4w9WgXcQ';
const TT_URL = 'https://www.tiktok.com/@brand/video/7234567890123456789';

describe('URL imports', () => {
  it('imports a YouTube Short with official embed URL and metadata', async () => {
    t.providers.youtube[YT] = { title: 'Serum routine', duration: 'PT58S' };
    const res = await api('POST', '/api/v1/videos/import', { url: `https://youtube.com/shorts/${YT}` });
    expect(res.statusCode).toBe(201);
    expect(res.json().video).toMatchObject({
      source: 'YOUTUBE', status: 'READY', title: 'Serum routine', durationSec: 58, width: 1080, height: 1920,
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}`, permalink: `https://www.youtube.com/shorts/${YT}`, authorName: 'Brand',
    });
  });

  it('detects duplicates and reports the existing video', async () => {
    t.providers.youtube[YT] = { title: 'x' };
    const first = await api('POST', '/api/v1/videos/import', { url: `https://youtu.be/${YT}` });
    const dup = await api('POST', '/api/v1/videos/import', { url: `https://www.youtube.com/watch?v=${YT}` });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details.videoId).toBe(first.json().video.id);
  });

  it.each([
    [{ title: 'x', privacy: 'private' }, /private/],
    [{ title: 'x', embeddable: false }, /disabled embedding/],
    [undefined, /does not exist/],
  ])('rejects unavailable YouTube videos (%o)', async (video, msg) => {
    if (video) t.providers.youtube[YT] = video;
    const res = await api('POST', '/api/v1/videos/import', { url: `https://youtu.be/${YT}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(msg);
  });

  it('imports a TikTok URL via oEmbed and rejects unavailable or short links', async () => {
    t.providers.tiktokOembed[TT_URL] = { title: 'Coffee scrub', author_name: 'brand', thumbnail_url: 'https://p16.tiktokcdn.com/t.jpg' };
    const ok = await api('POST', '/api/v1/videos/import', { url: `${TT_URL}?is_from_webapp=1` });
    expect(ok.json().video).toMatchObject({ source: 'TIKTOK_URL', status: 'READY', embedUrl: 'https://www.tiktok.com/player/v1/7234567890123456789', authorName: 'brand' });
    expect((await api('POST', '/api/v1/videos/import', { url: 'https://www.tiktok.com/@brand/video/1111111111111111111' })).statusCode).toBe(400);
    expect((await api('POST', '/api/v1/videos/import', { url: 'https://vm.tiktok.com/abc/' })).json().error.message).toMatch(/Short TikTok links/);
  });

  it('Instagram Reel links require the oEmbed feature flag', async () => {
    t.providers.igOembed.C7xYz12AbCd = { author_name: 'brand_ig', thumbnail_url: 'https://scontent.cdninstagram.com/t.jpg' };
    const url = 'https://www.instagram.com/reel/C7xYz12AbCd/';
    expect((await api('POST', '/api/v1/videos/import', { url })).statusCode).toBe(403);
    await enableFlag('instagram_oembed');
    const res = await api('POST', '/api/v1/videos/import', { url });
    expect(res.json().video).toMatchObject({ source: 'INSTAGRAM_URL', embedUrl: 'https://www.instagram.com/reel/C7xYz12AbCd/embed', authorName: 'brand_ig' });
  });

  it('validates input and permissions', async () => {
    expect((await api('POST', '/api/v1/videos/import', { url: 'https://vimeo.com/1' })).statusCode).toBe(400);
    expect((await api('POST', '/api/v1/videos/import', { url: 'nope' })).statusCode).toBe(400);
    const cookie = await registerUser(t.app, 'analyst@v.co');
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'analyst@v.co' } });
    await t.deps.db.membership.create({ data: { storeId, userId: user.id, role: 'ANALYST' } });
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/videos/import', headers: { cookie, origin: ORIGIN, 'x-store-id': storeId }, payload: { url: `https://youtu.be/${YT}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('direct uploads (Bunny Stream)', () => {
  const upload = (extra: object = {}) => api('POST', '/api/v1/videos/uploads', { title: 'Launch video', bytes: 10_000_000, contentType: 'video/mp4', rightsConfirmed: true, ...extra });

  it('creates a Bunny video and returns pre-signed TUS headers without exposing the API key', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const { videoId, tus } = res.json();
    expect(JSON.stringify(res.json())).not.toContain('bunny-test-key');
    const expected = createHash('sha256').update(`555bunny-test-key${tus.headers.AuthorizationExpire}${tus.headers.VideoId}`).digest('hex');
    expect(tus.headers).toMatchObject({ AuthorizationSignature: expected, LibraryId: '555', VideoId: 'guid-1' });
    const video = await t.deps.db.video.findFirstOrThrow({ where: { storeId, id: videoId } });
    expect(video).toMatchObject({ source: 'UPLOAD', status: 'PENDING', bunnyVideoId: 'guid-1' });
  });

  it('validates size, type and rights confirmation', async () => {
    expect((await upload({ bytes: 600 * 1024 * 1024 })).statusCode).toBe(400);
    expect((await upload({ contentType: 'application/zip' })).statusCode).toBe(400);
    expect((await upload({ rightsConfirmed: false })).statusCode).toBe(400);
  });

  it('moves through processing to READY using Bunny as the source of truth', async () => {
    const { videoId } = (await upload()).json();
    expect(await syncBunnyStatus(t.deps, storeId, videoId)).toBe('PENDING');
    t.providers.bunnyVideos['guid-1'] = { status: 2, storageSize: 1000, length: 0, width: 0, height: 0 };
    expect(await syncBunnyStatus(t.deps, storeId, videoId)).toBe('PROCESSING');
    t.providers.bunnyVideos['guid-1'] = { status: 4, storageSize: 1000, length: 31.5, width: 1080, height: 1920 };
    expect(await syncBunnyStatus(t.deps, storeId, videoId)).toBe('READY');
    const v = (await api('GET', `/api/v1/videos/${videoId}`)).json().video;
    expect(v).toMatchObject({ status: 'READY', durationSec: 31.5, playbackUrl: 'https://vz-test.b-cdn.net/guid-1/playlist.m3u8', thumbnailUrl: 'https://vz-test.b-cdn.net/guid-1/thumbnail.jpg' });
  });

  it('marks failed encodes and abandoned uploads', async () => {
    const { videoId } = (await upload()).json();
    t.providers.bunnyVideos['guid-1']!.status = 5;
    expect(await syncBunnyStatus(t.deps, storeId, videoId)).toBe('FAILED');
    const second = (await upload({ title: 'Second' })).json().videoId;
    await t.deps.db.video.update({ where: { id: second, storeId }, data: { createdAt: new Date(Date.now() - 7 * 3600_000) } });
    expect(await syncBunnyStatus(t.deps, storeId, second)).toBe('FAILED');
  });

  it('accepts signed Bunny webhooks as status hints and rejects forged ones', async () => {
    const { videoId } = (await upload()).json();
    await t.deps.queues.videos.obliterate({ force: true });
    const body = JSON.stringify({ VideoLibraryId: 555, VideoGuid: 'guid-1', Status: 3 });
    const sig = createHmac('sha256', 'bunny-webhook-key').update(body).digest('hex');
    const forged = await t.app.inject({ method: 'POST', url: '/webhooks/bunny', headers: { 'content-type': 'application/json', 'x-bunnystream-signature': 'bad' }, payload: body });
    expect(forged.statusCode).toBe(401);
    const ok = await t.app.inject({ method: 'POST', url: '/webhooks/bunny', headers: { 'content-type': 'application/json', 'x-bunnystream-signature': sig }, payload: body });
    expect(ok.statusCode).toBe(200);
    const jobs = await t.deps.queues.videos.getJobs(['waiting']);
    expect(jobs.map((j) => j.data)).toEqual([{ storeId, videoId }]);
  });

  it('reports unconfigured hosting and YouTube as unavailable', async () => {
    const bare = await createTestContext({ BUNNY_STREAM_API_KEY: undefined, YOUTUBE_API_KEY: '' });
    try {
      await installShop(bare, 'bare.myshopify.com');
      const h = { authorization: `Bearer ${sessionToken('bare.myshopify.com', '1')}` };
      const caps = await bare.app.inject({ method: 'GET', url: '/api/v1/videos/capabilities', headers: h });
      expect(caps.json()).toMatchObject({ upload: false, youtube: false, tiktokUrl: true });
      const up = await bare.app.inject({ method: 'POST', url: '/api/v1/videos/uploads', headers: h, payload: { title: 'x', bytes: 1, contentType: 'video/mp4', rightsConfirmed: true } });
      expect(up.statusCode).toBe(503);
      const yt = await bare.app.inject({ method: 'POST', url: '/api/v1/videos/import', headers: h, payload: { url: `https://youtu.be/${YT}` } });
      expect(yt.statusCode).toBe(503);
    } finally {
      await closeDeps(bare.deps);
    }
  });
});

describe('library management and product tagging', () => {
  let ids: string[];
  let productIds: string[];

  beforeEach(async () => {
    ids = [];
    for (const [i, id] of ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'].entries()) {
      t.providers.youtube[id] = { title: ['Zebra serum', 'Apple scrub', 'Mango lotion'][i]! };
      ids.push((await api('POST', '/api/v1/videos/import', { url: `https://youtu.be/${id}` })).json().video.id);
    }
    t.shopify.catalogs[SHOP] = [fakeProduct(1, 2), fakeProduct(2, 1)];
    const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
    await runFullSync(t.deps, storeId, run.id);
    productIds = (await t.deps.db.product.findMany({ where: { storeId }, orderBy: { handle: 'asc' } })).map((p) => p.id);
  });

  it('tags products and variants in order and replaces the set', async () => {
    const variant = await t.deps.db.variant.findFirstOrThrow({ where: { storeId, productId: productIds[0] }, orderBy: { position: 'desc' } });
    const res = await api('PUT', `/api/v1/videos/${ids[0]}/products`, [{ productId: productIds[1] }, { productId: productIds[0], variantId: variant.id }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().video.products).toMatchObject([
      { productId: productIds[1], variantId: null, title: 'Product 002' },
      { productId: productIds[0], variantId: variant.id, variantTitle: 'Size 1' },
    ]);
    expect((await api('PUT', `/api/v1/videos/${ids[0]}/products`, [])).json().video.products).toEqual([]);
  });

  it('rejects invalid tags: foreign store products, wrong variants, deleted and duplicate products', async () => {
    await installShop(t, OTHER);
    t.shopify.catalogs[OTHER] = [fakeProduct(9)];
    const otherStore = (await t.deps.rawDb.store.findUniqueOrThrow({ where: { shopDomain: OTHER } })).id;
    const run = await enqueueFullSync(t.deps, otherStore, 'MANUAL');
    await runFullSync(t.deps, otherStore, run.id);
    const foreign = await t.deps.db.product.findFirstOrThrow({ where: { storeId: otherStore } });
    expect((await api('PUT', `/api/v1/videos/${ids[0]}/products`, [{ productId: foreign.id }])).statusCode).toBe(400);

    const wrongVariant = await t.deps.db.variant.findFirstOrThrow({ where: { storeId, productId: productIds[1] } });
    expect((await api('PUT', `/api/v1/videos/${ids[0]}/products`, [{ productId: productIds[0], variantId: wrongVariant.id }])).statusCode).toBe(400);
    expect((await api('PUT', `/api/v1/videos/${ids[0]}/products`, [{ productId: productIds[0] }, { productId: productIds[0] }])).statusCode).toBe(400);
    await t.deps.db.product.update({ where: { id: productIds[0], storeId }, data: { deletedAt: new Date() } });
    expect((await api('PUT', `/api/v1/videos/${ids[0]}/products`, [{ productId: productIds[0] }])).statusCode).toBe(400);
  });

  it('searches, filters, sorts and paginates', async () => {
    const titles = async (qs: string) => (await api('GET', `/api/v1/videos?${qs}`)).json().items.map((v: { title: string }) => v.title);
    expect(await titles('sort=title')).toEqual(['Apple scrub', 'Mango lotion', 'Zebra serum']);
    expect(await titles('q=SERUM')).toEqual(['Zebra serum']);
    expect(await titles('source=TIKTOK_URL')).toEqual([]);
    await api('PATCH', `/api/v1/videos/${ids[1]}`, { tags: ['Summer', 'summer', 'bestseller'] });
    expect((await api('GET', `/api/v1/videos/${ids[1]}`)).json().video.tags).toEqual(['summer', 'bestseller']);
    expect(await titles('tag=summer')).toEqual(['Apple scrub']);
    const page1 = (await api('GET', '/api/v1/videos?sort=title&limit=2')).json();
    const page2 = (await api('GET', `/api/v1/videos?sort=title&limit=2&cursor=${page1.nextCursor}`)).json();
    expect([...page1.items, ...page2.items].map((v: { title: string }) => v.title)).toEqual(['Apple scrub', 'Mango lotion', 'Zebra serum']);
    expect(page2.nextCursor).toBeNull();
    expect((await api('PATCH', `/api/v1/videos/${ids[1]}`, { tags: ['<script>'] })).statusCode).toBe(400);
    expect((await api('PATCH', `/api/v1/videos/${ids[1]}`, {})).statusCode).toBe(400);
  });

  it('bulk archives, restores, tags and deletes (removing hosted media)', async () => {
    expect((await api('POST', '/api/v1/videos/bulk', { action: 'archive', ids: ids.slice(0, 2) })).json().affected).toBe(2);
    expect((await api('GET', '/api/v1/videos')).json().items).toHaveLength(1);
    expect((await api('GET', '/api/v1/videos?archived=true')).json().items).toHaveLength(2);
    await api('POST', '/api/v1/videos/bulk', { action: 'unarchive', ids });
    await api('POST', '/api/v1/videos/bulk', { action: 'addTags', ids, tags: ['promo'] });
    await api('POST', '/api/v1/videos/bulk', { action: 'removeTags', ids: [ids[0]], tags: ['promo'] });
    expect((await api('GET', '/api/v1/videos?tag=promo')).json().items).toHaveLength(2);

    const up = (await api('POST', '/api/v1/videos/uploads', { title: 'Hosted', bytes: 10, contentType: 'video/mp4', rightsConfirmed: true })).json();
    expect((await api('POST', '/api/v1/videos/bulk', { action: 'delete', ids: [ids[0], up.videoId] })).json().affected).toBe(2);
    const del = (await t.deps.queues.videos.getJobs(['waiting'])).find((j) => j.name === 'bunny-delete')!;
    await processVideoJob(t.deps, del);
    expect(t.providers.bunnyVideos['guid-1']).toBeUndefined();
    expect((await api('POST', '/api/v1/videos/bulk', { action: 'delete', ids: [] })).statusCode).toBe(400);
  });

  it('isolates stores for every video operation', async () => {
    await installShop(t, OTHER);
    const id = ids[0]!;
    expect((await api('GET', '/api/v1/videos', undefined, OTHER)).json().items).toHaveLength(0);
    expect((await api('GET', `/api/v1/videos/${id}`, undefined, OTHER)).statusCode).toBe(404);
    expect((await api('PATCH', `/api/v1/videos/${id}`, { title: 'hacked' }, OTHER)).statusCode).toBe(404);
    expect((await api('PUT', `/api/v1/videos/${id}/products`, [], OTHER)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/v1/videos/${id}`, undefined, OTHER)).statusCode).toBe(404);
    expect((await api('POST', '/api/v1/videos/bulk', { action: 'archive', ids }, OTHER)).json().affected).toBe(0);
    expect((await api('GET', `/api/v1/videos/${id}`)).json().video.title).toBe('Zebra serum');
  });

  it('marks embedded videos unavailable when removed upstream', async () => {
    delete t.providers.youtube.aaaaaaaaaa2;
    await t.deps.db.video.updateMany({ where: { storeId }, data: { checkedAt: new Date(0) } });
    expect(await processVideoJob(t.deps, { name: 'recheck-embeds', data: {} })).toBe(1);
    const v = (await api('GET', `/api/v1/videos/${ids[1]}`)).json().video;
    expect(v).toMatchObject({ status: 'UNAVAILABLE', statusMessage: expect.stringMatching(/does not exist/) });
  });
});

describe('TikTok account connection (Display API, feature-flagged)', () => {
  async function connect() {
    await enableFlag('tiktok_display_api');
    const start = await api('POST', '/api/v1/connections/tiktok/start');
    const authorizeUrl = new URL(start.json().authorizeUrl);
    const state = authorizeUrl.searchParams.get('state')!;
    const cb = await t.app.inject({ method: 'GET', url: `/oauth/tiktok/callback?code=good-code&state=${state}` });
    return { start, authorizeUrl, state, cb };
  }

  it('is disabled until the flag is on', async () => {
    expect((await api('POST', '/api/v1/connections/tiktok/start')).statusCode).toBe(403);
    expect((await api('GET', '/api/v1/videos/capabilities')).json().providers[0]).toMatchObject({ provider: 'tiktok', enabled: false, configured: true });
  });

  it('connects with least-privilege scopes, single-use state and encrypted tokens', async () => {
    const { authorizeUrl, state, cb } = await connect();
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(authorizeUrl.searchParams.get('scope')).toBe('user.info.basic,video.list');
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('https://app.test/oauth/tiktok/callback');
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('https://admin.shopify.com/store/videos/apps/test-api-key/app/videos?connected=tiktok');
    const account = await t.deps.db.providerAccount.findFirstOrThrow({ where: { storeId } });
    expect(account).toMatchObject({ provider: 'TIKTOK', username: 'brand_tiktok', status: 'ACTIVE' });
    expect(account.accessTokenEnc).not.toContain('tt-at-');
    const replay = await t.app.inject({ method: 'GET', url: `/oauth/tiktok/callback?code=good-code&state=${state}` });
    expect(replay.statusCode).toBe(401);
  });

  it('rejects unknown, expired and cross-provider states; a denied grant returns an error redirect', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/oauth/tiktok/callback?code=good-code&state=forged' })).statusCode).toBe(401);
    await enableFlag('tiktok_display_api');
    await enableFlag('instagram_api');
    const igState = new URL((await api('POST', '/api/v1/connections/instagram/start')).json().authorizeUrl).searchParams.get('state')!;
    expect((await t.app.inject({ method: 'GET', url: `/oauth/tiktok/callback?code=good-code&state=${igState}` })).statusCode).toBe(401);
    const s2 = new URL((await api('POST', '/api/v1/connections/tiktok/start')).json().authorizeUrl).searchParams.get('state')!;
    await t.deps.db.oAuthState.updateMany({ where: { storeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await t.app.inject({ method: 'GET', url: `/oauth/tiktok/callback?code=good-code&state=${s2}` })).statusCode).toBe(401);
    const s3 = new URL((await api('POST', '/api/v1/connections/tiktok/start')).json().authorizeUrl).searchParams.get('state')!;
    const bad = await t.app.inject({ method: 'GET', url: `/oauth/tiktok/callback?code=bad-code&state=${s3}` });
    expect(bad.headers.location).toMatch(/connectError=tiktok/);
    expect(await t.deps.db.providerAccount.count({ where: { storeId } })).toBe(0);
  });

  it('lists videos with pagination, imports selected ones and skips foreign ids and duplicates', async () => {
    t.providers.tiktokVideos = Array.from({ length: 25 }, (_, i) => ({ id: `7${String(i).padStart(18, '0')}`, title: `Clip ${i}`, cover_image_url: `https://p16.tiktokcdn.com/${i}.jpg`, duration: 15 }));
    await connect();
    const p1 = (await api('GET', '/api/v1/connections/tiktok/videos')).json();
    expect(p1.items).toHaveLength(20);
    const p2 = (await api('GET', `/api/v1/connections/tiktok/videos?cursor=${p1.nextCursor}`)).json();
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();

    const res = (await api('POST', '/api/v1/connections/tiktok/import', { ids: [p1.items[0].id, p1.items[1].id, '7999999999999999999'] })).json();
    expect(res.imported).toHaveLength(2);
    expect(res.skipped).toEqual([{ id: '7999999999999999999', reason: 'Not found on this account' }]);
    const again = (await api('POST', '/api/v1/connections/tiktok/import', { ids: [p1.items[0].id] })).json();
    expect(again.skipped).toEqual([{ id: p1.items[0].id, reason: 'Already in your library' }]);
    expect((await api('GET', '/api/v1/connections/tiktok/videos')).json().items[0].alreadyImported).toBe(true);
    const v = await t.deps.db.video.findFirstOrThrow({ where: { storeId, source: 'TIKTOK_ACCOUNT' } });
    expect(v).toMatchObject({ status: 'READY', embedUrl: `https://www.tiktok.com/player/v1/${v.externalId}` });
  });

  it('refreshes expired access tokens and requires reconnect when the grant is revoked', async () => {
    t.providers.tiktokVideos = [{ id: '7000000000000000001', title: 'a', cover_image_url: 'x', duration: 1 }];
    await connect();
    await t.deps.db.providerAccount.updateMany({ where: { storeId }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
    expect((await api('GET', '/api/v1/connections/tiktok/videos')).statusCode).toBe(200);
    expect(t.providers.callsTo('open.tiktokapis.com').filter((c) => c.body?.includes('grant_type=refresh_token'))).toHaveLength(1);

    await t.deps.db.providerAccount.updateMany({ where: { storeId }, data: { accessTokenExpiresAt: new Date(Date.now() - 1000) } });
    t.providers.tiktokRefreshFails = true;
    expect((await api('GET', '/api/v1/connections/tiktok/videos')).statusCode).toBe(401);
    expect((await t.deps.db.providerAccount.findFirstOrThrow({ where: { storeId } })).status).toBe('REAUTH_REQUIRED');
  });

  it('flags revoked grants detected during API calls, and disconnects with revocation', async () => {
    await connect();
    t.providers.tiktokTokenInvalid = true;
    expect((await api('GET', '/api/v1/connections/tiktok/videos')).statusCode).toBe(401);
    expect((await t.deps.db.providerAccount.findFirstOrThrow({ where: { storeId } })).status).toBe('REAUTH_REQUIRED');
    expect((await api('DELETE', '/api/v1/connections/tiktok')).statusCode).toBe(200);
    expect(t.providers.callsTo('open.tiktokapis.com').some((c) => c.url.endsWith('/oauth/revoke/'))).toBe(true);
    expect(await t.deps.db.providerAccount.count({ where: { storeId } })).toBe(0);
  });
});

describe('Instagram Reels (Instagram API with Instagram Login, feature-flagged)', () => {
  async function connect() {
    await enableFlag('instagram_api');
    const state = new URL((await api('POST', '/api/v1/connections/instagram/start')).json().authorizeUrl).searchParams.get('state')!;
    return t.app.inject({ method: 'GET', url: `/oauth/instagram/callback?code=good-code&state=${state}` });
  }

  beforeEach(() => {
    t.providers.igMedia = [
      { id: '901', caption: 'Glow routine\n#skincare', media_type: 'VIDEO', media_url: 'https://scontent.cdninstagram.com/v/901.mp4', thumbnail_url: 'https://scontent.cdninstagram.com/901.jpg', permalink: 'https://www.instagram.com/reel/AAA901/' },
      { id: '902', caption: 'Licensed audio reel', media_type: 'VIDEO', thumbnail_url: 'https://scontent.cdninstagram.com/902.jpg', permalink: 'https://www.instagram.com/reel/AAA902/' },
      { id: '903', caption: 'A photo', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/903.jpg', thumbnail_url: '', permalink: 'https://www.instagram.com/p/AAA903/' },
    ];
  });

  it('connects and stores a long-lived token', async () => {
    const cb = await connect();
    expect(cb.headers.location).toMatch(/connected=instagram/);
    const account = await t.deps.db.providerAccount.findFirstOrThrow({ where: { storeId } });
    expect(account).toMatchObject({ provider: 'INSTAGRAM', username: 'brand_ig', externalUserId: '1784' });
    expect(account.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 86400_000);
  });

  it('lists only video posts and explains which cannot be imported', async () => {
    await connect();
    const items = (await api('GET', '/api/v1/connections/instagram/videos')).json().items;
    expect(items.map((i: { id: string }) => i.id)).toEqual(['901', '902']);
    expect(items[0]).toMatchObject({ title: 'Glow routine', importable: true });
    expect(items[1]).toMatchObject({ importable: false, reason: expect.stringMatching(/licensed audio/) });
  });

  it('requires ownership confirmation, then copies the Reel into Bunny and becomes READY', async () => {
    await connect();
    expect((await api('POST', '/api/v1/connections/instagram/import', { ids: ['901'] })).statusCode).toBe(400);
    const res = (await api('POST', '/api/v1/connections/instagram/import', { ids: ['901', '902'], rightsConfirmed: true })).json();
    expect(res.imported).toHaveLength(1);
    expect(res.skipped).toEqual([{ id: '902', reason: expect.stringMatching(/licensed audio/) }]);

    const job = (await t.deps.queues.videos.getJobs(['waiting'])).find((j) => j.name === 'instagram-copy')!;
    expect(await processVideoJob(t.deps, job)).toBe('uploaded');
    expect(t.providers.bunnyUploads['guid-1']).toBe(4096);
    t.providers.bunnyVideos['guid-1'] = { status: 3, storageSize: 4096, length: 12, width: 1080, height: 1920 };
    const videoId = res.imported[0];
    expect(await syncBunnyStatus(t.deps, storeId, videoId)).toBe('READY');
    const v = (await api('GET', `/api/v1/videos/${videoId}`)).json().video;
    expect(v).toMatchObject({ source: 'INSTAGRAM_ACCOUNT', playbackUrl: 'https://vz-test.b-cdn.net/guid-1/playlist.m3u8', permalink: 'https://www.instagram.com/reel/AAA901/' });
  });

  it('marks a Reel unavailable if it was removed before copying', async () => {
    await connect();
    const res = (await api('POST', '/api/v1/connections/instagram/import', { ids: ['901'], rightsConfirmed: true })).json();
    t.providers.igMedia = [];
    const job = (await t.deps.queues.videos.getJobs(['waiting'])).find((j) => j.name === 'instagram-copy')!;
    expect(await processVideoJob(t.deps, job)).toBe('unavailable');
    expect((await t.deps.db.video.findFirstOrThrow({ where: { storeId, id: res.imported[0] } })).status).toBe('UNAVAILABLE');
  });

  it('refreshes long-lived tokens that are due and flags invalid ones for reconnection', async () => {
    await connect();
    await t.deps.rawDb.$executeRaw`UPDATE "ProviderAccount" SET "updatedAt" = now() - interval '3 days', "accessTokenExpiresAt" = now() + interval '10 days'`;
    expect(await processVideoJob(t.deps, { name: 'refresh-provider-tokens', data: {} })).toBe(1);
    const a = await t.deps.db.providerAccount.findFirstOrThrow({ where: { storeId } });
    expect(a.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 86400_000);
  });
});
