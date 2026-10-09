import { productListQuerySchema, type ProductDetail, type ProductSummary, type SyncRunDto } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import type { Product, SyncRun, Variant } from '../../generated/prisma/client.js';
import { AppError, validate } from '../../lib/errors.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { enqueueFullSync } from './jobs.js';

const toSummary = (p: Product): ProductSummary => ({
  id: p.id,
  shopifyId: p.shopifyId,
  handle: p.handle,
  title: p.title,
  status: p.status,
  imageUrl: p.imageUrl,
  priceMin: p.priceMin?.toFixed(2) ?? null,
  priceMax: p.priceMax?.toFixed(2) ?? null,
  totalVariants: p.totalVariants,
});

const toVariant = (v: Variant) => ({
  id: v.id,
  shopifyId: v.shopifyId,
  title: v.title,
  sku: v.sku,
  price: v.price.toFixed(2),
  availableForSale: v.availableForSale,
  options: v.options as { name: string; value: string }[],
  imageUrl: v.imageUrl,
});

export const toSyncRun = (r: SyncRun): SyncRunDto => ({
  id: r.id,
  status: r.status,
  trigger: r.trigger,
  upserted: r.upserted,
  deleted: r.deleted,
  error: r.error,
  startedAt: r.startedAt?.toISOString() ?? null,
  finishedAt: r.finishedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export function productRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const read = { preHandler: [authenticate(deps), requireRole('ANALYST')] };
    const write = { preHandler: [authenticate(deps), requireRole('EDITOR')] };

    app.get('/api/v1/products', read, async (req) => {
      const { storeId } = storeCtx(req);
      const { q, status, cursor, limit } = validate(productListQuerySchema, req.query);
      const rows = await deps.db.product.findMany({
        where: {
          storeId,
          deletedAt: null,
          ...(status ? { status } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' as const } },
                  { handle: { contains: q, mode: 'insensitive' as const } },
                  { variants: { some: { storeId, sku: { contains: q, mode: 'insensitive' as const } } } },
                ],
              }
            : {}),
        },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const items = rows.slice(0, limit);
      return { items: items.map(toSummary), nextCursor: rows.length > limit ? items.at(-1)!.id : null };
    });

    app.get('/api/v1/products/sync/status', read, async (req) => {
      const { storeId } = storeCtx(req);
      const run = await deps.db.syncRun.findFirst({ where: { storeId, kind: 'PRODUCTS_FULL' }, orderBy: { createdAt: 'desc' } });
      return { syncRun: run ? toSyncRun(run) : null };
    });

    app.post('/api/v1/products/sync', write, async (req, reply) => {
      const { storeId } = storeCtx(req);
      return reply.code(202).send({ syncRun: toSyncRun(await enqueueFullSync(deps, storeId, 'MANUAL')) });
    });

    app.get('/api/v1/products/:id', read, async (req): Promise<ProductDetail> => {
      const { storeId } = storeCtx(req);
      const { id } = validate(z.object({ id: z.string().min(1).max(64) }), req.params);
      const product = await deps.db.product.findFirst({
        where: { storeId, id, deletedAt: null },
        include: { variants: { where: { storeId }, orderBy: { position: 'asc' } } },
      });
      if (!product) throw new AppError('NOT_FOUND', 'Product not found');
      return { ...toSummary(product), variants: product.variants.map(toVariant) };
    });
  };
}
