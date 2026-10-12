import { createHmac } from 'node:crypto';
import { defaultWidgetConfig } from '@instafeed/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { checkUsage, planForHandles, syncSubscription } from '../src/modules/billing/entitlements.js';
import { processBillingJob } from '../src/modules/billing/jobs.js';
import { TEST_SHOPIFY } from './env.js';
import { createTestContext, installShop, ORIGIN, registerUser, resetData, sessionToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext({ SHOPIFY_PARTNER_ORG_ID: '4242', SHOPIFY_PARTNER_API_TOKEN: 'prtapi_test', SHOPIFY_APP_ID: '999', SHOPIFY_APP_HANDLE: 'instafeed', ANTHROPIC_API_KEY: 'sk-ant-test' })));
afterAll(() => closeDeps(t.deps));

const SHOP = 'billing-shop.myshopify.com';
const GID = `gid://shopify/Shop/${Buffer.from(SHOP).toString('hex').slice(0, 12)}`;
let storeId: string;
const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, sub = '1') =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${sessionToken(SHOP, sub)}` }, ...(payload ? { payload } : {}) });
const sub = (handle: string, extra: object = {}) => ({
  billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: false, trialEndsAt: null,
  currentBillingCycle: { startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-31T00:00:00Z' }, items: [{ handle }], pendingUpdate: null, ...extra,
});
async function setPlan(plan: 'FREE' | 'STARTER' | 'GROWTH' | 'PRO') {
  await t.deps.db.subscription.update({ where: { storeId }, data: { planId: plan, checkedAt: new Date() } });
}
const video = (i: number, extra: object = {}) =>
  t.deps.db.video.create({ data: { storeId, source: 'UPLOAD', externalId: `b${i}`, status: 'READY', title: `V${i}`, ...extra } });

beforeEach(async () => {
  await resetData(t.deps);
  t.providers.reset();
  storeId = await installShop(t, SHOP, '1', 'FREE');
});

describe('Shopify App Pricing sync (Partner API)', () => {
  it('maps plan handles', () => {
    expect(planForHandles(['growth'])).toBe('GROWTH');
    expect(planForHandles(['starter', 'PRO'])).toBe('PRO');
    expect(planForHandles(['unknown'])).toBe('FREE');
  });

  it('no subscription is the Free plan; an active one sets plan, cycle, cancellation and pending changes', async () => {
    expect((await syncSubscription(t.deps, storeId))).toMatchObject({ planId: 'FREE', status: 'NONE' });
    t.providers.partnerSubs[GID] = sub('growth', { cancelAtEndOfCycle: true, pendingUpdate: { items: [{ handle: 'starter' }] } });
    const s = await syncSubscription(t.deps, storeId);
    expect(s).toMatchObject({ planId: 'GROWTH', status: 'ACTIVE', cancelAtEndOfCycle: true, pendingPlanHandle: 'starter' });
    expect(s.currentPeriodEnd?.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    const call = JSON.parse(t.providers.callsTo('partners.shopify.com')[0]!.body!);
    expect(call.variables).toEqual({ appId: 'gid://shopify/App/999', shopId: GID });
    expect(t.providers.callsTo('partners.shopify.com')[0]!.url).toBe('https://partners.shopify.com/4242/api/2026-10/graphql.json');
  });

  it('is idempotent and audits only real plan changes; a lapsed subscription (failed renewal/cancel) drops to Free', async () => {
    t.providers.partnerSubs[GID] = sub('pro');
    await syncSubscription(t.deps, storeId);
    await syncSubscription(t.deps, storeId);
    delete t.providers.partnerSubs[GID];
    await syncSubscription(t.deps, storeId);
    const changes = await t.deps.rawDb.auditLog.findMany({ where: { storeId, action: 'billing.plan_changed' }, orderBy: { createdAt: 'asc' } });
    expect(changes.map((c) => c.meta)).toEqual([{ from: 'FREE', to: 'PRO', status: 'ACTIVE' }, { from: 'PRO', to: 'FREE', status: 'NONE' }]);
  });

  it('keeps the last known plan when the Partner API is down', async () => {
    await setPlan('GROWTH');
    await t.deps.db.subscription.update({ where: { storeId }, data: { checkedAt: new Date(0) } });
    t.providers.partnerFail = true;
    expect((await req('GET', '/api/v1/billing')).json().plan.id).toBe('GROWTH');
  });

  it('billing overview: manage link only for the owner; refresh via sync; scheduled sync covers all stores', async () => {
    t.providers.partnerSubs[GID] = sub('starter');
    expect((await req('POST', '/api/v1/billing/sync')).json()).toEqual({ planId: 'STARTER', status: 'ACTIVE' });
    const owner = (await req('GET', '/api/v1/billing')).json();
    expect(owner).toMatchObject({ configured: true, plan: { id: 'STARTER' }, manageUrl: 'https://admin.shopify.com/store/billing-shop/charges/instafeed/pricing_plans' });
    expect(owner.plans.map((p: { id: string }) => p.id)).toEqual(['FREE', 'STARTER', 'GROWTH', 'PRO']);
    await req('GET', '/api/v1/me', undefined, '2'); // second staff member (Editor)
    expect((await req('GET', '/api/v1/billing', undefined, '2')).json().manageUrl).toBeNull();
    t.providers.partnerSubs[GID] = sub('pro');
    expect(await processBillingJob(t.deps, { name: 'sync-all', data: {} })).toBe(1);
    expect((await t.deps.db.subscription.findUniqueOrThrow({ where: { storeId } })).planId).toBe('PRO');
  });
});

describe('entitlements are enforced on the server', () => {
  it('Free plan: 1 widget, Stories/Carousel only; Pro unlocks more', async () => {
    expect((await req('POST', '/api/v1/widgets', { name: 'A', type: 'CAROUSEL' })).statusCode).toBe(201);
    const second = await req('POST', '/api/v1/widgets', { name: 'B', type: 'STORIES' });
    expect(second.statusCode).toBe(402);
    expect(second.json().error).toMatchObject({ code: 'PLAN_LIMIT', details: { metric: 'widgets', limit: 1 } });
    await t.deps.db.widget.deleteMany({ where: { storeId } });
    expect((await req('POST', '/api/v1/widgets', { name: 'F', type: 'FLOATING' })).json().error.code).toBe('PLAN_LIMIT');
    await setPlan('PRO');
    expect((await req('POST', '/api/v1/widgets', { name: 'F', type: 'FLOATING' })).statusCode).toBe(201);
  });

  it('video count and storage limits apply to imports and uploads', async () => {
    for (let i = 0; i < 10; i++) await video(i);
    t.providers.youtube.dQw4w9WgXcQ = { title: 'x' };
    expect((await req('POST', '/api/v1/videos/import', { url: 'https://youtu.be/dQw4w9WgXcQ' })).json().error).toMatchObject({ code: 'PLAN_LIMIT', details: { metric: 'videos' } });
    await t.deps.db.video.deleteMany({ where: { storeId } });
    const big = await req('POST', '/api/v1/videos/uploads', { title: 'Big', bytes: 2 * 1024 ** 3 - 1, contentType: 'video/mp4', rightsConfirmed: true });
    expect((await t.deps.db.video.count({ where: { storeId } }))).toBe(0);
    expect([400, 402]).toContain(big.statusCode); // size cap (500 MB) or storage cap (1 GB), never created
    await t.deps.db.video.create({ data: { storeId, source: 'UPLOAD', externalId: 'full', bunnyVideoId: 'full', status: 'READY', title: 'full', bytes: BigInt(1024 ** 3) } });
    const res = await req('POST', '/api/v1/videos/uploads', { title: 'More', bytes: 10_000_000, contentType: 'video/mp4', rightsConfirmed: true });
    expect(res.json().error).toMatchObject({ code: 'PLAN_LIMIT', details: { metric: 'storageGb' } });
  });

  it('paid features: integrations and custom CSS need Growth, the AI assistant needs Pro', async () => {
    await setPlan('STARTER');
    expect((await req('PUT', '/api/v1/integrations/GTM', { enabled: true, publicConfig: { containerId: 'GTM-ABC123' }, events: [] })).statusCode).toBe(402);
    expect((await req('PUT', '/api/v1/settings/custom-css', { customCss: '.if-card{color:#000}' })).statusCode).toBe(402);
    expect((await req('PUT', '/api/v1/settings/custom-css', { customCss: '' })).statusCode).toBe(200); // clearing is always allowed
    await setPlan('GROWTH');
    expect((await req('PUT', '/api/v1/integrations/GTM', { enabled: true, publicConfig: { containerId: 'GTM-ABC123' }, events: [] })).statusCode).toBe(200);
    const w = (await req('POST', '/api/v1/widgets', { name: 'G', type: 'GRID' })).json().widget;
    await t.deps.rawDb.featureFlag.create({ data: { key: 'ai_assistant', storeId, enabled: true } });
    expect((await req('POST', `/api/v1/widgets/${w.id}/ai`, { prompt: 'rounder', config: defaultWidgetConfig('GRID') })).statusCode).toBe(402);
  });
});

describe('downgrades and usage grace period on the storefront', () => {
  const proxy = () => {
    const params = { shop: SHOP, timestamp: '1', embed: '1', page_type: 'index', path: '/' };
    const msg = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join('');
    return t.app.inject({ method: 'GET', url: `/proxy/widgets?${new URLSearchParams({ ...params, signature: createHmac('sha256', TEST_SHOPIFY.apiSecret).update(msg).digest('hex') })}` });
  };

  beforeEach(async () => {
    await setPlan('PRO');
    const v = await video(1);
    const w = (await req('POST', '/api/v1/widgets', { name: 'PiP', type: 'FLOATING' })).json().widget;
    await req('PATCH', `/api/v1/widgets/${w.id}`, { version: 1, videoIds: [v.id] });
    await req('POST', `/api/v1/widgets/${w.id}/publish`);
  });

  it('stops serving widget types the new plan does not include', async () => {
    expect((await proxy()).json().widgets).toHaveLength(1);
    await setPlan('FREE');
    expect((await proxy()).json().widgets).toHaveLength(0);
  });

  it('warns at 80%, starts a grace period over the limit, pauses after it, and recovers', async () => {
    // Pro allows 1,000,000 monthly views (video player opens).
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await t.deps.rawDb.$executeRaw`INSERT INTO "DailyStat" ("storeId","date","videoOpens") VALUES (${storeId}, ${today}::date, 850000)`;
    let b = (await req('GET', '/api/v1/billing')).json();
    expect(b.warnings).toEqual([{ metric: 'monthlyViews', used: 850000, limit: 1000000, level: 'warning' }]);
    await t.deps.rawDb.$executeRaw`UPDATE "DailyStat" SET "videoOpens" = 1200000 WHERE "storeId" = ${storeId}`;
    expect(await checkUsage(t.deps, storeId)).toBe(true);
    b = (await req('GET', '/api/v1/billing')).json();
    expect(b.paused).toBe(false);
    expect(b.graceEndsAt).not.toBeNull();
    expect((await proxy()).json().widgets).toHaveLength(1); // still serving during grace
    await t.deps.db.subscription.update({ where: { storeId }, data: { overLimitSince: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await req('GET', '/api/v1/billing')).json().paused).toBe(true);
    expect((await proxy()).json().widgets).toHaveLength(0);
    await t.deps.rawDb.$executeRaw`UPDATE "DailyStat" SET "videoOpens" = 10 WHERE "storeId" = ${storeId}`;
    expect(await checkUsage(t.deps, storeId)).toBe(false);
    expect((await proxy()).json().widgets).toHaveLength(1);
    expect(await t.deps.rawDb.auditLog.count({ where: { storeId, action: 'billing.over_limit' } })).toBe(1);
  });
});

describe('team invites', () => {
  const invite = (payload: object, sub = '1') => req('POST', '/api/v1/team/invites', payload, sub);

  it('creates a one-time link that only the invited email can accept, once', async () => {
    const res = await invite({ email: 'Editor@Brand.co', role: 'EDITOR' });
    expect(res.statusCode).toBe(201);
    const token = new URL(res.json().link).searchParams.get('token')!;
    expect(await t.deps.db.invite.findFirst({ where: { storeId, tokenHash: token } })).toBeNull(); // only the hash is stored
    expect((await req('GET', '/api/v1/team/invites')).json().invites).toMatchObject([{ email: 'editor@brand.co', role: 'EDITOR' }]);

    const wrong = await registerUser(t.app, 'someone@else.co');
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/invites/accept', headers: { cookie: wrong, origin: ORIGIN }, payload: { token } })).statusCode).toBe(403);
    const right = await registerUser(t.app, 'editor@brand.co');
    const accepted = await t.app.inject({ method: 'POST', url: '/api/v1/auth/invites/accept', headers: { cookie: right, origin: ORIGIN }, payload: { token } });
    expect(accepted.json()).toEqual({ storeId });
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: right, 'x-store-id': storeId } });
    expect(me.json().current).toMatchObject({ storeId, role: 'EDITOR' });
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/invites/accept', headers: { cookie: right, origin: ORIGIN }, payload: { token } })).statusCode).toBe(404);
  });

  it('enforces roles, expiry, revocation and duplicates', async () => {
    await req('GET', '/api/v1/me', undefined, '2'); // Editor staff
    expect((await invite({ email: 'x@y.co', role: 'ANALYST' }, '2')).statusCode).toBe(403);
    await t.deps.db.membership.updateMany({ where: { storeId, role: 'EDITOR' }, data: { role: 'ADMIN' } });
    expect((await invite({ email: 'x@y.co', role: 'ADMIN' }, '2')).statusCode).toBe(403); // only owners invite admins
    expect((await invite({ email: 'x@y.co', role: 'OWNER' })).statusCode).toBe(400);

    const a = await invite({ email: 'x@y.co', role: 'ANALYST' });
    await req('DELETE', `/api/v1/team/invites/${a.json().id}`);
    const cookie = await registerUser(t.app, 'x@y.co');
    const tokenA = new URL(a.json().link).searchParams.get('token')!;
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/invites/accept', headers: { cookie, origin: ORIGIN }, payload: { token: tokenA } })).statusCode).toBe(404);

    const b = await invite({ email: 'x@y.co', role: 'ANALYST' });
    await t.deps.db.invite.updateMany({ where: { storeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const tokenB = new URL(b.json().link).searchParams.get('token')!;
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/auth/invites/accept', headers: { cookie, origin: ORIGIN }, payload: { token: tokenB } })).statusCode).toBe(404);
  });
});

describe('store settings and the headless endpoint', () => {
  it('validates and normalizes authorized domains; default purchase flow applies to new widgets', async () => {
    expect((await req('PATCH', '/api/v1/settings/store', { authorizedDomains: ['http://insecure.example'] })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/v1/settings/store', { authorizedDomains: ['*.brand.com'] })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/v1/settings/store', { authorizedDomains: ['https://brand.com/path'] })).statusCode).toBe(400);
    const ok = await req('PATCH', '/api/v1/settings/store', { authorizedDomains: ['shop.brand.com', 'https://shop.brand.com'], defaultPurchaseFlow: 'PDP' });
    expect(ok.json()).toEqual({ defaultPurchaseFlow: 'PDP', authorizedDomains: ['https://shop.brand.com'] });
    expect((await req('POST', '/api/v1/widgets', { name: 'C', type: 'CAROUSEL' })).json().widget.config.cta.action).toBe('PDP');
  });

  it('serves widgets only to authorized origins', async () => {
    await req('PATCH', '/api/v1/settings/store', { authorizedDomains: ['https://shop.brand.com'] });
    const { headlessEndpoint } = (await req('GET', '/api/v1/settings/store')).json();
    const path = new URL(headlessEndpoint).pathname;
    const ok = await t.app.inject({ method: 'GET', url: `${path}?page_type=index`, headers: { origin: 'https://shop.brand.com' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://shop.brand.com');
    expect((await t.app.inject({ method: 'GET', url: path, headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: path })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/public/v1/not-a-key/widgets', headers: { origin: 'https://shop.brand.com' } })).statusCode).toBe(400);
  });
});

describe('support console', () => {
  it('requires a staff grant, never exposes tokens, and audits every access', async () => {
    const cookie = await registerUser(t.app, 'staff@instafeed.app');
    const h = { cookie, origin: ORIGIN };
    expect((await t.app.inject({ method: 'GET', url: '/support/stores', headers: h })).statusCode).toBe(403);
    expect((await req('GET', '/support/stores')).statusCode).toBe(403); // merchants via the embedded app never qualify
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'staff@instafeed.app' } });
    await t.deps.rawDb.platformRole.create({ data: { userId: user.id, role: 'SUPPORT' } });

    const list = await t.app.inject({ method: 'GET', url: '/support/stores?q=billing', headers: h });
    expect(list.json().stores.map((s: { shopDomain: string }) => s.shopDomain)).toEqual([SHOP]);
    const diag = await t.app.inject({ method: 'GET', url: `/support/stores/${storeId}/diagnostics`, headers: h });
    expect(diag.statusCode).toBe(200);
    expect(diag.json().store.tokens.hasOfflineToken).toBe(true);
    expect(diag.body).not.toMatch(/accessTokenEnc|refreshTokenEnc|secretsEnc|shpat_|passwordHash/);
    const act = await t.app.inject({ method: 'POST', url: `/support/stores/${storeId}/actions`, headers: h, payload: { action: 'resync_products' } });
    expect(act.json().syncRunId).toBeTruthy();
    const actions = (await t.deps.rawDb.auditLog.findMany({ where: { actorType: 'SUPPORT' } })).map((a) => a.action).sort();
    expect(actions).toEqual(['support.resync_products', 'support.search', 'support.view_diagnostics']);
  });
});
