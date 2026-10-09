import { z } from 'zod';
import { VIDEO_SOURCES } from './videos.ts';

export const WIDGET_TYPES = ['STORIES', 'CAROUSEL', 'FLOATING', 'BANNER', 'GRID', 'PRODUCT_GALLERY'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export const FONT_FAMILIES = ['inherit', 'system', 'serif', 'mono'] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1a2b3c');
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Visual style. Every field is bounded so neither merchants nor AI output can produce broken layouts. */
export const widgetStyleSchema = z
  .object({
    title: z.string().trim().max(80),
    titleAlign: z.enum(['left', 'center']),
    fontFamily: z.enum(FONT_FAMILIES),
    titleSize: int(12, 40),
    textSize: int(10, 20),
    textColor: hex,
    background: hex,
    transparentBackground: z.boolean(),
    accentColor: hex,
    accentTextColor: hex,
    cardRadius: int(0, 40),
    borderWidth: int(0, 8),
    borderColor: hex,
    gap: int(0, 48),
    padding: int(0, 64),
  })
  .strict();

/** Per-device layout. itemSize = story bubble diameter, card width, floating width or banner height (px). */
export const deviceSchema = z.object({ show: z.boolean(), itemSize: int(48, 640), columns: int(1, 6) }).strict();

export const widgetConfigSchema = z
  .object({
    source: z.enum(['manual', 'product_tagged']),
    style: widgetStyleSchema,
    desktop: deviceSchema,
    mobile: deviceSchema,
    playback: z.object({ autoplay: z.boolean(), muted: z.boolean(), loop: z.boolean(), showControls: z.boolean() }).strict(),
    cta: z.object({ label: z.string().trim().min(1).max(24), action: z.enum(['POPUP', 'PDP']) }).strict(),
    product: z.object({ display: z.enum(['overlay', 'below', 'none']), showPrice: z.boolean(), maxProducts: int(1, 5) }).strict(),
    floating: z.object({ position: z.enum(['bottom-right', 'bottom-left']), closable: z.boolean() }).strict(),
  })
  .strict();
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

const BASE: WidgetConfig = {
  source: 'manual',
  style: {
    title: '', titleAlign: 'left', fontFamily: 'inherit', titleSize: 20, textSize: 14, textColor: '#111111', background: '#ffffff',
    transparentBackground: true, accentColor: '#111111', accentTextColor: '#ffffff', cardRadius: 12, borderWidth: 0, borderColor: '#e5e5e5', gap: 12, padding: 16,
  },
  desktop: { show: true, itemSize: 220, columns: 4 },
  mobile: { show: true, itemSize: 160, columns: 2 },
  playback: { autoplay: true, muted: true, loop: true, showControls: false },
  cta: { label: 'Shop now', action: 'POPUP' },
  product: { display: 'overlay', showPrice: true, maxProducts: 3 },
  floating: { position: 'bottom-right', closable: true },
};

const TYPE_DEFAULTS: Record<WidgetType, (c: WidgetConfig) => WidgetConfig> = {
  STORIES: (c) => ({ ...c, desktop: { ...c.desktop, itemSize: 88 }, mobile: { ...c.mobile, itemSize: 72 }, product: { ...c.product, display: 'none' } }),
  CAROUSEL: (c) => c,
  FLOATING: (c) => ({ ...c, desktop: { ...c.desktop, itemSize: 160 }, mobile: { ...c.mobile, itemSize: 110 }, product: { ...c.product, display: 'none' } }),
  BANNER: (c) => ({ ...c, desktop: { ...c.desktop, itemSize: 480, columns: 1 }, mobile: { ...c.mobile, itemSize: 360, columns: 1 } }),
  GRID: (c) => ({ ...c, desktop: { ...c.desktop, columns: 4 }, mobile: { ...c.mobile, columns: 2 } }),
  PRODUCT_GALLERY: (c) => ({ ...c, source: 'product_tagged', product: { ...c.product, display: 'below' } }),
};

export function defaultWidgetConfig(type: WidgetType): WidgetConfig {
  return widgetConfigSchema.parse(TYPE_DEFAULTS[type](structuredClone(BASE)));
}

const handle = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'Use a collection handle such as summer-sale');
export const targetingRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('home') }).strict(),
  z.object({ type: z.literal('all_products') }).strict(),
  z.object({ type: z.literal('products'), productIds: z.array(z.string().max(64)).min(1).max(100) }).strict(),
  /** Product pages whose product is tagged in at least one of the widget's videos. */
  z.object({ type: z.literal('tagged_products') }).strict(),
  z.object({ type: z.literal('all_collections') }).strict(),
  z.object({ type: z.literal('collections'), handles: z.array(handle).min(1).max(50) }).strict(),
  z.object({ type: z.literal('page'), path: z.string().regex(/^\/[a-z0-9/_.-]*$/i, 'Use a path such as /pages/about').max(200), match: z.enum(['exact', 'prefix']) }).strict(),
]);
export type TargetingRule = z.infer<typeof targetingRuleSchema>;
export const targetingSchema = z.object({ rules: z.array(targetingRuleSchema).min(1, 'Choose at least one page').max(20) }).strict();
export type Targeting = z.infer<typeof targetingSchema>;

export const DEFAULT_TARGETING: Record<WidgetType, Targeting> = {
  STORIES: { rules: [{ type: 'home' }] },
  CAROUSEL: { rules: [{ type: 'home' }] },
  FLOATING: { rules: [{ type: 'home' }] },
  BANNER: { rules: [{ type: 'home' }] },
  GRID: { rules: [{ type: 'home' }] },
  PRODUCT_GALLERY: { rules: [{ type: 'tagged_products' }] },
};

export interface PageContext {
  pageType: 'index' | 'product' | 'collection' | 'page' | 'other';
  path: string;
  /** Internal product id of the product page, if any. */
  productId?: string | null;
  collectionHandle?: string | null;
  /** True when the page's product is tagged in one of this widget's videos. */
  productTagged?: boolean;
}

const normPath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p).toLowerCase();

/** Shared by the server (resolving storefront requests) and tests, so targeting behaves identically everywhere. */
export function matchesTargeting(t: Targeting, page: PageContext): boolean {
  return t.rules.some((r) => {
    switch (r.type) {
      case 'home':
        return page.pageType === 'index';
      case 'all_products':
        return page.pageType === 'product';
      case 'products':
        return page.pageType === 'product' && !!page.productId && r.productIds.includes(page.productId);
      case 'tagged_products':
        return page.pageType === 'product' && !!page.productTagged;
      case 'all_collections':
        return page.pageType === 'collection';
      case 'collections':
        return page.pageType === 'collection' && !!page.collectionHandle && r.handles.includes(page.collectionHandle.toLowerCase());
      case 'page': {
        const path = normPath(page.path);
        const target = normPath(r.path);
        return r.match === 'exact' ? path === target : path === target || path.startsWith(target.endsWith('/') ? target : `${target}/`);
      }
    }
  });
}

// ---- API DTOs ----
export const createWidgetSchema = z.object({ name: z.string().trim().min(1).max(80), type: z.enum(WIDGET_TYPES) }).strict();
export const updateWidgetSchema = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(80).optional(),
    config: widgetConfigSchema.optional(),
    targeting: targetingSchema.optional(),
    videoIds: z.array(z.string().max(64)).max(50).refine((ids) => new Set(ids).size === ids.length, 'Each video can be added once').optional(),
  })
  .strict();

export const widgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(WIDGET_TYPES),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  version: z.number(),
  hasUnpublishedChanges: z.boolean(),
  publishedAt: z.string().nullable(),
  config: widgetConfigSchema,
  targeting: targetingSchema,
  videoIds: z.array(z.string()),
  updatedAt: z.string(),
});
export type WidgetDto = z.infer<typeof widgetSchema>;
export const widgetListSchema = z.object({ items: z.array(widgetSchema) });
export const widgetResponseSchema = z.object({ widget: widgetSchema });

/** What the storefront renderer receives: only public, published-safe data. */
export const payloadProductSchema = z.object({
  id: z.string(),
  shopifyId: z.string(),
  handle: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  price: z.string().nullable(),
  variantId: z.string().nullable(),
  shopifyVariantId: z.string().nullable(),
});
export const payloadVideoSchema = z.object({
  id: z.string(),
  source: z.enum(VIDEO_SOURCES),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  playbackUrl: z.string().nullable(),
  embedUrl: z.string().nullable(),
  permalink: z.string().nullable(),
  authorName: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  products: z.array(payloadProductSchema),
});
export const widgetPayloadSchema = z.object({
  id: z.string(),
  type: z.enum(WIDGET_TYPES),
  version: z.number(),
  currency: z.string().nullable(),
  config: widgetConfigSchema,
  videos: z.array(payloadVideoSchema),
});
export type WidgetPayload = z.infer<typeof widgetPayloadSchema>;
export type PayloadVideo = z.infer<typeof payloadVideoSchema>;

export const onboardingSchema = z.object({
  productsSynced: z.boolean(),
  videoCount: z.number(),
  publishedWidgets: z.number(),
  appEmbed: z.enum(['enabled', 'disabled', 'unknown']),
  themeEditorUrl: z.string(),
});
export type Onboarding = z.infer<typeof onboardingSchema>;
