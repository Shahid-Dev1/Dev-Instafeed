import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps.js';
import { Prisma } from '../../generated/prisma/client.js';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { enqueueProductRefresh } from '../products/jobs.js';
import { productGid } from '../products/shopify-products.js';
import { normalizeShopDomain } from '../shopify/shop-domain.js';

type Tx = Prisma.TransactionClient;
/** Runs inside the receipt transaction; may return work (e.g. enqueueing) to run only after commit. */
type Handler = (tx: Tx, shop: string, payload: Record<string, unknown>, deps: Deps) => Promise<void | (() => Promise<void>)>;

async function activeStoreId(tx: Tx, shop: string): Promise<string | null> {
  const store = await tx.store.findUnique({ where: { shopDomain: shop }, select: { id: true, uninstalledAt: true } });
  return store && !store.uninstalledAt ? store.id : null;
}

/** products/create|update: re-fetch from GraphQL rather than trusting the REST-shaped payload. */
const productChanged: Handler = async (tx, shop, payload, deps) => {
  const storeId = await activeStoreId(tx, shop);
  const gid = typeof payload.admin_graphql_api_id === 'string' ? payload.admin_graphql_api_id : null;
  if (!storeId || !gid) return;
  const updatedAt = typeof payload.updated_at === 'string' ? payload.updated_at : new Date().toISOString();
  return () => enqueueProductRefresh(deps, storeId, gid, updatedAt);
};

const handlers: Record<string, Handler> = {
  'products/create': productChanged,
  'products/update': productChanged,
  'products/delete': async (tx, shop, payload) => {
    const storeId = await activeStoreId(tx, shop);
    if (!storeId || (typeof payload.id !== 'number' && typeof payload.id !== 'string')) return;
    await tx.product.updateMany({ where: { storeId, shopifyId: productGid(payload.id), deletedAt: null }, data: { deletedAt: new Date() } });
  },
  'app/uninstalled': async (tx, shop) => {
    const store = await tx.store.findUnique({ where: { shopDomain: shop } });
    if (!store) return;
    await tx.store.update({
      where: { id: store.id },
      data: { uninstalledAt: new Date(), accessTokenEnc: null, accessTokenExpiresAt: null, refreshTokenEnc: null, refreshTokenExpiresAt: null },
    });
    await tx.session.deleteMany({ where: { storeId: store.id } });
    await audit(tx, { storeId: store.id, actorType: 'SHOPIFY', action: 'store.uninstalled' });
  },
  'app/scopes_update': async (tx, shop, payload) => {
    const current = Array.isArray(payload.current) ? payload.current.join(',') : null;
    if (current !== null) await tx.store.updateMany({ where: { shopDomain: shop }, data: { scopes: current } });
  },
  // We store no customer personal data (events use random session ids), so there is nothing to export or redact.
  'customers/data_request': async (tx, shop) => {
    const store = await tx.store.findUnique({ where: { shopDomain: shop } });
    await audit(tx, { storeId: store?.id ?? null, actorType: 'SHOPIFY', action: 'gdpr.customers_data_request', meta: { shop, customerDataStored: false } });
  },
  'customers/redact': async (tx, shop) => {
    const store = await tx.store.findUnique({ where: { shopDomain: shop } });
    await audit(tx, { storeId: store?.id ?? null, actorType: 'SHOPIFY', action: 'gdpr.customers_redact', meta: { shop, customerDataStored: false } });
  },
  // Sent 48h after uninstall: delete all store data (cascades to every tenant table).
  'shop/redact': async (tx, shop) => {
    const deleted = await tx.store.deleteMany({ where: { shopDomain: shop } });
    await audit(tx, { storeId: null, actorType: 'SHOPIFY', action: 'gdpr.shop_redact', meta: { shop, deleted: deleted.count } });
  },
};

export function webhookRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    // HMAC must be computed over the exact bytes Shopify sent.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    const receive = async (req: FastifyRequest) => {
      const raw = req.body;
      if (!Buffer.isBuffer(raw)) throw new AppError('VALIDATION_ERROR', 'Expected JSON body');
      const hmac = req.headers['x-shopify-hmac-sha256'];
      if (typeof hmac !== 'string' || !safeEqual(hmacSha256(deps.env.SHOPIFY_API_SECRET, raw).toString('base64'), hmac)) {
        throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature');
      }
      const topic = String(req.headers['x-shopify-topic'] ?? '');
      const webhookId = String(req.headers['x-shopify-webhook-id'] ?? '');
      const shop = normalizeShopDomain(String(req.headers['x-shopify-shop-domain'] ?? ''));
      if (!topic || !webhookId || !shop) throw new AppError('VALIDATION_ERROR', 'Missing webhook headers');

      const handler = handlers[topic];
      if (!handler) {
        req.log.warn({ topic }, 'unhandled webhook topic');
        return { ok: true };
      }
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Invalid JSON');
      }

      let afterCommit: void | (() => Promise<void>);
      try {
        // Receipt and side effects commit together: a failed handler leaves no receipt, so Shopify's retry is processed.
        afterCommit = await deps.rawDb.$transaction(async (tx) => {
          await tx.webhookReceipt.create({ data: { webhookId, topic, shopDomain: shop } });
          return handler(tx, shop, payload, deps);
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { ok: true, duplicate: true };
        throw err;
      }
      if (afterCommit) {
        try {
          await afterCommit();
        } catch (err) {
          // Receipt already committed: drop it so Shopify's retry runs the handler again.
          await deps.rawDb.webhookReceipt.deleteMany({ where: { webhookId } });
          throw err;
        }
      }
      return { ok: true };
    };

    app.post('/webhooks/shopify', receive);
    app.post('/webhooks/shopify/compliance', receive);
  };
}
