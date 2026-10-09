import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';
import { createDeps } from '../src/lib/deps-factory.js';
import { TEST_SHOPIFY, testEnv } from './env.js';
import { FakeProviders } from './fake-providers.js';

export const ORIGIN = 'http://localhost:3000';

/** In-memory stand-in for Shopify's HTTP API, used only in tests at the fetch boundary. */
export interface FakeVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  position: number;
  selectedOptions: { name: string; value: string }[];
  image: null;
}

export interface FakeProduct {
  id: string;
  handle: string;
  title: string;
  status: string;
  updatedAt: string;
  imageUrl: string | null;
  variants: FakeVariant[];
}

export function fakeProduct(n: number, variantCount = 2, overrides: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id: `gid://shopify/Product/${n}`,
    handle: `product-${n}`,
    title: `Product ${String(n).padStart(3, '0')}`,
    status: 'ACTIVE',
    updatedAt: '2026-10-01T00:00:00Z',
    imageUrl: `https://cdn.shopify.com/p${n}.jpg`,
    variants: Array.from({ length: variantCount }, (_, i) => ({
      id: `gid://shopify/ProductVariant/${n * 1000 + i}`,
      title: `Size ${i}`,
      sku: `SKU-${n}-${i}`,
      price: (10 + i).toFixed(2),
      availableForSale: i % 2 === 0,
      position: i + 1,
      selectedOptions: [{ name: 'Size', value: String(i) }],
      image: null,
    })),
    ...overrides,
  };
}

/** Pages a list the way Shopify connections do, using the item index as an opaque cursor. */
function connection<T>(items: T[], first: number, after: string | null | undefined) {
  const start = after ? Number(after) + 1 : 0;
  const nodes = items.slice(start, start + first);
  const end = start + nodes.length - 1;
  return { nodes, pageInfo: { hasNextPage: end < items.length - 1, endCursor: nodes.length ? String(end) : null } };
}

export class FakeShopify {
  calls: { url: string; body: Record<string, unknown> }[] = [];
  tokenCounter = 0;
  failTokenExchange = false;
  shopNames: Record<string, string> = {};
  /** Catalog per shop domain. */
  catalogs: Record<string, FakeProduct[]> = {};
  /** Number of upcoming GraphQL calls to answer with a THROTTLED error. */
  throttleNext = 0;
  /** Main theme config/settings_data.json content per shop. */
  themeSettings: Record<string, string> = {};
  /** Web pixel settings per shop (JSON string), mirroring webPixel / webPixelCreate / webPixelUpdate. */
  pixels: Record<string, string> = {};

  private productNode(p: FakeProduct) {
    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      status: p.status,
      updatedAt: p.updatedAt,
      featuredMedia: p.imageUrl ? { preview: { image: { url: p.imageUrl } } } : null,
      variants: connection(p.variants, 50, null),
    };
  }

  private graphql(shop: string, query: string, vars: Record<string, unknown>) {
    const catalog = this.catalogs[shop] ?? [];
    const find = () => catalog.find((p) => p.id === vars.id);
    if (query.includes('MainThemeSettings')) {
      const content = this.themeSettings[shop];
      return { themes: { nodes: [{ files: { nodes: content ? [{ body: { content } }] : [] } }] } };
    }
    if (query.includes('query Products(')) {
      const page = connection(catalog, Number(vars.first), vars.after as string | null);
      return { products: { pageInfo: page.pageInfo, nodes: page.nodes.map((p) => this.productNode(p)) } };
    }
    if (query.includes('query ProductVariants(')) {
      const p = find();
      return { product: p ? { variants: connection(p.variants, 100, vars.after as string) } : null };
    }
    if (query.includes('query Product(')) {
      const p = find();
      return { product: p ? this.productNode(p) : null };
    }
    return { shop: { name: this.shopNames[shop] ?? shop, currencyCode: 'INR', ianaTimezone: 'Asia/Kolkata' } };
  }

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
      if (this.throttleNext > 0) {
        this.throttleNext--;
        return Response.json({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: { cost: { requestedQueryCost: 520, throttleStatus: { currentlyAvailable: 20, restoreRate: 100 } } },
        });
      }
      const q = String(body.query);
      const vars = (body.variables ?? {}) as Record<string, string>;
      if (q.includes('webPixelCreate') || q.includes('webPixelUpdate')) {
        const op = q.includes('webPixelCreate') ? 'webPixelCreate' : 'webPixelUpdate';
        if (op === 'webPixelCreate' && this.pixels[shop]) return Response.json({ data: { [op]: { userErrors: [{ code: 'TAKEN', message: 'Pixel already exists' }], webPixel: null } } });
        this.pixels[shop] = vars.settings!;
        return Response.json({ data: { [op]: { userErrors: [], webPixel: { id: 'gid://shopify/WebPixel/1' } } } });
      }
      if (q.includes('webPixel {')) {
        return this.pixels[shop]
          ? Response.json({ data: { webPixel: { id: 'gid://shopify/WebPixel/1', settings: this.pixels[shop] } } })
          : Response.json({ errors: [{ message: 'No web pixel was found for this app.' }] });
      }
      return Response.json({ data: this.graphql(shop, q, vars) });
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

export async function createTestContext(envOverrides: Record<string, string | undefined> = {}): Promise<TestContext & { sleeps: number[]; providers: FakeProviders }> {
  const shopify = new FakeShopify();
  const providers = new FakeProviders();
  const sleeps: number[] = [];
  const route: typeof fetch = (input, init) =>
    new URL(String(input)).hostname.endsWith('.myshopify.com') ? shopify.fetch(input, init) : providers.fetch(input, init);
  const deps = { ...createDeps(testEnv(envOverrides), route), sleep: async (ms: number) => void sleeps.push(ms) };
  const app = await buildApp(deps);
  return { deps, app, shopify, sleeps, providers };
}

/** Clears all tenant and auth data (keeps seeded plans/flags) and rate-limit counters. */
export async function resetData(deps: Deps): Promise<void> {
  await deps.rawDb.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "WebhookReceipt", "Session", "Membership", "User", "Store" RESTART IDENTITY CASCADE',
  );
  await deps.queues.products.obliterate({ force: true });
  await deps.queues.videos.obliterate({ force: true });
  await deps.queues.analytics.obliterate({ force: true });
  await deps.rawDb.featureFlag.deleteMany({ where: { storeId: { not: null } } });
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
