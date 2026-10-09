import { customCssSchema, INTEGRATION_KINDS, saveIntegrationSchema } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { listIntegrations, logIntegration, runIntegrationTest, saveIntegration } from './service.js';

const kindParams = z.object({ kind: z.enum(INTEGRATION_KINDS) });

export function integrationRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const admin = { preHandler: [authenticate(deps), requireRole('ADMIN')] };

    app.get('/api/v1/integrations', admin, async (req) => ({ items: await listIntegrations(deps, storeCtx(req).storeId) }));

    app.put('/api/v1/integrations/:kind', admin, async (req) => {
      const ctx = storeCtx(req);
      const { kind } = validate(kindParams, req.params);
      await saveIntegration(deps, ctx.storeId, kind, validate(saveIntegrationSchema, req.body));
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'integration.saved', target: kind, ip: req.ip });
      return { items: await listIntegrations(deps, ctx.storeId) };
    });

    app.post('/api/v1/integrations/:kind/test', admin, async (req) => {
      const ctx = storeCtx(req);
      const { kind } = validate(kindParams, req.params);
      return runIntegrationTest(deps, ctx.storeId, kind);
    });

    app.delete('/api/v1/integrations/:kind', admin, async (req) => {
      const ctx = storeCtx(req);
      const { kind } = validate(kindParams, req.params);
      const res = await deps.db.integration.deleteMany({ where: { storeId: ctx.storeId, kind } });
      if (!res.count) throw new AppError('NOT_FOUND', 'Integration is not connected');
      await logIntegration(deps, ctx.storeId, kind, 'info', 'Disconnected');
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'integration.disconnected', target: kind, ip: req.ip });
      return { ok: true };
    });

    app.get('/api/v1/settings/custom-css', admin, async (req) => {
      const s = await deps.db.storeSettings.findUnique({ where: { storeId: storeCtx(req).storeId } });
      return { customCss: s?.customCss ?? '' };
    });

    app.put('/api/v1/settings/custom-css', admin, async (req) => {
      const ctx = storeCtx(req);
      const { customCss } = validate(z.object({ customCss: customCssSchema }).strict(), req.body);
      await deps.db.storeSettings.upsert({ where: { storeId: ctx.storeId }, create: { storeId: ctx.storeId, customCss }, update: { customCss } });
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'settings.custom_css', meta: { length: customCss.length }, ip: req.ip });
      return { customCss };
    });
  };
}
