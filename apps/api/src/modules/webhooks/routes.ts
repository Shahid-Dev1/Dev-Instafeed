import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps.js';
import { Prisma } from '../../generated/prisma/client.js';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { normalizeShopDomain } from '../shopify/shop-domain.js';

type Tx = Prisma.TransactionClient;
type Handler = (tx: Tx, shop: string, payload: Record<string, unknown>) => Promise<void>;

const handlers: Record<string, Handler> = {
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

      try {
        // Receipt and side effects commit together: a failed handler leaves no receipt, so Shopify's retry is processed.
        await deps.rawDb.$transaction(async (tx) => {
          await tx.webhookReceipt.create({ data: { webhookId, topic, shopDomain: shop } });
          await handler(tx, shop, payload);
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { ok: true, duplicate: true };
        throw err;
      }
      return { ok: true };
    };

    app.post('/webhooks/shopify', receive);
    app.post('/webhooks/shopify/compliance', receive);
  };
}
