import { describe, expect, it } from 'vitest';
import { defaultWidgetConfig, matchesTargeting, targetingSchema, WIDGET_TYPES, widgetConfigSchema, type PageContext } from '../src/index.ts';

describe('widget config schema', () => {
  it('produces valid defaults for every widget type', () => {
    for (const t of WIDGET_TYPES) expect(widgetConfigSchema.safeParse(defaultWidgetConfig(t)).success).toBe(true);
    expect(defaultWidgetConfig('PRODUCT_GALLERY').source).toBe('product_tagged');
    expect(defaultWidgetConfig('STORIES').desktop.itemSize).toBe(88);
  });

  it('rejects unknown keys, bad colours and out-of-range values (strict for AI output)', () => {
    const c = defaultWidgetConfig('CAROUSEL');
    expect(widgetConfigSchema.safeParse({ ...c, script: 'alert(1)' }).success).toBe(false);
    expect(widgetConfigSchema.safeParse({ ...c, style: { ...c.style, accentColor: 'red' } }).success).toBe(false);
    expect(widgetConfigSchema.safeParse({ ...c, style: { ...c.style, accentColor: 'url(javascript:x)' } }).success).toBe(false);
    expect(widgetConfigSchema.safeParse({ ...c, style: { ...c.style, cardRadius: 999 } }).success).toBe(false);
    expect(widgetConfigSchema.safeParse({ ...c, cta: { ...c.cta, label: '' } }).success).toBe(false);
  });
});

describe('matchesTargeting', () => {
  const page = (p: Partial<PageContext>): PageContext => ({ pageType: 'other', path: '/', ...p });
  const t = (rules: unknown) => targetingSchema.parse({ rules });

  it('matches page types', () => {
    expect(matchesTargeting(t([{ type: 'home' }]), page({ pageType: 'index' }))).toBe(true);
    expect(matchesTargeting(t([{ type: 'home' }]), page({ pageType: 'product' }))).toBe(false);
    expect(matchesTargeting(t([{ type: 'all_products' }]), page({ pageType: 'product' }))).toBe(true);
    expect(matchesTargeting(t([{ type: 'all_collections' }]), page({ pageType: 'collection' }))).toBe(true);
  });

  it('matches specific products, tagged products and collections', () => {
    expect(matchesTargeting(t([{ type: 'products', productIds: ['p1'] }]), page({ pageType: 'product', productId: 'p1' }))).toBe(true);
    expect(matchesTargeting(t([{ type: 'products', productIds: ['p1'] }]), page({ pageType: 'product', productId: 'p2' }))).toBe(false);
    expect(matchesTargeting(t([{ type: 'tagged_products' }]), page({ pageType: 'product', productTagged: true }))).toBe(true);
    expect(matchesTargeting(t([{ type: 'tagged_products' }]), page({ pageType: 'product', productTagged: false }))).toBe(false);
    expect(matchesTargeting(t([{ type: 'collections', handles: ['summer'] }]), page({ pageType: 'collection', collectionHandle: 'Summer' }))).toBe(true);
  });

  it('matches custom page paths exactly or by prefix without partial-segment matches', () => {
    const exact = t([{ type: 'page', path: '/pages/about', match: 'exact' }]);
    expect(matchesTargeting(exact, page({ path: '/pages/about/' }))).toBe(true);
    expect(matchesTargeting(exact, page({ path: '/pages/about-us' }))).toBe(false);
    const prefix = t([{ type: 'page', path: '/blogs', match: 'prefix' }]);
    expect(matchesTargeting(prefix, page({ path: '/blogs/news/post' }))).toBe(true);
    expect(matchesTargeting(prefix, page({ path: '/blogsx' }))).toBe(false);
  });

  it('validates targeting input', () => {
    expect(targetingSchema.safeParse({ rules: [] }).success).toBe(false);
    expect(targetingSchema.safeParse({ rules: [{ type: 'page', path: 'javascript:x', match: 'exact' }] }).success).toBe(false);
    expect(targetingSchema.safeParse({ rules: [{ type: 'collections', handles: ['Bad Handle'] }] }).success).toBe(false);
  });
});
