import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { getAccessToken } from '../src/modules/shopify/install.js';
import { createTestContext, installShop, resetData, sessionToken, webhookHeaders, type TestContext } from './helpers.js';

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
beforeEach(async () => {
  await resetData(t.deps);
  t.shopify.calls = [];
  t.shopify.failTokenExchange = false;
  t.shopify.tokenCounter = 0;
});
afterAll(() => closeDeps(t.deps));

const SHOP = 'brand-a.myshopify.com';
const me = (token: string) => t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } });

describe('Shopify-managed install via token exchange', () => {
  it('installs on first embedded request with expiring offline tokens encrypted at rest', async () => {
    const res = await me(sessionToken(SHOP, '100'));
    expect(res.statusCode).toBe(200);
    expect(res.json().current).toMatchObject({ shopDomain: SHOP, role: 'OWNER', storeName: SHOP });

    const [exchange] = t.shopify.tokenRequests('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(exchange?.body).toMatchObject({ expiring: '1', requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token' });

    const store = await t.deps.rawDb.store.findUniqueOrThrow({ where: { shopDomain: SHOP } });
    expect(store.accessTokenEnc).toBeTruthy();
    expect(store.accessTokenEnc).not.toContain('shpat_');
    expect(store.refreshTokenEnc).not.toContain('shprt_');
    expect(store).toMatchObject({ currency: 'INR', timezone: 'Asia/Kolkata', uninstalledAt: null });
    expect(await t.deps.rawDb.auditLog.count({ where: { action: 'store.installed' } })).toBe(1);
  });

  it('does not re-exchange on later requests and assigns later staff the Editor role', async () => {
    await me(sessionToken(SHOP, '100'));
    const second = await me(sessionToken(SHOP, '200'));
    expect(second.json().current.role).toBe('EDITOR');
    expect(t.shopify.tokenRequests('urn:ietf:params:oauth:grant-type:token-exchange')).toHaveLength(1);
  });

  it('rejects tampered tokens without calling Shopify', async () => {
    const res = await me(sessionToken(SHOP, '1', {}, 'attacker-secret'));
    expect(res.statusCode).toBe(401);
    expect(t.shopify.calls).toHaveLength(0);
  });

  it('surfaces a rejected token exchange as 401', async () => {
    t.shopify.failTokenExchange = true;
    const res = await me(sessionToken(SHOP, '1'));
    expect(res.statusCode).toBe(401);
    expect(await t.deps.rawDb.store.count()).toBe(0);
  });

  it('handles uninstall then reinstall', async () => {
    const storeId = await installShop(t, SHOP, '100');
    const body = JSON.stringify({ id: 1, domain: SHOP });
    const un = await t.app.inject({ method: 'POST', url: '/webhooks/shopify', headers: webhookHeaders('app/uninstalled', SHOP, body), payload: body });
    expect(un.statusCode).toBe(200);
    const uninstalled = await t.deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(uninstalled.uninstalledAt).not.toBeNull();
    expect(uninstalled.accessTokenEnc).toBeNull();
    await expect(getAccessToken(t.deps, storeId)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const again = await me(sessionToken(SHOP, '100'));
    expect(again.statusCode).toBe(200);
    expect(again.json().current).toMatchObject({ storeId, role: 'OWNER' });
    expect(await t.deps.rawDb.auditLog.count({ where: { action: 'store.reinstalled' } })).toBe(1);
  });

  it('refreshes an expiring access token once, even under concurrency', async () => {
    const storeId = await installShop(t, SHOP);
    expect(await getAccessToken(t.deps, storeId)).toBe('shpat_test_1');

    await t.deps.rawDb.store.update({ where: { id: storeId }, data: { accessTokenExpiresAt: new Date(Date.now() + 60_000) } });
    const tokens = await Promise.all([getAccessToken(t.deps, storeId), getAccessToken(t.deps, storeId), getAccessToken(t.deps, storeId)]);
    expect(new Set(tokens)).toEqual(new Set(['shpat_test_2']));
    const [refresh] = t.shopify.tokenRequests('refresh_token');
    expect(refresh?.body.refresh_token).toBe('shprt_test_1');
    expect(t.shopify.tokenRequests('refresh_token')).toHaveLength(1);
  });

  it('requires re-authorization when the refresh token has expired', async () => {
    const storeId = await installShop(t, SHOP);
    await t.deps.rawDb.store.update({
      where: { id: storeId },
      data: { accessTokenExpiresAt: new Date(0), refreshTokenExpiresAt: new Date(Date.now() - 1) },
    });
    await expect(getAccessToken(t.deps, storeId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
