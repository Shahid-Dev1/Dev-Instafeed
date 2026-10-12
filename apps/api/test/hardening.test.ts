import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { ingestEvents } from '../src/modules/analytics/ingest.js';
import { enqueueFullSync } from '../src/modules/products/jobs.js';
import { runFullSync } from '../src/modules/products/sync.js';
import { createTestContext, fakeProduct, installShop, registerUser, resetData, sessionToken, webhookHeaders } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));
beforeEach(() => resetData(t.deps));

/**
 * Every route reachable without a merchant/staff session. Adding a public route requires adding it here,
 * which forces a security review of how that route authenticates (signature, state, origin, etc.).
 */
const PUBLIC_ROUTES = new Set([
  'GET /health', // liveness
  'GET /health/ready', // readiness
  'POST /api/v1/auth/register', // rate-limited
  'POST /api/v1/auth/login', // rate-limited
  'POST /api/v1/auth/logout', // clears own cookie only
  'POST /webhooks/shopify', // HMAC
  'POST /webhooks/shopify/compliance', // HMAC
  'POST /webhooks/bunny', // signature when configured; payload is only a hint
  'GET /oauth/:provider/callback', // single-use OAuth state
  'GET /proxy/widgets', // App Proxy signature
  'POST /proxy/events', // App Proxy signature
  'POST /pixel/events', // known visitors only, rate-limited, deduplicated
  'GET /public/v1/:publicKey/widgets', // authorized origins only
]);

const fill = (url: string) => url.replace(/:[A-Za-z]+/g, 'x0000000000000000000000000');

describe('route authorization inventory', () => {
  it('rejects unauthenticated requests on every non-allowlisted route', async () => {
    const offenders: string[] = [];
    for (const r of t.app.routeInventory) {
      const key = `${r.method} ${r.url}`;
      if (PUBLIC_ROUTES.has(key)) continue;
      const res = await t.app.inject({ method: r.method as 'GET', url: fill(r.url), payload: ['GET', 'DELETE'].includes(r.method) ? undefined : {} });
      if (res.statusCode !== 401) offenders.push(`${key} → ${res.statusCode}`);
    }
    expect(offenders).toEqual([]);
    expect(t.app.routeInventory.length).toBeGreaterThan(60);
  });

  it('the public allowlist only names routes that exist', () => {
    const existing = new Set(t.app.routeInventory.map((r) => `${r.method} ${r.url}`));
    expect([...PUBLIC_ROUTES].filter((r) => !existing.has(r))).toEqual([]);
  });

  it("store B can't read any of store A's records by id on any GET route", async () => {
    const a = await installShop(t, 'iso-a.myshopify.com');
    await installShop(t, 'iso-b.myshopify.com');
    t.shopify.catalogs['iso-a.myshopify.com'] = [fakeProduct(1)];
    const run = await enqueueFullSync(t.deps, a, 'MANUAL');
    await runFullSync(t.deps, a, run.id);
    const ids = {
      product: (await t.deps.db.product.findFirstOrThrow({ where: { storeId: a } })).id,
      video: (await t.deps.db.video.create({ data: { storeId: a, source: 'UPLOAD', externalId: 'iso', status: 'READY', title: 'secret' } })).id,
      widget: (await t.deps.db.widget.create({ data: { storeId: a, name: 'secret', type: 'GRID', config: {}, targeting: {} } })).id,
    };
    const asB = { authorization: `Bearer ${sessionToken('iso-b.myshopify.com', '1')}` };
    const leaks: string[] = [];
    for (const r of t.app.routeInventory.filter((x) => x.method === 'GET' && x.url.startsWith('/api/v1/') && x.url.includes(':id'))) {
      for (const id of Object.values(ids)) {
        const res = await t.app.inject({ method: 'GET', url: r.url.replace(':id', id), headers: asB });
        if (res.statusCode === 200 || res.body.includes('secret')) leaks.push(`${r.url} with ${id} → ${res.statusCode}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});

describe('data deletion (GDPR shop/redact)', () => {
  it('removes every row in every store-owned table, keeping only the anonymized audit trail', async () => {
    const shop = 'redact-me.myshopify.com';
    const storeId = await installShop(t, shop);
    t.shopify.catalogs[shop] = [fakeProduct(1)];
    const run = await enqueueFullSync(t.deps, storeId, 'MANUAL');
    await runFullSync(t.deps, storeId, run.id);
    const product = await t.deps.db.product.findFirstOrThrow({ where: { storeId } });
    const video = await t.deps.db.video.create({ data: { storeId, source: 'UPLOAD', externalId: 'r', status: 'READY', title: 'r' } });
    await t.deps.db.videoProduct.create({ data: { storeId, videoId: video.id, productId: product.id, position: 0 } });
    const widget = await t.deps.db.widget.create({ data: { storeId, name: 'w', type: 'GRID', config: {}, targeting: {} } });
    await t.deps.db.widgetVideo.create({ data: { storeId, widgetId: widget.id, videoId: video.id, position: 0 } });
    await ingestEvents(t.deps, storeId, [{ v: 1, eventId: randomUUID(), type: 'video_open', visitorId: 'v1', videoId: video.id, occurredAt: Date.now() }], new Date());
    await t.deps.db.order.create({ data: { storeId, shopifyOrderId: '1', createdAtShopify: new Date(), currency: 'INR', totalMinor: 100n, lineItems: [] } });
    await t.deps.db.integration.create({ data: { storeId, kind: 'GTM', publicConfig: { containerId: 'GTM-ABC123' }, events: [] } });
    await t.deps.db.integrationLog.create({ data: { storeId, kind: 'GTM', level: 'info', message: 'x' } });
    await t.deps.db.storeSettings.create({ data: { storeId, customCss: '' } });
    await t.deps.db.invite.create({ data: { storeId, email: 'a@b.co', role: 'EDITOR', tokenHash: randomUUID(), invitedById: 'u', expiresAt: new Date() } });
    await t.deps.db.providerAccount.create({ data: { storeId, provider: 'TIKTOK', externalUserId: 'o', accessTokenEnc: 'x', accessTokenExpiresAt: new Date(), scopes: '' } });
    await t.deps.db.oAuthState.create({ data: { stateHash: randomUUID(), storeId, userId: 'u', provider: 'TIKTOK', expiresAt: new Date() } });
    const cookie = await registerUser(t.app, 'staffer@redact.co');
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'staffer@redact.co' } });
    await t.deps.db.membership.create({ data: { storeId, userId: user.id, role: 'EDITOR' } });
    await t.deps.rawDb.session.updateMany({ where: { userId: user.id }, data: { storeId } });
    expect(cookie).toBeTruthy();

    const body = JSON.stringify({ shop_domain: shop });
    expect((await t.app.inject({ method: 'POST', url: '/webhooks/shopify/compliance', headers: webhookHeaders('shop/redact', shop, body), payload: body })).statusCode).toBe(200);

    // Every model with a storeId column (parsed from the schema, so new models are covered automatically).
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const models = [...schema.matchAll(/model (\w+) \{([^}]*)\}/g)].filter(([, , b]) => /^\s+storeId\s/m.test(b!)).map(([, n]) => n!);
    const remaining: string[] = [];
    for (const m of models) {
      const delegate = (t.deps.rawDb as unknown as Record<string, { count: (a: object) => Promise<number> }>)[m[0]!.toLowerCase() + m.slice(1)]!;
      const n = await delegate.count({ where: { storeId } });
      if (n) remaining.push(`${m}: ${n}`);
    }
    expect(remaining).toEqual([]);
    expect(models.length).toBeGreaterThanOrEqual(20);
    expect(await t.deps.rawDb.store.count({ where: { id: storeId } })).toBe(0);
    expect(await t.deps.rawDb.auditLog.count({ where: { action: 'gdpr.shop_redact', storeId: null } })).toBe(1);
  });
});
