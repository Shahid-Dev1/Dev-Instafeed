import { aiWidgetRequestSchema } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { loadWidget } from '../widgets/service.js';
import { AI_MODEL, suggestWidgetConfig } from './widget-assistant.js';

export function aiRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    /** Returns a suggested config for preview only; the merchant saves it through the normal widget update. */
    app.post('/api/v1/widgets/:id/ai', { preHandler: [authenticate(deps), requireRole('EDITOR')] }, async (req) => {
      const ctx = storeCtx(req);
      const { id } = validate(z.object({ id: z.string().min(1).max(64) }), req.params);
      const { prompt, config } = validate(aiWidgetRequestSchema, req.body);
      const widget = await loadWidget(deps, ctx.storeId, id);
      const result = await suggestWidgetConfig(deps, ctx.storeId, widget, config, prompt);
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'ai.widget_suggestion', target: id, meta: { model: AI_MODEL, changes: result.changes.length }, ip: req.ip });
      return result;
    });
  };
}
