'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { clientApi, errorMessage, openTopLevel } from '../../lib/client';

const limitsSchema = z.object({ videos: z.number(), widgets: z.number(), monthlyViews: z.number(), storageGb: z.number() });
const billingSchema = z.object({
  configured: z.boolean(),
  plan: z.object({ id: z.string(), name: z.string(), priceMonthlyUsd: z.number() }),
  status: z.string(),
  currentPeriodEnd: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  cancelAtEndOfCycle: z.boolean(),
  pendingPlanHandle: z.string().nullable(),
  limits: limitsSchema,
  features: z.array(z.string()),
  usage: limitsSchema,
  warnings: z.array(z.object({ metric: z.string(), used: z.number(), limit: z.number(), level: z.enum(['warning', 'over']) })),
  graceEndsAt: z.string().nullable(),
  paused: z.boolean(),
  plans: z.array(z.object({ id: z.string(), name: z.string(), priceMonthlyUsd: z.number(), limits: limitsSchema, features: z.array(z.string()) })),
  manageUrl: z.string().nullable(),
});
export type Billing = z.infer<typeof billingSchema>;
export const loadBilling = () => clientApi('/api/v1/billing', billingSchema);

const LABEL: Record<string, string> = { videos: 'Videos', widgets: 'Widgets', monthlyViews: 'Video views this month', storageGb: 'Hosted storage (GB)' };
const fmt = (n: number, k: string) => (k === 'storageGb' ? n.toFixed(2) : new Intl.NumberFormat().format(n));

/** Usage banner for the home page: warnings at 80%, over-limit grace period and pause. */
export function UsageBanner({ billingHref }: { billingHref: string }) {
  const [b, setB] = useState<Billing | null>(null);
  useEffect(() => void loadBilling().then(setB, () => undefined), []);
  if (!b || (!b.warnings.length && !b.paused)) return null;
  return (
    <p role="alert" style={{ background: b.paused ? '#fee4e2' : '#fef0c7', padding: 12, borderRadius: 8 }}>
      {b.paused
        ? 'Your widgets are paused because this month’s video views exceeded your plan. '
        : b.graceEndsAt
          ? `You’re over your plan’s video views. Widgets keep running until ${new Date(b.graceEndsAt).toLocaleDateString()}. `
          : `You’ve used ${b.warnings.map((w) => `${Math.round((w.used / w.limit) * 100)}% of ${LABEL[w.metric]?.toLowerCase()}`).join(', ')}. `}
      <a href={billingHref}>See plans</a>
    </p>
  );
}

export function BillingPanel() {
  const [b, setB] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => loadBilling().then(setB, (e: unknown) => setError(errorMessage(e))), []);
  useEffect(() => void load(), [load]);

  async function refresh() {
    try {
      await clientApi('/api/v1/billing/sync', z.object({ planId: z.string() }), { method: 'POST' });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (error) return <p role="alert">{error}</p>;
  if (!b) return <p>Loading…</p>;
  return (
    <section>
      <p>
        Current plan: <strong>{b.plan.name}</strong> {b.plan.priceMonthlyUsd > 0 && `($${(b.plan.priceMonthlyUsd / 100).toFixed(0)}/month)`}
        {b.trialEndsAt && ` · trial ends ${new Date(b.trialEndsAt).toLocaleDateString()}`}
        {b.currentPeriodEnd && ` · ${b.cancelAtEndOfCycle ? 'ends' : 'renews'} ${new Date(b.currentPeriodEnd).toLocaleDateString()}`}
        {b.pendingPlanHandle && ` · changes to ${b.pendingPlanHandle} next cycle`}
      </p>
      {!b.configured && <p><small>Billing isn&apos;t connected in this environment (Partner API credentials missing), so the plan shown is local.</small></p>}
      {b.paused && <p role="alert">Widgets are paused until next month or until you upgrade.</p>}
      <table cellPadding={6} style={{ background: '#fff' }}>
        <thead><tr><th align="left">Usage</th><th align="right">Used</th><th align="right">Limit</th></tr></thead>
        <tbody>
          {(Object.keys(b.limits) as (keyof Billing['limits'])[]).map((k) => {
            const w = b.warnings.find((x) => x.metric === k);
            return (
              <tr key={k}>
                <td>{LABEL[k]}</td>
                <td align="right" style={{ color: w?.level === 'over' ? '#b42318' : w ? '#b54708' : undefined }}>{fmt(b.usage[k], k)}{w && (w.level === 'over' ? ' ⚠️ over' : ' ⚠️')}</td>
                <td align="right">{fmt(b.limits[k], k)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Plans</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {b.plans.map((p) => (
          <div key={p.id} style={{ background: '#fff', border: `2px solid ${p.id === b.plan.id ? '#2a78d6' : '#ddd'}`, borderRadius: 8, padding: 12, width: 210 }}>
            <strong>{p.name}</strong> {p.id === b.plan.id && '(current)'}
            <div style={{ fontSize: 22 }}>{p.priceMonthlyUsd ? `$${(p.priceMonthlyUsd / 100).toFixed(0)}` : 'Free'}<small>{p.priceMonthlyUsd ? '/month' : ''}</small></div>
            <small>{fmt(p.limits.videos, 'videos')} videos · {fmt(p.limits.widgets, 'widgets')} widgets · {fmt(p.limits.monthlyViews, 'monthlyViews')} views/mo · {p.limits.storageGb} GB</small>
            <ul style={{ paddingLeft: 18 }}>{p.features.map((f) => <li key={f}><small>{f.replace('_', ' ')}</small></li>)}</ul>
          </div>
        ))}
      </div>
      <p>
        {b.manageUrl ? (
          <button onClick={() => openTopLevel(b.manageUrl!)}>Change or cancel plan on Shopify</button>
        ) : (
          <small>Only the store owner can change the plan.</small>
        )}{' '}
        <button onClick={() => void refresh()}>Refresh status</button>
      </p>
      <p><small>Plans are billed by Shopify. Upgrades apply immediately; downgrades and cancellations take effect as shown on Shopify&apos;s plan page.</small></p>
    </section>
  );
}
