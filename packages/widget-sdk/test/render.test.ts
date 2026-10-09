import { defaultWidgetConfig, type PayloadVideo, type WidgetPayload, type WidgetType } from '@instafeed/shared';
import { describe, expect, it, vi } from 'vitest';
import { mountWidget } from '../src/index.ts';

const video = (n: number, extra: Partial<PayloadVideo> = {}): PayloadVideo => ({
  id: `v${n}`, source: 'UPLOAD', title: `Video ${n}`, thumbnailUrl: `https://cdn.example/${n}.jpg`, playbackUrl: null, embedUrl: null,
  permalink: null, authorName: null, width: 1080, height: 1920,
  products: [{ id: `p${n}`, shopifyId: `gid://shopify/Product/${n}`, handle: `p-${n}`, title: `Product ${n}`, imageUrl: null, price: '499.00', variantId: null, shopifyVariantId: null }],
  ...extra,
});
const payload = (type: WidgetType, videos = [video(1), video(2), video(3)]): WidgetPayload => ({ id: 'w1', type, version: 1, currency: 'INR', config: defaultWidgetConfig(type), videos });

function mount(p: WidgetPayload, device: 'desktop' | 'mobile' = 'desktop', onEvent = vi.fn()) {
  const host = document.createElement('div');
  document.body.append(host);
  mountWidget(host, p, { device, preview: true, onEvent });
  return { root: host.shadowRoot!, onEvent };
}

describe('mountWidget', () => {
  it.each([
    ['STORIES', '.if-story', 3],
    ['CAROUSEL', '.if-card', 3],
    ['GRID', '.if-card', 3],
    ['PRODUCT_GALLERY', '.if-card', 3],
    ['BANNER', '.if-banner', 1],
    ['FLOATING', '.if-floating', 1],
  ] as const)('renders %s', (type, selector, count) => {
    expect(mount(payload(type)).root.querySelectorAll(selector)).toHaveLength(count);
  });

  it('applies validated style values as CSS', () => {
    const p = payload('CAROUSEL');
    p.config.style.accentColor = '#ff0066';
    p.config.style.cardRadius = 24;
    p.config.mobile.itemSize = 150;
    const css = mount(p, 'mobile').root.querySelector('style')!.textContent!;
    expect(css).toContain('--if-accent: #ff0066');
    expect(css).toContain('--if-radius: 24px');
    expect(css).toContain('--if-size: 150px');
  });

  it('never interprets data as markup and drops unsafe URLs', () => {
    const evil = video(9, { title: '<img src=x onerror=alert(1)>', thumbnailUrl: 'javascript:alert(1)' });
    evil.products[0]!.title = '<script>alert(1)</script>';
    const { root } = mount(payload('CAROUSEL', [evil]));
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelectorAll('img[onerror]')).toHaveLength(0);
    expect(root.querySelector('.if-media img')).toBeNull();
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  it('formats prices in the store currency and respects product display settings', () => {
    expect(mount(payload('CAROUSEL')).root.textContent).toMatch(/Product 1 · .*499/);
    const p = payload('CAROUSEL');
    p.config.product.display = 'none';
    expect(mount(p).root.querySelector('.if-products')).toBeNull();
  });

  it('hides the widget on a device where it is turned off', () => {
    const p = payload('CAROUSEL');
    p.config.mobile.show = false;
    expect(mount(p, 'mobile').root.querySelector('.if')).toBeNull();
    expect(mount(p, 'desktop').root.querySelector('.if')).not.toBeNull();
  });

  it('emits open and cta events and supports keyboard-focusable buttons', () => {
    const { root, onEvent } = mount(payload('CAROUSEL'));
    (root.querySelector('.if-media') as HTMLButtonElement).click();
    (root.querySelector('.if-btn') as HTMLButtonElement).click();
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([{ type: 'open', videoId: 'v1' }, { type: 'cta', videoId: 'v1', productId: 'p1' }]);
    expect(root.querySelector('.if-media')!.getAttribute('aria-label')).toBe('Play video: Video 1');
  });

  it('lets shoppers close a floating video and shows an empty state in preview', () => {
    const { root } = mount(payload('FLOATING'));
    (root.querySelector('.if-close') as HTMLButtonElement).click();
    expect(root.querySelector('.if-floating')).toBeNull();
    expect(mount(payload('GRID', [])).root.textContent).toMatch(/No ready videos/);
  });
});
