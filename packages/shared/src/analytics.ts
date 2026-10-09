import { z } from 'zod';

/** Versioned storefront event contract. Bump EVENT_SCHEMA_VERSION for breaking changes. */
export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  'widget_impression',
  'video_impression',
  'video_open',
  'video_start',
  'video_pause',
  'video_progress',
  'video_complete',
  'product_click',
  'product_popup_open',
  'variant_select',
  'add_to_cart',
  'checkout_start',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const storefrontEventSchema = z
  .object({
    v: z.literal(EVENT_SCHEMA_VERSION),
    eventId: z.uuid(),
    type: z.enum(EVENT_TYPES),
    /** Random first-party id (no PII); persisted only with analytics consent. */
    visitorId: id,
    widgetId: id.optional(),
    videoId: id.optional(),
    productId: id.optional(),
    /** Numeric Shopify variant id (Ajax API). */
    variantId: z.string().regex(/^\d{1,20}$/).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    /** Minor units (e.g. paise/cents) in the storefront's active currency. */
    value: z.number().int().min(0).max(1e10).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    /** 25 | 50 | 75 for video_progress. */
    progress: z.union([z.literal(25), z.literal(50), z.literal(75)]).optional(),
    occurredAt: z.number().int().positive(),
  })
  .strict();
export type StorefrontEvent = z.infer<typeof storefrontEventSchema>;

export const eventBatchSchema = z.object({ events: z.array(z.unknown()).min(1).max(50) });

// ---- Reports ----
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const reportQuerySchema = z
  .object({ from: day, to: day, widgetId: id.optional() })
  .refine((q) => q.from <= q.to, { message: '`from` must be on or before `to`', path: ['from'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86400000 <= 366, { message: 'Range is limited to 366 days', path: ['to'] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const METRICS = [
  'widgetImpressions', 'videoImpressions', 'videoOpens', 'videoStarts', 'videoPauses', 'videoProgress', 'videoCompletes',
  'productClicks', 'popupOpens', 'variantSelects', 'addToCarts', 'addToCartValue', 'checkoutStarts',
] as const;
export type Metric = (typeof METRICS)[number];
const metricShape = Object.fromEntries(METRICS.map((m) => [m, z.number()])) as Record<Metric, z.ZodNumber>;
export const metricsSchema = z.object(metricShape);
export type Metrics = z.infer<typeof metricsSchema>;

export const summarySchema = z.object({
  currency: z.string().nullable(),
  timezone: z.string(),
  attributionWindowDays: z.number(),
  metrics: metricsSchema,
  orders: z.object({
    storeOrders: z.number(),
    storeRevenue: z.number(),
    directOrders: z.number(),
    directRevenue: z.number(),
    assistedOrders: z.number(),
    assistedRevenue: z.number(),
  }),
  rates: z.object({ engagementRate: z.number(), ctr: z.number(), addToCartRate: z.number(), conversionRate: z.number() }),
});
export type Summary = z.infer<typeof summarySchema>;

export const timeseriesSchema = z.object({ days: z.array(metricsSchema.extend({ date: day, directRevenue: z.number(), directOrders: z.number() })) });
export const breakdownRowSchema = metricsSchema.extend({ id: z.string(), title: z.string(), directOrders: z.number(), directRevenue: z.number() });
export const breakdownSchema = z.object({ rows: z.array(breakdownRowSchema) });
export type BreakdownRow = z.infer<typeof breakdownRowSchema>;
export const REPORTS = ['daily', 'videos', 'products', 'widgets'] as const;
