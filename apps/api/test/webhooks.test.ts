import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { createTestContext, installShop, resetData, webhookHeaders, type TestContext } from './helpers.js';

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
beforeEach(() => resetData(t.deps));
afterAll(() => closeDeps(t.deps));

const SHOP = 'hooks.myshopify.com';
const send = (url: string, topic: string, body: string, headers = webhookHeaders(topic, SHOP, body)) =>
  t.app.inject({ method: 'POST', url, headers, payload: body });

describe('Shopify webhooks', () => {
  it('rejects invalid signatures and missing headers', async () => {
    const body = '{"id":1}';
    const forged = webhookHeaders('app/uninstalled', SHOP, body, 'id-1', 'wrong-secret');
    expect((await send('/webhooks/shopify', 'app/uninstalled', body, forged)).statusCode).toBe(401);
    const { 'x-shopify-hmac-sha256': _omit, ...noHmac } = webhookHeaders('app/uninstalled', SHOP, body);
    expect((await send('/webhooks/shopify', 'app/uninstalled', body, noHmac as never)).statusCode).toBe(401);
    // A signature over different bytes (re-serialized JSON) must fail.
    const resigned = webhookHeaders('app/uninstalled', SHOP, '{"id": 1}');
    expect((await send('/webhooks/shopify', 'app/uninstalled', body, resigned)).statusCode).toBe(401);
  });

  it('processes a duplicate delivery only once', async () => {
    const storeId = await installShop(t, SHOP);
    const body = JSON.stringify({ domain: SHOP });
    const headers = webhookHeaders('app/uninstalled', SHOP, body, 'same-id');
    expect((await send('/webhooks/shopify', 'app/uninstalled', body, headers)).json()).toEqual({ ok: true });
    expect((await send('/webhooks/shopify', 'app/uninstalled', body, headers)).json()).toEqual({ ok: true, duplicate: true });
    expect(await t.deps.rawDb.auditLog.count({ where: { storeId, action: 'store.uninstalled' } })).toBe(1);
  });

  it('acknowledges customer data requests and redactions (no customer PII stored)', async () => {
    await installShop(t, SHOP);
    for (const topic of ['customers/data_request', 'customers/redact']) {
      const body = JSON.stringify({ shop_domain: SHOP, customer: { id: 1 } });
      expect((await send('/webhooks/shopify/compliance', topic, body)).statusCode).toBe(200);
    }
    expect(await t.deps.rawDb.auditLog.count({ where: { action: { startsWith: 'gdpr.customers' } } })).toBe(2);
  });

  it('shop/redact deletes all store data but keeps the audit trail', async () => {
    const storeId = await installShop(t, SHOP);
    const body = JSON.stringify({ shop_domain: SHOP });
    expect((await send('/webhooks/shopify/compliance', 'shop/redact', body)).statusCode).toBe(200);
    expect(await t.deps.rawDb.store.count()).toBe(0);
    expect(await t.deps.rawDb.membership.count()).toBe(0);
    const logs = await t.deps.rawDb.auditLog.findMany({ where: { action: 'store.installed' } });
    expect(logs[0]?.storeId).toBeNull();
    expect(storeId).toBeTruthy();
  });
});
