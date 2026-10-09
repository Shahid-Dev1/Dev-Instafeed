'use client';

import { breakdownSchema, hasRole, meSchema, summarySchema, timeseriesSchema, widgetListSchema, type BreakdownRow, type Role, type Summary, type WidgetDto } from '@instafeed/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { clientApi, clientDownload, errorMessage } from '../../lib/client';
import { BarChart } from './BarChart';
import { formatInt, formatMoney, formatPct } from './format';

type Days = z.infer<typeof timeseriesSchema>['days'];
const CHART_METRICS = {
  videoOpens: 'Video opens',
  productClicks: 'Product clicks',
  addToCarts: 'Add to carts',
  directRevenue: 'Attributed revenue',
} as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 150 }}>
      <div style={{ color: '#52514e', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
      {hint && <div style={{ color: '#52514e', fontSize: 12 }}>{hint}</div>}
    </div>
  );
}

export function AnalyticsDashboard() {
  const [range, setRange] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const [widgetId, setWidgetId] = useState('');
  const [widgets, setWidgets] = useState<WidgetDto[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState<Days>([]);
  const [tables, setTables] = useState<Record<'videos' | 'products' | 'widgets', BreakdownRow[]>>({ videos: [], products: [], widgets: [] });
  const [metric, setMetric] = useState<keyof typeof CHART_METRICS>('videoOpens');
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = useMemo(() => new URLSearchParams({ ...range, ...(widgetId ? { widgetId } : {}) }).toString(), [range, widgetId]);

  useEffect(() => {
    clientApi('/api/v1/widgets', widgetListSchema).then((r) => setWidgets(r.items), () => undefined);
    clientApi('/api/v1/me', meSchema).then((m) => setRole(m.current?.role ?? null), () => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, t, v, p, w] = await Promise.all([
        clientApi(`/api/v1/analytics/summary?${qs}`, summarySchema),
        clientApi(`/api/v1/analytics/timeseries?${qs}`, timeseriesSchema),
        clientApi(`/api/v1/analytics/videos?${qs}`, breakdownSchema),
        clientApi(`/api/v1/analytics/products?${qs}`, breakdownSchema),
        clientApi(`/api/v1/analytics/widgets?${qs}`, breakdownSchema),
      ]);
      setSummary(s);
      setDays(t.days);
      setTables({ videos: v.rows, products: p.rows, widgets: w.rows });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [qs]);
  useEffect(() => void load(), [load]);

  async function saveWindow(days: number) {
    try {
      await clientApi('/api/v1/settings/attribution', z.object({ attributionWindowDays: z.number() }), { method: 'PATCH', body: JSON.stringify({ attributionWindowDays: days }) });
      void load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const download = (report: string) => clientDownload(`/api/v1/analytics/export.csv?${qs}&report=${report}`, `instafeed-${report}-${range.from}-to-${range.to}.csv`).catch((e: unknown) => setError(errorMessage(e)));

  const money = (n: number) => formatMoney(n, summary?.currency ?? null);
  const fmtFor = (m: keyof typeof CHART_METRICS) => (m === 'directRevenue' ? money : formatInt);

  return (
    <section>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {[7, 30, 90].map((n) => (
          <button key={n} onClick={() => setRange({ from: daysAgo(n - 1), to: daysAgo(0) })} aria-pressed={range.from === daysAgo(n - 1) && range.to === daysAgo(0)}>Last {n} days</button>
        ))}
        <label>From <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} /></label>
        <label>To <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} /></label>
        <select value={widgetId} onChange={(e) => setWidgetId(e.target.value)} aria-label="Widget filter">
          <option value="">All widgets</option>
          {widgets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {!summary ? <p>Loading…</p> : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Tile label="Attributed revenue" value={money(summary.orders.directRevenue)} hint={`${formatInt(summary.orders.directOrders)} direct orders`} />
            <Tile label="Assisted orders" value={formatInt(summary.orders.assistedOrders)} hint={money(summary.orders.assistedRevenue)} />
            <Tile label="Store revenue" value={money(summary.orders.storeRevenue)} hint={`${formatInt(summary.orders.storeOrders)} orders`} />
            <Tile label="Video opens" value={formatInt(summary.metrics.videoOpens)} hint={`${formatPct(summary.rates.engagementRate)} of widget views`} />
            <Tile label="Product clicks" value={formatInt(summary.metrics.productClicks)} hint={`CTR ${formatPct(summary.rates.ctr)}`} />
            <Tile label="Add to carts" value={formatInt(summary.metrics.addToCarts)} hint={`${formatPct(summary.rates.addToCartRate)} of clicks`} />
            <Tile label="Checkouts started" value={formatInt(summary.metrics.checkoutStarts)} />
            <Tile label="Conversion" value={formatPct(summary.rates.conversionRate)} hint="direct orders / video opens" />
          </div>
          <p>
            <label>Chart: <select value={metric} onChange={(e) => setMetric(e.target.value as keyof typeof CHART_METRICS)}>
              {Object.entries(CHART_METRICS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>{' '}
            <button onClick={() => void download('daily')}>Export daily CSV</button>
          </p>
          <BarChart title={CHART_METRICS[metric]} points={days.map((d) => ({ date: d.date, value: d[metric] }))} format={fmtFor(metric)} />
          <p><small>
            Times in {summary.timezone}. Attribution: an order counts as <strong>direct</strong> when a product added to cart from a video is purchased within {summary.attributionWindowDays} days;
            <strong> assisted</strong> when the shopper watched videos but bought other products. Cancelled and test orders are excluded.
            {role && hasRole(role, 'ADMIN') && (
              <> Window: <select value={summary.attributionWindowDays} onChange={(e) => void saveWindow(Number(e.target.value))} aria-label="Attribution window">
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select></>
            )}
          </small></p>
          {(['videos', 'products', 'widgets'] as const).map((dim) => (
            <section key={dim}>
              <h3 style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>Top {dim} <button onClick={() => void download(dim)}>Export CSV</button></h3>
              {tables[dim].length === 0 ? <p><small>No data for this period yet.</small></p> : (
                <table cellPadding={4} style={{ background: '#fff', width: '100%' }}>
                  <thead><tr>
                    <th align="left">{dim === 'widgets' ? 'Widget' : dim === 'videos' ? 'Video' : 'Product'}</th>
                    {dim !== 'products' && <th align="right">Opens</th>}
                    <th align="right">Clicks</th><th align="right">Add to carts</th><th align="right">Orders</th><th align="right">Revenue</th>
                  </tr></thead>
                  <tbody>{tables[dim].slice(0, 10).map((r) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      {dim !== 'products' && <td align="right">{formatInt(r.videoOpens)}</td>}
                      <td align="right">{formatInt(r.productClicks)}</td>
                      <td align="right">{formatInt(r.addToCarts)}</td>
                      <td align="right">{formatInt(r.directOrders)}</td>
                      <td align="right">{money(r.directRevenue)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </section>
          ))}
        </>
      )}
    </section>
  );
}
