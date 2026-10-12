import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { entitlements, syncSubscription } from './entitlements.js';
import { partnerConfigured, planSelectionUrl } from './partner.js';

export function billingRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const read = { preHandler: [authenticate(deps), requireRole('ANALYST')] };

    app.get('/api/v1/billing', read, async (req) => {
      const { storeId, role } = storeCtx(req);
      const e = await entitlements(deps, storeId);
      const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { shopDomain: true } });
      const plans = await deps.rawDb.plan.findMany({ orderBy: { priceMonthlyUsd: 'asc' } });
      const s = e.subscription;
      return {
        configured: partnerConfigured(deps),
        plan: e.plan,
        status: s.status,
        billingPeriod: s.billingPeriod,
        currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
        trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
        cancelAtEndOfCycle: s.cancelAtEndOfCycle,
        pendingPlanHandle: s.pendingPlanHandle,
        checkedAt: s.checkedAt?.toISOString() ?? null,
        limits: e.limits,
        features: e.features,
        usage: e.usage,
        warnings: e.warnings,
        graceEndsAt: e.graceEndsAt?.toISOString() ?? null,
        paused: e.paused,
        plans: plans.map((p) => ({ id: p.id, name: p.name, priceMonthlyUsd: p.priceMonthlyUsd, limits: p.limits, features: p.features })),
        // Only the owner manages billing; upgrades, downgrades and cancellation happen on Shopify's page.
        manageUrl: role === 'OWNER' ? planSelectionUrl(deps, store.shopDomain) : null,
      };
    });

    /** Called after Shopify's welcome redirect (?plan_handle=…) and by "Refresh": the Partner API decides, not the URL. */
    app.post('/api/v1/billing/sync', { ...read, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const sub = await syncSubscription(deps, storeCtx(req).storeId);
      return { planId: sub.planId, status: sub.status };
    });
  };
}
