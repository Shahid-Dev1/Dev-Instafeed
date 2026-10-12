import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate } from '../auth/context.js';
import { entitlements, syncSubscription } from '../billing/entitlements.js';
import { enqueueFullSync } from '../products/jobs.js';

/**
 * Internal support console. Requires a dashboard session for a user with a PlatformRole (granted only via the
 * CLI). Every view and action is written to the store's audit log. Secrets and tokens are never exposed.
 */
export function supportRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const requireStaff = async (req: FastifyRequest) => {
      if (req.ctx?.via !== 'session') throw new AppError('FORBIDDEN', 'Support access requires a staff login');
      const role = await deps.rawDb.platformRole.findUnique({ where: { userId: req.ctx.userId } });
      if (!role) throw new AppError('FORBIDDEN', 'Support access required');
    };
    const staff = { preHandler: [authenticate(deps), requireStaff] };
    const log = (req: FastifyRequest, storeId: string | null, action: string, meta?: object) =>
      audit(deps.rawDb, { storeId, actorType: 'SUPPORT', actorId: req.ctx!.userId, action, ...(meta ? { meta: meta as never } : {}), ip: req.ip });

    app.get('/support/stores', staff, async (req) => {
      const { q } = validate(z.object({ q: z.string().trim().max(100).default('') }), req.query);
      await log(req, null, 'support.search', { q });
      const stores = await deps.rawDb.store.findMany({
        where: q ? { OR: [{ shopDomain: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {},
        select: { id: true, shopDomain: true, name: true, installedAt: true, uninstalledAt: true, subscription: { select: { planId: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return { stores };
    });

    app.get('/support/stores/:id/diagnostics', staff, async (req) => {
      const { id } = validate(z.object({ id: z.string().min(1).max(64) }), req.params);
      const store = await deps.rawDb.store.findUnique({ where: { id } });
      if (!store) throw new AppError('NOT_FOUND', 'Store not found');
      await log(req, id, 'support.view_diagnostics');
      const [ent, syncRuns, videosByStatus, widgets, integrations, webhooks, auditLog, members, queues] = await Promise.all([
        entitlements(deps, id),
        deps.db.syncRun.findMany({ where: { storeId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
        deps.db.video.groupBy({ by: ['status'], where: { storeId: id }, _count: true }),
        deps.db.widget.findMany({ where: { storeId: id }, select: { id: true, name: true, type: true, status: true, publishedAt: true } }),
        deps.db.integration.findMany({ where: { storeId: id }, select: { kind: true, enabled: true, status: true, lastError: true, lastCheckedAt: true } }),
        deps.rawDb.webhookReceipt.findMany({ where: { shopDomain: store.shopDomain }, orderBy: { receivedAt: 'desc' }, take: 20, select: { topic: true, receivedAt: true } }),
        deps.rawDb.auditLog.findMany({ where: { storeId: id }, orderBy: { createdAt: 'desc' }, take: 30, select: { action: true, actorType: true, target: true, createdAt: true } }),
        deps.db.membership.count({ where: { storeId: id } }),
        Promise.all(Object.entries(deps.queues).map(async ([name, q]) => ({ name, counts: await q.getJobCounts('waiting', 'active', 'delayed', 'failed') }))),
      ]);
      return {
        store: {
          id: store.id, shopDomain: store.shopDomain, name: store.name, currency: store.currency, timezone: store.timezone, scopes: store.scopes,
          installedAt: store.installedAt, uninstalledAt: store.uninstalledAt,
          // Token health without the tokens themselves.
          tokens: { hasOfflineToken: !!store.accessTokenEnc, accessTokenExpiresAt: store.accessTokenExpiresAt, refreshTokenExpiresAt: store.refreshTokenExpiresAt },
        },
        billing: { plan: ent.plan, status: ent.subscription.status, usage: ent.usage, limits: ent.limits, warnings: ent.warnings, paused: ent.paused, checkedAt: ent.subscription.checkedAt },
        members, syncRuns, videosByStatus, widgets, integrations, webhooks, auditLog, queues,
      };
    });

    const actionSchema = z.object({ action: z.enum(['resync_products', 'sync_billing']) }).strict();
    app.post('/support/stores/:id/actions', staff, async (req) => {
      const { id } = validate(z.object({ id: z.string().min(1).max(64) }), req.params);
      const { action } = validate(actionSchema, req.body);
      const store = await deps.rawDb.store.findUnique({ where: { id }, select: { uninstalledAt: true } });
      if (!store || store.uninstalledAt) throw new AppError('NOT_FOUND', 'Store not found or uninstalled');
      await log(req, id, `support.${action}`);
      if (action === 'resync_products') return { syncRunId: (await enqueueFullSync(deps, id, 'MANUAL')).id };
      return { planId: (await syncSubscription(deps, id)).planId };
    });
  };
}
