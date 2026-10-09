# Analytics and attribution

## Event contract (v1)
Defined in `packages/shared/src/analytics.ts` (`storefrontEventSchema`, strict). Fields: `v` (=1), `eventId` (UUID, dedupe key), `type`, `visitorId` (random first-party id, no PII), optional `widgetId`, `videoId`, `productId`, `variantId`, `quantity`, `value` (minor units), `currency`, `progress` (25/50/75), `occurredAt` (ms).

| Type | Emitted when |
|---|---|
| widget_impression | A widget renders on a page |
| video_impression | A video card is ≥50% visible (once per page view) |
| video_open | A shopper opens the player |
| video_start / video_pause / video_progress / video_complete | Playback events (hosted video; embeds report start only) |
| product_click | Shop Now / product CTA clicked |
| product_popup_open / variant_select | Product popup interactions |
| add_to_cart | Successful `/cart/add.js` from a widget (value = variant price × quantity) |
| checkout_start | Web Pixel `checkout_started` for carts tagged with `_ifv` |

## Pipeline
1. **Storefront:** the SDK batches events (every 4s or 50 events; `sendBeacon` on page hide) to `POST /apps/instafeed/events`, which goes through the Shopify App Proxy with a verified signature. Nothing is sent when Shopify's Customer Privacy API reports that analytics is not allowed.
2. **API:** validates the batch envelope, enqueues it (`analytics` queue) and returns 202.
3. **Worker** (`ingestEvents`):
   - Validates each event, dropping invalid ones and any that don't use schema version 1.
   - Nulls widget, video or product ids that don't belong to the store.
   - Clamps client timestamps to [received − 7d, received + 5m].
   - Inserts raw rows with `skipDuplicates`, which dedupes on `(storeId, eventId)`.
   - Increments `DailyStat` only for newly inserted rows, using an atomic `INSERT … ON CONFLICT DO UPDATE`, so retries never double count.
4. Days are bucketed in the **store's timezone** (from Shopify). Add-to-cart value counts toward totals only when it is in the shop currency.

## Attribution
- After a widget Add to Cart, the SDK sets the hidden cart attribute `_ifv = visitorId` (only with consent). Shopify copies it to the order's `note_attributes`.
- The `orders/create` webhook (HMAC-verified, deduplicated) stores the order once per `(store, order id)`. Amounts are in shop-currency minor units using the ISO exponent (INR 2, JPY 0, KWD 3), and line amounts are net of line discounts.
- An `attribute-order` job runs 30s later so in-flight events can land. It looks at that visitor's engagement events in **[order time − window, order time + 10 min]**. The window is set per store (1–30 days, default 7) at `PATCH /api/v1/settings/attribution`.
  - **DIRECT:** an ordered product was added to cart from a widget. Attributed revenue is the sum of the matching line items. The widget and video credited are those of the latest matching add-to-cart (last touch).
  - **ASSISTED:** there was video engagement, but no ordered product was added from a widget. It is counted separately and is never part of direct revenue.
  - **NONE:** no visitor id, or no engagement in the window.
- Re-running attribution is idempotent. `orders/cancelled` marks the order cancelled. Cancelled and test orders are excluded from all reports.
- **Total store revenue** (all non-test, non-cancelled orders) is shown next to attributed revenue for context.

## Metrics
| Rate | Definition |
|---|---|
| Engagement rate | video opens ÷ widget impressions |
| CTR | product clicks ÷ video opens |
| Add-to-cart rate | add to carts ÷ product clicks |
| Conversion rate | direct orders ÷ video opens |

## Known limitations
- Checkout starts depend on the Web Pixel. It needs the `write_pixels` and `read_customer_events` scopes and is activated automatically after install. Pixel requests can't be signed, so the endpoint only accepts visitors already seen in that store, is rate-limited, and is deduplicated.
- Embedded third-party players (YouTube, TikTok, Instagram) don't expose progress events to us, so only opens and starts are counted for them.
- Orders placed without the cart attribute (other devices, cleared storage, no consent) can't be attributed.
