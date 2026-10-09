import { matchesTargeting, targetingSchema, widgetConfigSchema, type PageContext, type WidgetPayload } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { productGid } from '../products/shopify-products.js';
import { normalizeShopDomain } from '../shopify/shop-domain.js';
import { buildPayload } from '../widgets/service.js';
import { verifyProxySignature } from './proxy-signature.js';

const PAGE_TYPES = new Set(['index', 'product', 'collection', 'page']);

const querySchema = z.object({
  shop: z.string(),
  /** Explicit widget ids from theme app blocks. */
  ids: z.string().max(400).optional(),
  /** "1" when the app embed asks for floating widgets matching this page. */
  embed: z.enum(['0', '1']).optional(),
  page_type: z.string().max(40).default('other'),
  path: z.string().max(500).default('/'),
  product_id: z.string().regex(/^\d{1,20}$/).optional(),
  collection: z.string().max(100).optional(),
});

export interface StorefrontWidget {
  placement: 'block' | 'embed';
  payload: WidgetPayload;
}

/**
 * Public storefront data via the Shopify App Proxy (/apps/instafeed/*). Trust comes only from the proxy
 * signature; responses contain published snapshots only and never any credentials.
 */
export function storefrontRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.get(
      '/proxy/widgets',
      { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const rawQuery = req.url.split('?')[1] ?? '';
        if (!verifyProxySignature(rawQuery, deps.env.SHOPIFY_API_SECRET)) throw new AppError('UNAUTHENTICATED', 'Invalid proxy signature');
        const q = validate(querySchema, req.query);
        const shop = normalizeShopDomain(q.shop);
        const store = shop ? await deps.rawDb.store.findUnique({ where: { shopDomain: shop }, select: { id: true, uninstalledAt: true } }) : null;
        if (!store || store.uninstalledAt) return reply.header('cache-control', 'no-store').send({ widgets: [] });
        const storeId = store.id;

        const ids = (q.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const product = q.product_id
          ? await deps.db.product.findUnique({ where: { storeId_shopifyId: { storeId, shopifyId: productGid(q.product_id) } }, select: { id: true } })
          : null;
        const page: PageContext = {
          pageType: (PAGE_TYPES.has(q.page_type) ? q.page_type : 'other') as PageContext['pageType'],
          path: q.path,
          productId: product?.id ?? null,
          collectionHandle: q.collection ?? null,
        };

        const rows = await deps.db.widget.findMany({
          where: { storeId, status: 'PUBLISHED', OR: [{ id: { in: ids } }, ...(q.embed === '1' ? [{ type: 'FLOATING' as const }] : [])] },
          orderBy: { publishedAt: 'desc' },
        });
        const taggedVideoIds = product
          ? new Set((await deps.db.videoProduct.findMany({ where: { storeId, productId: product.id }, select: { videoId: true } })).map((t) => t.videoId))
          : new Set<string>();

        const widgets: StorefrontWidget[] = [];
        for (const w of rows) {
          const config = widgetConfigSchema.parse(w.publishedConfig);
          const placement = ids.includes(w.id) ? 'block' : 'embed';
          if (placement === 'embed') {
            const targeting = targetingSchema.parse(w.publishedTargeting);
            const productTagged = w.publishedVideoIds.some((id) => taggedVideoIds.has(id));
            if (!matchesTargeting(targeting, { ...page, productTagged })) continue;
          }
          const payload = await buildPayload(deps, storeId, { id: w.id, type: w.type, version: w.publishedVersion ?? w.version, config, videoIds: w.publishedVideoIds }, { productId: product?.id });
          if (payload.videos.length) widgets.push({ placement, payload });
        }
        // Short shared caching keeps storefront load low while publishes still appear within a minute.
        return reply.header('cache-control', 'public, max-age=60').send({ widgets });
      },
    );
  };
}
