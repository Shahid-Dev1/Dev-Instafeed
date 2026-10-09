import { storefrontEventSchema, type EventType, type StorefrontEvent } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { Prisma } from '../../generated/prisma/client.js';
import { localDate } from './time.js';

const COLUMN: Record<EventType, string> = {
  widget_impression: 'widgetImpressions',
  video_impression: 'videoImpressions',
  video_open: 'videoOpens',
  video_start: 'videoStarts',
  video_pause: 'videoPauses',
  video_progress: 'videoProgress',
  video_complete: 'videoCompletes',
  product_click: 'productClicks',
  product_popup_open: 'popupOpens',
  variant_select: 'variantSelects',
  add_to_cart: 'addToCarts',
  checkout_start: 'checkoutStarts',
};
const COUNTERS = [...new Set(Object.values(COLUMN)), 'addToCartValue'];

const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 86_400_000;

export interface IngestResult {
  received: number;
  invalid: number;
  duplicates: number;
  inserted: number;
}

/**
 * Validates, deduplicates and stores a batch of raw events, then increments daily counters for the
 * events that were actually inserted (duplicates never double count).
 */
export async function ingestEvents(deps: Deps, storeId: string, raw: unknown[], receivedAt: Date): Promise<IngestResult> {
  const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true, currency: true } });
  const valid: StorefrontEvent[] = [];
  for (const r of raw) {
    const p = storefrontEventSchema.safeParse(r);
    if (p.success) valid.push(p.data);
  }
  if (!valid.length) return { received: raw.length, invalid: raw.length, duplicates: 0, inserted: 0 };

  // Only keep references that belong to this store; anything else is dropped rather than trusted.
  const pick = (k: 'widgetId' | 'videoId' | 'productId') => [...new Set(valid.map((e) => e[k]).filter((x): x is string => !!x))];
  const [widgets, videos, products] = await Promise.all([
    deps.db.widget.findMany({ where: { storeId, id: { in: pick('widgetId') } }, select: { id: true } }),
    deps.db.video.findMany({ where: { storeId, id: { in: pick('videoId') } }, select: { id: true } }),
    deps.db.product.findMany({ where: { storeId, id: { in: pick('productId') } }, select: { id: true } }),
  ]);
  const ok = { widgetId: new Set(widgets.map((x) => x.id)), videoId: new Set(videos.map((x) => x.id)), productId: new Set(products.map((x) => x.id)) };
  const keep = (k: keyof typeof ok, v: string | undefined) => (v && ok[k].has(v) ? v : null);

  const now = receivedAt.getTime();
  const rows = valid.map((e) => {
    // Untrusted client clocks: clamp to [received - 7d, received + 5m].
    const at = e.occurredAt > now + MAX_FUTURE_MS || e.occurredAt < now - MAX_AGE_MS ? now : e.occurredAt;
    return {
      storeId,
      eventId: e.eventId,
      v: e.v,
      type: e.type,
      visitorId: e.visitorId,
      widgetId: keep('widgetId', e.widgetId),
      videoId: keep('videoId', e.videoId),
      productId: keep('productId', e.productId),
      variantId: e.variantId ?? null,
      quantity: e.quantity ?? null,
      // Values in another presentment currency are kept raw but excluded from shop-currency totals.
      value: e.value !== undefined ? BigInt(e.value) : null,
      currency: e.currency ?? null,
      progress: e.progress ?? null,
      occurredAt: new Date(at),
      receivedAt,
    };
  });

  const inserted = await deps.db.analyticsEvent.createManyAndReturn({ data: rows, skipDuplicates: true });

  const agg = new Map<string, { key: [string, string, string, string]; counts: Record<string, bigint> }>();
  for (const e of inserted) {
    const key: [string, string, string, string] = [localDate(e.occurredAt, store.timezone), e.widgetId ?? '', e.videoId ?? '', e.productId ?? ''];
    const k = key.join('|');
    const entry = agg.get(k) ?? { key, counts: Object.fromEntries(COUNTERS.map((c) => [c, 0n])) };
    entry.counts[COLUMN[e.type as EventType]]! += 1n;
    if (e.type === 'add_to_cart' && e.value !== null && (!e.currency || e.currency === store.currency)) entry.counts.addToCartValue! += e.value;
    agg.set(k, entry);
  }
  for (const { key, counts } of agg.values()) {
    const cols = Prisma.join(COUNTERS.map((c) => Prisma.raw(`"${c}"`)));
    const vals = Prisma.join(COUNTERS.map((c) => counts[c]!));
    const updates = Prisma.raw(COUNTERS.map((c) => `"${c}" = "DailyStat"."${c}" + EXCLUDED."${c}"`).join(', '));
    await deps.rawDb.$executeRaw`
      INSERT INTO "DailyStat" ("storeId", "date", "widgetId", "videoId", "productId", ${cols})
      VALUES (${storeId}, ${key[0]}::date, ${key[1]}, ${key[2]}, ${key[3]}, ${vals})
      ON CONFLICT ("storeId", "date", "widgetId", "videoId", "productId") DO UPDATE SET ${updates}`;
  }
  return { received: raw.length, invalid: raw.length - valid.length, duplicates: valid.length - inserted.length, inserted: inserted.length };
}
