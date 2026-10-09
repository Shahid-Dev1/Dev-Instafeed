import { METRICS, type BreakdownRow, type Metrics, type ReportQuery, type Summary } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { Prisma } from '../../generated/prisma/client.js';

const sums = Prisma.raw(METRICS.map((m) => `COALESCE(SUM("${m}"), 0)::bigint AS "${m}"`).join(', '));
const toMetrics = (r: Record<string, unknown>): Metrics => Object.fromEntries(METRICS.map((m) => [m, Number(r[m] ?? 0)])) as Metrics;
const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : 0);

async function storeInfo(deps: Deps, storeId: string) {
  const [store, settings] = await Promise.all([
    deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true, currency: true } }),
    deps.db.storeSettings.findUnique({ where: { storeId } }),
  ]);
  return { tz: store.timezone || 'UTC', currency: store.currency, windowDays: settings?.attributionWindowDays ?? 7 };
}

const statFilter = (storeId: string, q: ReportQuery) =>
  Prisma.sql`"storeId" = ${storeId} AND "date" BETWEEN ${q.from}::date AND ${q.to}::date ${q.widgetId ? Prisma.sql`AND "widgetId" = ${q.widgetId}` : Prisma.empty}`;

/** Orders are bucketed by their creation day in the store timezone (timestamps are stored as UTC). */
const orderFilter = (storeId: string, q: ReportQuery, tz: string) =>
  Prisma.sql`o."storeId" = ${storeId} AND o."cancelledAt" IS NULL AND o."test" = false
    AND (o."createdAtShopify" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date BETWEEN ${q.from}::date AND ${q.to}::date`;

export async function summary(deps: Deps, storeId: string, q: ReportQuery): Promise<Summary> {
  const { tz, currency, windowDays } = await storeInfo(deps, storeId);
  const [m] = await deps.rawDb.$queryRaw<Record<string, unknown>[]>`SELECT ${sums} FROM "DailyStat" WHERE ${statFilter(storeId, q)}`;
  const widget = q.widgetId ? Prisma.sql`AND o."attributedWidgetId" = ${q.widgetId}` : Prisma.empty;
  const [o] = await deps.rawDb.$queryRaw<Record<string, bigint>[]>`
    SELECT COUNT(*)::bigint AS "storeOrders", COALESCE(SUM(o."totalMinor"), 0)::bigint AS "storeRevenue",
      COUNT(*) FILTER (WHERE o."attribution" = 'DIRECT' ${widget})::bigint AS "directOrders",
      COALESCE(SUM(o."attributedMinor") FILTER (WHERE o."attribution" = 'DIRECT' ${widget}), 0)::bigint AS "directRevenue",
      COUNT(*) FILTER (WHERE o."attribution" = 'ASSISTED' ${widget})::bigint AS "assistedOrders",
      COALESCE(SUM(o."totalMinor") FILTER (WHERE o."attribution" = 'ASSISTED' ${widget}), 0)::bigint AS "assistedRevenue"
    FROM "Order" o WHERE ${orderFilter(storeId, q, tz)}`;
  const metrics = toMetrics(m ?? {});
  const orders = Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, Number(v)])) as Summary['orders'];
  return {
    currency,
    timezone: tz,
    attributionWindowDays: windowDays,
    metrics,
    orders,
    rates: {
      engagementRate: rate(metrics.videoOpens, metrics.widgetImpressions),
      ctr: rate(metrics.productClicks, metrics.videoOpens),
      addToCartRate: rate(metrics.addToCarts, metrics.productClicks),
      conversionRate: rate(orders.directOrders, metrics.videoOpens),
    },
  };
}

export async function timeseries(deps: Deps, storeId: string, q: ReportQuery) {
  const { tz } = await storeInfo(deps, storeId);
  const stats = await deps.rawDb.$queryRaw<Record<string, unknown>[]>`
    SELECT to_char("date", 'YYYY-MM-DD') AS "date", ${sums} FROM "DailyStat" WHERE ${statFilter(storeId, q)} GROUP BY "date"`;
  const widget = q.widgetId ? Prisma.sql`AND o."attributedWidgetId" = ${q.widgetId}` : Prisma.empty;
  const orders = await deps.rawDb.$queryRaw<{ date: string; directOrders: bigint; directRevenue: bigint }[]>`
    SELECT to_char((o."createdAtShopify" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS "date",
      COUNT(*)::bigint AS "directOrders", COALESCE(SUM(o."attributedMinor"), 0)::bigint AS "directRevenue"
    FROM "Order" o WHERE ${orderFilter(storeId, q, tz)} AND o."attribution" = 'DIRECT' ${widget} GROUP BY 1`;
  const byDay = new Map(stats.map((s) => [s.date as string, toMetrics(s)]));
  const ordersByDay = new Map(orders.map((r) => [r.date, r]));
  // Every day in range is present (zeros included) so charts don't skip gaps.
  const days = [];
  for (let d = new Date(`${q.from}T00:00:00Z`); d <= new Date(`${q.to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const o = ordersByDay.get(key);
    days.push({ date: key, ...(byDay.get(key) ?? toMetrics({})), directOrders: Number(o?.directOrders ?? 0), directRevenue: Number(o?.directRevenue ?? 0) });
  }
  return { days };
}

export type Dimension = 'videos' | 'products' | 'widgets';
const DIM_COL: Record<Dimension, string> = { videos: 'videoId', products: 'productId', widgets: 'widgetId' };

export async function breakdown(deps: Deps, storeId: string, q: ReportQuery, dim: Dimension, limit = 50): Promise<BreakdownRow[]> {
  const { tz } = await storeInfo(deps, storeId);
  const col = Prisma.raw(`"${DIM_COL[dim]}"`);
  const rows = await deps.rawDb.$queryRaw<Record<string, unknown>[]>`
    SELECT ${col} AS "id", ${sums} FROM "DailyStat" WHERE ${statFilter(storeId, q)} AND ${col} <> '' GROUP BY ${col}`;
  const widget = q.widgetId ? Prisma.sql`AND o."attributedWidgetId" = ${q.widgetId}` : Prisma.empty;
  const revenue =
    dim === 'products'
      ? await deps.rawDb.$queryRaw<{ id: string; directOrders: bigint; directRevenue: bigint }[]>`
          SELECT l->>'productId' AS "id", COUNT(DISTINCT o."id")::bigint AS "directOrders", COALESCE(SUM((l->>'amountMinor')::bigint), 0)::bigint AS "directRevenue"
          FROM "Order" o, jsonb_array_elements(o."attributedLines") l
          WHERE ${orderFilter(storeId, q, tz)} AND o."attribution" = 'DIRECT' ${widget} GROUP BY 1`
      : await deps.rawDb.$queryRaw<{ id: string; directOrders: bigint; directRevenue: bigint }[]>`
          SELECT ${Prisma.raw(dim === 'videos' ? 'o."attributedVideoId"' : 'o."attributedWidgetId"')} AS "id", COUNT(*)::bigint AS "directOrders",
            COALESCE(SUM(o."attributedMinor"), 0)::bigint AS "directRevenue"
          FROM "Order" o WHERE ${orderFilter(storeId, q, tz)} AND o."attribution" = 'DIRECT' ${widget} GROUP BY 1`;
  const rev = new Map(revenue.filter((r) => r.id).map((r) => [r.id, r]));
  const ids = [...new Set([...rows.map((r) => r.id as string), ...rev.keys()])];
  const titles = new Map<string, string>(
    dim === 'videos'
      ? (await deps.db.video.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, title: true } })).map((v) => [v.id, v.title])
      : dim === 'products'
        ? (await deps.db.product.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, title: true } })).map((v) => [v.id, v.title])
        : (await deps.db.widget.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]),
  );
  const statsById = new Map(rows.map((r) => [r.id as string, toMetrics(r)]));
  return ids
    .map((id) => ({
      id,
      title: titles.get(id) ?? '(deleted)',
      ...(statsById.get(id) ?? toMetrics({})),
      directOrders: Number(rev.get(id)?.directOrders ?? 0),
      directRevenue: Number(rev.get(id)?.directRevenue ?? 0),
    }))
    .sort((a, b) => b.directRevenue - a.directRevenue || b.videoOpens - a.videoOpens || b.productClicks - a.productClicks)
    .slice(0, limit);
}

/** RFC 4180 CSV; cells that spreadsheets would execute as formulas are neutralized with a leading quote. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n') + '\r\n';
}
