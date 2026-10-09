import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';
import { createDeps } from '../src/lib/deps-factory.js';
import { TEST_SHOPIFY, testEnv } from './env.js';

export const ORIGIN = 'http://localhost:3000';

/** In-memory stand-in for Shopify's HTTP API, used only in tests at the fetch boundary. */
export class FakeShopify {
  calls: { url: string; body: Record<string, unknown> }[] = [];
  tokenCounter = 0;
  failTokenExchange = false;
  shopNames: Record<string, string> = {};

  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    this.calls.push({ url, body });
    const shop = new URL(url).hostname;
    if (url.endsWith('/admin/oauth/access_token')) {
      if (this.failTokenExchange) return new Response('{"error":"invalid_subject_token"}', { status: 400 });
      const n = ++this.tokenCounter;
      return Response.json({
        access_token: `shpat_test_${n}`,
        scope: 'read_products,read_orders,read_themes',
        expires_in: 3600,
        refresh_token: `shprt_test_${n}`,
        refresh_token_expires_in: 7_776_000,
      });
    }
    if (url.includes('/graphql.json')) {
      return Response.json({ data: { shop: { name: this.shopNames[shop] ?? shop, currencyCode: 'INR', ianaTimezone: 'Asia/Kolkata' } } });
    }
    return new Response('not found', { status: 404 });
  };

  tokenRequests(grant: string) {
    return this.calls.filter((c) => c.url.endsWith('/access_token') && c.body.grant_type === grant);
  }
}

export interface TestContext {
  deps: Deps;
  app: FastifyInstance;
  shopify: FakeShopify;
}

export async function createTestContext(): Promise<TestContext> {
  const shopify = new FakeShopify();
  const deps = createDeps(testEnv(), shopify.fetch);
  const app = await buildApp(deps);
  return { deps, app, shopify };
}

/** Clears all tenant and auth data (keeps seeded plans/flags) and rate-limit counters. */
export async function resetData(deps: Deps): Promise<void> {
  await deps.rawDb.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "WebhookReceipt", "Session", "Membership", "User", "Store" RESTART IDENTITY CASCADE',
  );
  const keys = await deps.redis.keys('rl:*');
  if (keys.length) await deps.redis.del(...keys);
}

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Signs an App Bridge-style session token with the test secret. */
export function sessionToken(shop: string, sub: string, overrides: Record<string, unknown> = {}, secret = TEST_SHOPIFY.apiSecret): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: TEST_SHOPIFY.apiKey,
    sub,
    exp: now + 60,
    nbf: now - 1,
    iat: now - 1,
    jti: crypto.randomUUID(),
    sid: 'sid',
    ...overrides,
  });
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function webhookHeaders(topic: string, shop: string, body: string, id: string = crypto.randomUUID(), secret = TEST_SHOPIFY.apiSecret) {
  return {
    'content-type': 'application/json',
    'x-shopify-topic': topic,
    'x-shopify-shop-domain': shop,
    'x-shopify-webhook-id': id,
    'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64'),
  };
}

/** Registers an email user and returns their session cookie header. */
export async function registerUser(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: ORIGIN },
    payload: { email, password: 'password1234', name: email.split('@')[0] },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'ifs_session');
  return `ifs_session=${cookie!.value}`;
}

/** Installs a shop via an embedded request and returns its store id. */
export async function installShop(ctx: TestContext, shop: string, sub = '1'): Promise<string> {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${sessionToken(shop, sub)}` } });
  if (res.statusCode !== 200) throw new Error(`install failed: ${res.body}`);
  return res.json().current.storeId as string;
}
