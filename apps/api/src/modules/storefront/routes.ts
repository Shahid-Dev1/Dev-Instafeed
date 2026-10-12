import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { normalizeShopDomain } from '../shopify/shop-domain.js';
import { verifyProxySignature } from './proxy-signature.js';
import { resolveStorefront } from './resolve.js';

const pageQuery = {
  /** Explicit widget ids from theme app blocks. */
  ids: z.string().max(400).optional(),
  /** "1" when the app embed asks for floating widgets matching this page. */
  embed: z.enum(['0', '1']).optional(),
  page_type: z.string().max(40).default('other'),
  path: z.string().max(500).default('/'),
  product_id: z.string().regex(/^\d{1,20}$/).optional(),
  collection: z.string().max(100).optional(),
};
const proxyQuery = z.object({ shop: z.string(), ...pageQuery });
const headlessQuery = z.object(pageQuery);

/**
 * Public storefront data. On Shopify domains it goes through the App Proxy (/apps/instafeed/*), where trust comes
 * from the proxy signature. Headless storefronts use /public/v1/:publicKey/widgets, allowed only from the store's
 * authorized domains (CORS). Responses never contain credentials.
 */
export function storefrontRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.get('/proxy/widgets', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!verifyProxySignature(req.url.split('?')[1] ?? '', deps.env.SHOPIFY_API_SECRET)) throw new AppError('UNAUTHENTICATED', 'Invalid proxy signature');
      const q = validate(proxyQuery, req.query);
      const shop = normalizeShopDomain(q.shop);
      const store = shop ? await deps.rawDb.store.findUnique({ where: { shopDomain: shop }, select: { id: true, uninstalledAt: true } }) : null;
      if (!store || store.uninstalledAt) return reply.header('cache-control', 'no-store').send({ widgets: [] });
      // Short shared caching keeps storefront load low while publishes still appear within a minute.
      return reply.header('cache-control', 'public, max-age=60').send(await resolveStorefront(deps, store.id, q));
    });

    app.get('/public/v1/:publicKey/widgets', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { publicKey } = validate(z.object({ publicKey: z.string().regex(/^[a-f0-9]{32}$/) }), req.params);
      const store = await deps.rawDb.store.findUnique({ where: { publicKey }, select: { id: true, uninstalledAt: true } });
      const origin = req.headers.origin;
      const settings = store ? await deps.db.storeSettings.findUnique({ where: { storeId: store.id }, select: { authorizedDomains: true } }) : null;
      if (!store || store.uninstalledAt || !origin || !settings?.authorizedDomains.includes(origin)) {
        throw new AppError('FORBIDDEN', 'This domain is not authorized to load widgets');
      }
      return reply
        .header('access-control-allow-origin', origin)
        .header('vary', 'Origin')
        .header('cache-control', 'public, max-age=60')
        .send(await resolveStorefront(deps, store.id, validate(headlessQuery, req.query)));
    });
  };
}
