import type { Deps } from '../../deps.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { toMinor } from './time.js';

/** Cart attribute set by the storefront after a widget Add to Cart; carries only the random visitor id. */
export const VISITOR_ATTRIBUTE = '_ifv';
const DEFAULT_WINDOW_DAYS = 7;
/** Events up to a few minutes after order creation (clock skew, queue lag) still count. */
const LATE_EVENT_GRACE_MS = 10 * 60_000;
const ENGAGEMENT = ['video_open', 'video_start', 'product_click', 'product_popup_open', 'variant_select', 'add_to_cart'];

interface Money {
  shop_money?: { amount?: string; currency_code?: string };
}
interface OrderPayload {
  id?: number | string;
  name?: string;
  created_at?: string;
  currency?: string;
  total_price?: string;
  total_price_set?: Money;
  test?: boolean;
  cancelled_at?: string | null;
  note_attributes?: { name?: string; value?: string }[];
  line_items?: {
    product_id?: number | null;
    variant_id?: number | null;
    quantity?: number;
    price?: string;
    price_set?: Money;
    discount_allocations?: { amount?: string; amount_set?: Money }[];
  }[];
}

export interface LineItem {
  productGid: string | null;
  variantGid: string | null;
  quantity: number;
  amountMinor: string;
}

/** Normalizes an orders/create payload into shop-currency minor units. Returns null if unusable. */
export function parseOrder(p: OrderPayload) {
  if (p.id === undefined || !p.created_at) return null;
  const currency = p.total_price_set?.shop_money?.currency_code ?? p.currency ?? 'USD';
  const lines: LineItem[] = (p.line_items ?? []).map((l) => {
    const unit = toMinor(l.price_set?.shop_money?.amount ?? l.price, currency);
    const discount = (l.discount_allocations ?? []).reduce((s, d) => s + toMinor(d.amount_set?.shop_money?.amount ?? d.amount, currency), 0n);
    const qty = l.quantity ?? 1;
    const amount = unit * BigInt(qty) - discount;
    return {
      productGid: l.product_id ? `gid://shopify/Product/${l.product_id}` : null,
      variantGid: l.variant_id ? `gid://shopify/ProductVariant/${l.variant_id}` : null,
      quantity: qty,
      amountMinor: (amount > 0n ? amount : 0n).toString(),
    };
  });
  const visitor = p.note_attributes?.find((a) => a.name === VISITOR_ATTRIBUTE)?.value;
  return {
    shopifyOrderId: String(p.id),
    name: p.name ?? null,
    createdAtShopify: new Date(p.created_at),
    currency,
    totalMinor: toMinor(p.total_price_set?.shop_money?.amount ?? p.total_price, currency),
    lineItems: lines as unknown as Prisma.InputJsonValue,
    visitorId: visitor && /^[A-Za-z0-9_-]{1,64}$/.test(visitor) ? visitor : null,
    test: p.test === true,
    cancelledAt: p.cancelled_at ? new Date(p.cancelled_at) : null,
  };
}

/**
 * Attribution rules (documented in docs/ANALYTICS.md):
 *  DIRECT   - the visitor added a product to cart from a widget within the window and the order contains
 *             that product; attributed revenue = those line items (after line discounts). Last touch wins.
 *  ASSISTED - the visitor engaged with videos within the window, but no ordered product was added from a widget.
 *  NONE     - no qualifying interaction (or no visitor id on the order).
 * Idempotent: re-running yields the same result; cancelled orders keep their classification but are excluded from reports.
 */
export async function attributeOrder(deps: Deps, storeId: string, orderId: string) {
  const order = await deps.db.order.findFirst({ where: { storeId, id: orderId } });
  if (!order) return null;
  const settings = await deps.db.storeSettings.findUnique({ where: { storeId } });
  const windowMs = (settings?.attributionWindowDays ?? DEFAULT_WINDOW_DAYS) * 86_400_000;
  const result = { attribution: 'NONE' as 'DIRECT' | 'ASSISTED' | 'NONE', attributedMinor: 0n, attributedWidgetId: null as string | null, attributedVideoId: null as string | null, lines: [] as { productId: string; amountMinor: string }[] };

  if (order.visitorId) {
    const events = await deps.db.analyticsEvent.findMany({
      where: {
        storeId,
        visitorId: order.visitorId,
        type: { in: ENGAGEMENT },
        occurredAt: { gte: new Date(order.createdAtShopify.getTime() - windowMs), lte: new Date(order.createdAtShopify.getTime() + LATE_EVENT_GRACE_MS) },
      },
      orderBy: { occurredAt: 'desc' },
    });
    const atc = events.filter((e) => e.type === 'add_to_cart' && e.productId);
    const lines = order.lineItems as unknown as LineItem[];
    const gids = [...new Set(lines.map((l) => l.productGid).filter((g): g is string => !!g))];
    const products = await deps.db.product.findMany({ where: { storeId, shopifyId: { in: gids } }, select: { id: true, shopifyId: true } });
    const byGid = new Map(products.map((p) => [p.shopifyId, p.id]));
    const addedIds = new Set(atc.map((e) => e.productId!));
    const matched = lines.filter((l) => l.productGid && addedIds.has(byGid.get(l.productGid) ?? ''));
    if (matched.length) {
      const productIds = new Set(matched.map((l) => byGid.get(l.productGid!)!));
      const last = atc.find((e) => productIds.has(e.productId!))!;
      result.attribution = 'DIRECT';
      result.attributedMinor = matched.reduce((s, l) => s + BigInt(l.amountMinor), 0n);
      result.attributedWidgetId = last.widgetId;
      result.attributedVideoId = last.videoId;
      result.lines = matched.map((l) => ({ productId: byGid.get(l.productGid!)!, amountMinor: l.amountMinor }));
    } else if (events.length) {
      result.attribution = 'ASSISTED';
      result.attributedWidgetId = events[0]!.widgetId;
      result.attributedVideoId = events[0]!.videoId;
    }
  }
  return deps.db.order.update({
    where: { id: order.id, storeId },
    data: {
      attribution: result.attribution,
      attributedMinor: result.attributedMinor,
      attributedWidgetId: result.attributedWidgetId,
      attributedVideoId: result.attributedVideoId,
      attributedLines: result.lines,
      attributedAt: new Date(),
    },
  });
}

/** Delay lets events from the same session land before the order is attributed. */
export const ATTRIBUTION_DELAY_MS = 30_000;

export async function enqueueAttribution(deps: Deps, storeId: string, orderId: string, delay = ATTRIBUTION_DELAY_MS) {
  await deps.queues.analytics.add('attribute-order', { storeId, orderId }, { delay, jobId: `attribute-${orderId}`, removeOnComplete: true, removeOnFail: 500, attempts: 5 });
}
