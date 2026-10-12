import type { Deps } from '../../deps.js';
import type { PlanId, Subscription } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { shopifyAdmin } from '../shopify/admin.js';
import { fetchActiveSubscription, partnerConfigured } from './partner.js';
import { localDate } from '../analytics/time.js';

export type Feature = 'stories' | 'carousel' | 'floating' | 'banner' | 'grid' | 'gallery' | 'analytics' | 'integrations' | 'custom_css' | 'ai_assistant' | 'creator_accounts';
export interface Limits {
  videos: number;
  widgets: number;
  monthlyViews: number;
  storageGb: number;
}

/** Plan handles configured in the Partner Dashboard (Shopify App Pricing) → internal plans. */
const HANDLE_TO_PLAN: Record<string, PlanId> = { free: 'FREE', starter: 'STARTER', growth: 'GROWTH', pro: 'PRO' };
export const WIDGET_FEATURE: Record<string, Feature> = {
  STORIES: 'stories', CAROUSEL: 'carousel', FLOATING: 'floating', BANNER: 'banner', GRID: 'grid', PRODUCT_GALLERY: 'gallery',
};
const STALE_MS = 60 * 60_000;
const WARN_AT = 0.8;

export function planForHandles(handles: string[]): PlanId {
  // A subscription may carry several items (e.g. base + usage); the highest known plan wins.
  const order: PlanId[] = ['FREE', 'STARTER', 'GROWTH', 'PRO'];
  return handles.map((h) => HANDLE_TO_PLAN[h.toLowerCase()]).filter((p): p is PlanId => !!p).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? 'FREE';
}

async function ensureShopGid(deps: Deps, storeId: string): Promise<string> {
  const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { shopGid: true } });
  if (store.shopGid) return store.shopGid;
  const admin = await shopifyAdmin(deps, storeId);
  const { shop } = await admin.query<{ shop: { id: string } }>('query { shop { id } }');
  await deps.rawDb.store.update({ where: { id: storeId }, data: { shopGid: shop.id } });
  return shop.id;
}

/**
 * Re-reads the subscription from the Partner API (idempotent: safe to call on every redirect, page view or schedule).
 * Plan changes, cancellations, freezes and failed renewals all surface here as the new active state (or null).
 */
/** Development-only plan override when billing is not configured; never applies in production. */
const devPlan = (deps: Deps): PlanId | undefined => (deps.env.NODE_ENV !== 'production' && !partnerConfigured(deps) ? deps.env.BILLING_DEV_PLAN : undefined);

export async function syncSubscription(deps: Deps, storeId: string): Promise<Subscription> {
  const previous = await deps.db.subscription.findUnique({ where: { storeId } });
  if (!partnerConfigured(deps)) {
    const planId = devPlan(deps) ?? previous?.planId ?? 'FREE';
    return deps.db.subscription.upsert({ where: { storeId }, create: { storeId, planId, status: 'UNKNOWN', checkedAt: new Date() }, update: { planId, checkedAt: new Date() } });
  }
  const active = await fetchActiveSubscription(deps, await ensureShopGid(deps, storeId));
  const handles = active?.items.map((i) => i.handle) ?? [];
  const data = active
    ? {
        planId: planForHandles(handles),
        status: 'ACTIVE',
        planHandle: handles[0] ?? null,
        billingPeriod: active.billingPeriod,
        currentPeriodEnd: active.currentBillingCycle ? new Date(active.currentBillingCycle.endTime) : null,
        trialEndsAt: active.trialEndsAt ? new Date(active.trialEndsAt) : null,
        cancelAtEndOfCycle: active.cancelAtEndOfCycle,
        pendingPlanHandle: active.pendingUpdate?.items[0]?.handle ?? null,
      }
    : { planId: 'FREE' as const, status: 'NONE', planHandle: null, billingPeriod: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtEndOfCycle: false, pendingPlanHandle: null };
  const sub = await deps.db.subscription.upsert({ where: { storeId }, create: { storeId, ...data, checkedAt: new Date() }, update: { ...data, checkedAt: new Date() } });
  if ((previous?.planId ?? 'FREE') !== sub.planId) {
    await audit(deps.rawDb, { storeId, actorType: 'SHOPIFY', action: 'billing.plan_changed', meta: { from: previous?.planId ?? 'FREE', to: sub.planId, status: sub.status } });
  }
  return sub;
}

export async function currentSubscription(deps: Deps, storeId: string, opts: { refresh?: boolean } = {}): Promise<Subscription> {
  const sub = await deps.db.subscription.findUnique({ where: { storeId } });
  const stale = !sub?.checkedAt || Date.now() - sub.checkedAt.getTime() > STALE_MS;
  if (opts.refresh || (stale && partnerConfigured(deps))) {
    try {
      return await syncSubscription(deps, storeId);
    } catch (err) {
      // Partner API outage: keep the last known plan rather than downgrading anyone.
      if (sub) return sub;
      if (!(err instanceof AppError)) throw err;
    }
  }
  return sub ?? deps.db.subscription.create({ data: { storeId, planId: devPlan(deps) ?? 'FREE', status: partnerConfigured(deps) ? 'NONE' : 'UNKNOWN' } });
}

/** Usage in the current calendar month (store timezone): video views = player opens; storage = hosted bytes. */
export async function usage(deps: Deps, storeId: string) {
  const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true } });
  const monthStart = `${localDate(new Date(), store.timezone).slice(0, 7)}-01`;
  const [views] = await deps.rawDb.$queryRaw<{ n: bigint | null }[]>`
    SELECT SUM("videoOpens")::bigint AS n FROM "DailyStat" WHERE "storeId" = ${storeId} AND "date" >= ${monthStart}::date`;
  const [videos, widgets, storage] = await Promise.all([
    deps.db.video.count({ where: { storeId } }),
    deps.db.widget.count({ where: { storeId } }),
    deps.db.video.aggregate({ where: { storeId, bunnyVideoId: { not: null } }, _sum: { bytes: true } }),
  ]);
  return { videos, widgets, monthlyViews: Number(views?.n ?? 0), storageGb: Number(storage._sum.bytes ?? 0n) / 1024 ** 3 };
}

export async function entitlements(deps: Deps, storeId: string) {
  const sub = await currentSubscription(deps, storeId);
  const plan = await deps.rawDb.plan.findUniqueOrThrow({ where: { id: sub.planId } });
  const limits = plan.limits as unknown as Limits;
  const used = await usage(deps, storeId);
  const graceEndsAt = sub.overLimitSince ? new Date(sub.overLimitSince.getTime() + deps.env.BILLING_GRACE_DAYS * 86_400_000) : null;
  const warnings = (Object.keys(limits) as (keyof Limits)[])
    .filter((k) => used[k] >= limits[k] * WARN_AT)
    .map((k) => ({ metric: k, used: used[k], limit: limits[k], level: used[k] >= limits[k] ? ('over' as const) : ('warning' as const) }));
  return {
    subscription: sub,
    plan: { id: plan.id, name: plan.name, priceMonthlyUsd: plan.priceMonthlyUsd },
    limits,
    features: plan.features as Feature[],
    usage: used,
    warnings,
    graceEndsAt,
    paused: !!graceEndsAt && graceEndsAt < new Date(),
  };
}

export async function assertFeature(deps: Deps, storeId: string, feature: Feature) {
  const e = await entitlements(deps, storeId);
  if (!e.features.includes(feature)) throw new AppError('PLAN_LIMIT', `Your ${e.plan.name} plan does not include this feature. Upgrade to unlock it.`, { feature, plan: e.plan.id });
}

/** Server-side quota check before creating videos/widgets or uploading (never trust the UI). */
export async function assertWithinLimit(deps: Deps, storeId: string, metric: 'videos' | 'widgets' | 'storageGb', adding = 1) {
  const e = await entitlements(deps, storeId);
  if (e.usage[metric] + adding > e.limits[metric]) {
    const label = { videos: 'videos', widgets: 'widgets', storageGb: 'GB of video storage' }[metric];
    throw new AppError('PLAN_LIMIT', `Your ${e.plan.name} plan allows ${e.limits[metric]} ${label}. Upgrade to add more.`, { metric, limit: e.limits[metric], used: e.usage[metric] });
  }
}

/**
 * Hourly: starts the grace period when monthly views pass the plan limit, and clears it when usage is back
 * under (new month or upgrade). After the grace period the storefront stops serving widgets.
 */
export async function checkUsage(deps: Deps, storeId: string) {
  const e = await entitlements(deps, storeId);
  const over = e.usage.monthlyViews > e.limits.monthlyViews;
  if (over && !e.subscription.overLimitSince) {
    await deps.db.subscription.update({ where: { storeId }, data: { overLimitSince: new Date() } });
    await audit(deps.rawDb, { storeId, actorType: 'SYSTEM', action: 'billing.over_limit', meta: { views: e.usage.monthlyViews, limit: e.limits.monthlyViews } });
  } else if (!over && e.subscription.overLimitSince) {
    await deps.db.subscription.update({ where: { storeId }, data: { overLimitSince: null } });
  }
  return over;
}

