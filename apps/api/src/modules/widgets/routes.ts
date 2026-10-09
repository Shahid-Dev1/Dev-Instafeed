import { createWidgetSchema, updateWidgetSchema } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { getOnboarding } from './onboarding.js';
import { buildPayload, createWidget, draftOf, loadWidget, publishWidget, toWidgetDto, unpublishWidget, updateWidget } from './service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
const previewQuery = z.object({ productId: z.string().max(64).optional() });

export function widgetRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const read = { preHandler: [authenticate(deps), requireRole('ANALYST')] };
    const write = { preHandler: [authenticate(deps), requireRole('EDITOR')] };

    app.get('/api/v1/onboarding', read, async (req) => getOnboarding(deps, storeCtx(req).storeId));

    app.get('/api/v1/widgets', read, async (req) => {
      const { storeId } = storeCtx(req);
      const rows = await deps.db.widget.findMany({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
        include: { videos: { orderBy: { position: 'asc' }, select: { videoId: true } } },
      });
      return { items: rows.map(toWidgetDto) };
    });

    app.post('/api/v1/widgets', write, async (req, reply) => {
      const { storeId } = storeCtx(req);
      const { name, type } = validate(createWidgetSchema, req.body);
      return reply.code(201).send({ widget: toWidgetDto(await createWidget(deps, storeId, name, type)) });
    });

    app.get('/api/v1/widgets/:id', read, async (req) => {
      const { storeId } = storeCtx(req);
      return { widget: toWidgetDto(await loadWidget(deps, storeId, validate(idParams, req.params).id)) };
    });

    app.patch('/api/v1/widgets/:id', write, async (req) => {
      const { storeId } = storeCtx(req);
      const { id } = validate(idParams, req.params);
      return { widget: toWidgetDto(await updateWidget(deps, storeId, id, validate(updateWidgetSchema, req.body))) };
    });

    app.delete('/api/v1/widgets/:id', write, async (req) => {
      const { storeId } = storeCtx(req);
      const { id } = validate(idParams, req.params);
      const res = await deps.db.widget.deleteMany({ where: { storeId, id } });
      if (!res.count) throw new AppError('NOT_FOUND', 'Widget not found');
      return { ok: true };
    });

    app.post('/api/v1/widgets/:id/publish', write, async (req) => {
      const { storeId } = storeCtx(req);
      return { widget: toWidgetDto(await publishWidget(deps, storeId, validate(idParams, req.params).id)) };
    });

    app.post('/api/v1/widgets/:id/unpublish', write, async (req) => {
      const { storeId } = storeCtx(req);
      return { widget: toWidgetDto(await unpublishWidget(deps, storeId, validate(idParams, req.params).id)) };
    });

    /** Draft preview payload, rendered in the dashboard by the same renderer the storefront uses. */
    app.get('/api/v1/widgets/:id/preview', read, async (req) => {
      const { storeId } = storeCtx(req);
      const { id } = validate(idParams, req.params);
      const { productId } = validate(previewQuery, req.query);
      return { payload: await buildPayload(deps, storeId, draftOf(await loadWidget(deps, storeId, id)), { productId }) };
    });
  };
}
