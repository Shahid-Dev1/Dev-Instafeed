import { defaultWidgetConfig } from '@instafeed/shared';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { TEST_SHOPIFY } from './env.js';
import { createTestContext, installShop, ORIGIN, registerUser, resetData, sessionToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let t: Ctx;
beforeAll(async () => (t = await createTestContext({ ANTHROPIC_API_KEY: 'sk-ant-test' })));
afterAll(() => closeDeps(t.deps));

const SHOP = 'integrations.myshopify.com';
let storeId: string;
const req = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object, shop = SHOP) =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${sessionToken(shop, '1')}` }, ...(payload ? { payload } : {}) });
const item = async (kind: string) => (await req('GET', '/api/v1/integrations')).json().items.find((i: { kind: string }) => i.kind === kind);

beforeEach(async () => {
  await resetData(t.deps);
  t.providers.reset();
  storeId = await installShop(t, SHOP);
});

describe('integrations', () => {
  it('validates, stores secrets encrypted and never returns them', async () => {
    const bad = await req('PUT', '/api/v1/integrations/GA4', { enabled: true, publicConfig: { measurementId: 'UA-123', sendVia: 'gtag' }, events: ['video_open'] });
    expect(bad.statusCode).toBe(400);
    const ok = await req('PUT', '/api/v1/integrations/GA4', { enabled: true, publicConfig: { measurementId: 'G-ABC1234', sendVia: 'gtag' }, secrets: { apiSecret: 'super-secret-value' }, events: ['video_open', 'add_to_cart'] });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain('super-secret-value');
    const ga = await item('GA4');
    expect(ga).toMatchObject({ connected: true, enabled: true, secretsSet: ['apiSecret'], status: 'NOT_TESTED' });
    const row = await t.deps.db.integration.findFirstOrThrow({ where: { storeId, kind: 'GA4' } });
    expect(row.secretsEnc).not.toContain('super-secret-value');

    // Omitted secrets are kept; null clears them.
    await req('PUT', '/api/v1/integrations/GA4', { enabled: true, publicConfig: { measurementId: 'G-ABC1234', sendVia: 'gtm' }, events: ['video_open'] });
    expect((await item('GA4')).secretsSet).toEqual(['apiSecret']);
    await req('PUT', '/api/v1/integrations/GA4', { enabled: true, publicConfig: { measurementId: 'G-ABC1234', sendVia: 'gtm' }, secrets: null, events: [] });
    expect((await item('GA4')).secretsSet).toEqual([]);
    expect((await req('PUT', '/api/v1/integrations/GA4', { enabled: true, publicConfig: { measurementId: 'G-ABC1234', sendVia: 'gtag' }, events: ['checkout_start'] })).statusCode).toBe(400);
  });

  it.each([
    ['GA4', { measurementId: 'G-ABC1234', sendVia: 'gtag' }, { apiSecret: 'abcdefghijkl' }, 'www.google-analytics.com'],
    ['META', { pixelId: '123456789012345' }, { accessToken: 'EAAB'.padEnd(30, 'x'), testEventCode: 'TEST12345' }, 'graph.facebook.com'],
    ['MIXPANEL', { token: 'a'.repeat(32), region: 'eu' }, {}, 'api-eu.mixpanel.com'],
    ['CLEVERTAP', { accountId: 'W9R-486-4W5Z', region: 'in1' }, { passcode: 'secret-pass' }, 'in1.api.clevertap.com'],
  ])('%s test event: success, failure and error log', async (kind, publicConfig, secrets, host) => {
    await req('PUT', `/api/v1/integrations/${kind}`, { enabled: true, publicConfig, secrets, events: ['video_open'] });
    const ok = (await req('POST', `/api/v1/integrations/${kind}/test`)).json();
    expect(ok.ok).toBe(true);
    expect(t.providers.callsTo(host)).toHaveLength(1);
    expect((await item(kind)).status).toBe('OK');
    t.providers.integrationsFail = true;
    const fail = (await req('POST', `/api/v1/integrations/${kind}/test`)).json();
    expect(fail.ok).toBe(false);
    const after = await item(kind);
    expect(after).toMatchObject({ status: 'ERROR', lastError: fail.message });
    expect(after.logs[0]).toMatchObject({ level: 'error' });
  });

  it('GTM and secret-less destinations validate configuration without network calls', async () => {
    await req('PUT', '/api/v1/integrations/GTM', { enabled: true, publicConfig: { containerId: 'GTM-ABC123' }, events: ['video_open'] });
    expect((await req('POST', '/api/v1/integrations/GTM/test')).json()).toMatchObject({ ok: true });
    expect(t.providers.calls).toHaveLength(0);
  });

  it('serves only public ids of enabled destinations to the storefront, plus validated custom CSS', async () => {
    await req('PUT', '/api/v1/integrations/META', { enabled: true, publicConfig: { pixelId: '123456789012345' }, secrets: { accessToken: 'EAAB'.padEnd(30, 'z') }, events: ['add_to_cart'] });
    await req('PUT', '/api/v1/integrations/MIXPANEL', { enabled: false, publicConfig: { token: 'b'.repeat(32), region: 'us' }, events: ['video_open'] });
    expect((await req('PUT', '/api/v1/settings/custom-css', { customCss: '@import url(https://evil.example/x.css);' })).statusCode).toBe(400);
    expect((await req('PUT', '/api/v1/settings/custom-css', { customCss: '.if-card { border-radius: 24px; }' })).statusCode).toBe(200);
    const params = { shop: SHOP, timestamp: '1' };
    const msg = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join('');
    const qs = new URLSearchParams({ ...params, signature: createHmac('sha256', TEST_SHOPIFY.apiSecret).update(msg).digest('hex') });
    const body = (await t.app.inject({ method: 'GET', url: `/proxy/widgets?${qs}` })).json();
    expect(body.integrations).toEqual({ META: { config: { pixelId: '123456789012345' }, events: ['add_to_cart'] } });
    expect(body.customCss).toBe('.if-card { border-radius: 24px; }');
    expect(JSON.stringify(body)).not.toContain('EAAB');
  });

  it('disconnects, isolates stores and requires admin', async () => {
    await req('PUT', '/api/v1/integrations/GTM', { enabled: true, publicConfig: { containerId: 'GTM-ABC123' }, events: [] });
    await installShop(t, 'other-int.myshopify.com');
    expect((await req('GET', '/api/v1/integrations', undefined, 'other-int.myshopify.com')).json().items.every((i: { connected: boolean }) => !i.connected)).toBe(true);
    expect((await req('DELETE', '/api/v1/integrations/GTM', undefined, 'other-int.myshopify.com')).statusCode).toBe(404);
    const cookie = await registerUser(t.app, 'editor@int.co');
    const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'editor@int.co' } });
    await t.deps.db.membership.create({ data: { storeId, userId: user.id, role: 'EDITOR' } });
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/integrations', headers: { cookie, origin: ORIGIN, 'x-store-id': storeId } })).statusCode).toBe(403);
    expect((await req('DELETE', '/api/v1/integrations/GTM')).statusCode).toBe(200);
    expect((await item('GTM')).connected).toBe(false);
  });
});

describe('AI widget assistant', () => {
  let widgetId: string;
  const config = defaultWidgetConfig('CAROUSEL');
  const ask = (prompt: string, cfg: object = config) => req('POST', `/api/v1/widgets/${widgetId}/ai`, { prompt, config: cfg });

  beforeEach(async () => {
    widgetId = (await req('POST', '/api/v1/widgets', { name: 'Carousel', type: 'CAROUSEL' })).json().widget.id;
  });

  it('is off until the feature flag is enabled', async () => {
    expect((await ask('make the cards rounder')).statusCode).toBe(403);
  });

  it('returns a validated suggestion with a change list, without saving it', async () => {
    await t.deps.rawDb.featureFlag.create({ data: { key: 'ai_assistant', storeId, enabled: true } });
    const suggested = { ...config, style: { ...config.style, cardRadius: 24, accentColor: '#d6336c' }, cta: { ...config.cta, label: 'Buy now' } };
    t.providers.aiOutput = { config: suggested, summary: 'Rounder cards, pink buttons, "Buy now" label.' };
    const res = await ask('Make cards rounder, buttons pink and say Buy now');
    expect(res.statusCode).toBe(200);
    expect(res.json().changes).toEqual([
      { path: 'style.accentColor', from: '#111111', to: '#d6336c' },
      { path: 'style.cardRadius', from: 12, to: 24 },
      { path: 'cta.label', from: 'Shop now', to: 'Buy now' },
    ]);
    const sent = JSON.parse(t.providers.callsTo('api.anthropic.com')[0]!.body!);
    expect(sent).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low', format: { type: 'json_schema' } } });
    expect((await req('GET', `/api/v1/widgets/${widgetId}`)).json().widget.config.style.cardRadius).toBe(12);
    expect(await t.deps.rawDb.auditLog.count({ where: { action: 'ai.widget_suggestion' } })).toBe(1);
  });

  it('rejects out-of-schema output, refusals and invalid input', async () => {
    await t.deps.rawDb.featureFlag.create({ data: { key: 'ai_assistant', storeId, enabled: true } });
    t.providers.aiOutput = { config: { ...config, script: 'alert(1)' }, summary: 'x' };
    expect((await ask('add a script')).statusCode).toBe(502);
    t.providers.aiOutput = { config: { ...config, style: { ...config.style, accentColor: 'red' } }, summary: 'x' };
    expect((await ask('make it red')).statusCode).toBe(502);
    t.providers.aiOutput = 'refusal';
    expect((await ask('something disallowed')).json().error.message).toMatch(/could not help/);
    expect((await ask('x')).statusCode).toBe(400);
    expect((await ask('make it pink', { bogus: true })).statusCode).toBe(400);
  });

  it('enforces an hourly per-store quota', async () => {
    await t.deps.rawDb.featureFlag.create({ data: { key: 'ai_assistant', storeId, enabled: true } });
    t.providers.aiOutput = { config, summary: 'No change' };
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await ask('keep it the same')).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it('reports not configured without an API key', async () => {
    const bare = await createTestContext({ ANTHROPIC_API_KEY: undefined });
    try {
      const sid = await installShop(bare, 'bare-ai.myshopify.com');
      await bare.deps.rawDb.featureFlag.create({ data: { key: 'ai_assistant', storeId: sid, enabled: true } });
      const h = { authorization: `Bearer ${sessionToken('bare-ai.myshopify.com', '1')}` };
      const w = (await bare.app.inject({ method: 'POST', url: '/api/v1/widgets', headers: h, payload: { name: 'x', type: 'GRID' } })).json().widget;
      const res = await bare.app.inject({ method: 'POST', url: `/api/v1/widgets/${w.id}/ai`, headers: h, payload: { prompt: 'make it nicer', config: defaultWidgetConfig('GRID') } });
      expect(res.statusCode).toBe(503);
    } finally {
      await closeDeps(bare.deps);
    }
  });
});
