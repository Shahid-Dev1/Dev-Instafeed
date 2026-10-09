import { gzipSync } from 'node:zlib';
import { defaultWidgetConfig, type PayloadVideo, type WidgetPayload } from '@instafeed/shared';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storefrontBuildOptions } from '../scripts/build.mjs';
import { boot } from '../src/storefront/loader.ts';
import { openPlayer } from '../src/storefront/player.ts';
import { openProductPopup, shopProduct } from '../src/storefront/popup.ts';

const product = { id: 'p1', shopifyId: 'gid://shopify/Product/101', handle: 'vitamin-c', title: 'Vitamin C Serum', imageUrl: null, price: '499.00', variantId: null, shopifyVariantId: null };
const video = (n: number, extra: Partial<PayloadVideo> = {}): PayloadVideo => ({
  id: `v${n}`, source: 'UPLOAD', title: `Clip ${n}`, thumbnailUrl: `https://cdn.example/${n}.jpg`, playbackUrl: `https://vz.b-cdn.net/g${n}/playlist.m3u8`,
  embedUrl: null, permalink: null, authorName: null, width: 1080, height: 1920, products: [product], ...extra,
});
const payload = (type: WidgetPayload['type'] = 'CAROUSEL', videos = [video(1), video(2)]): WidgetPayload => ({ id: 'w1', type, version: 1, currency: 'INR', config: defaultWidgetConfig(type), videos });

const ajaxProduct = {
  id: 101, title: 'Vitamin C Serum', handle: 'vitamin-c', featured_image: 'https://cdn.shopify.com/vc.jpg',
  options: [{ name: 'Size', values: ['30ml', '50ml'] }],
  variants: [
    { id: 1001, title: '30ml', price: 49900, available: true, options: ['30ml'] },
    { id: 1002, title: '50ml', price: 79900, available: false, options: ['50ml'] },
  ],
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Handler>;
let calls: { url: string; init?: RequestInit }[];
const overlayRoot = () => document.querySelector('[data-instafeed-overlay]')?.shadowRoot ?? null;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.replaceChildren();
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    return key ? routes[key]!(url, init) : new Response('not found', { status: 404 });
  }));
});
afterEach(async () => {
  // Close any open overlays so no listeners or timers outlive the test.
  while (overlayRoot()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await flush();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loader', () => {
  it('loads all blocks and the embed with one batched, lazy request and mounts each placement', async () => {
    const floating = { ...payload('FLOATING', [video(3)]), id: 'w9' };
    routes['/apps/instafeed/widgets'] = () => Response.json({ widgets: [{ placement: 'block', payload: payload() }, { placement: 'embed', payload: floating }] });
    let trigger: (() => void) | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) { trigger = () => cb([{ isIntersecting: true }]); }
      observe() {}
      disconnect() {}
    });
    document.body.innerHTML = `
      <instafeed-widget data-widget-id="w1" data-page-type="product" data-product-id="101" data-path="/products/vitamin-c"></instafeed-widget>
      <instafeed-widget data-widget-id="w1"></instafeed-widget>
      <instafeed-embed data-page-type="product" data-product-id="101" data-path="/products/vitamin-c"></instafeed-embed>`;
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    boot();
    expect(calls).toHaveLength(0); // nothing fetched until a block is near the viewport
    trigger!();
    await vi.waitFor(() => expect(document.querySelectorAll('instafeed-widget')[1]!.shadowRoot?.querySelectorAll('.if-card')).toHaveLength(2));
    expect(calls).toHaveLength(1);
    const qs = new URL(calls[0]!.url, 'https://shop.test').searchParams;
    expect(Object.fromEntries(qs)).toEqual({ page_type: 'product', path: '/products/vitamin-c', product_id: '101', ids: 'w1', embed: '1' });
    expect(document.querySelector('instafeed-embed div')!.shadowRoot!.querySelector('.if-floating')).not.toBeNull();
  });

  it('fails closed (renders nothing) when the proxy is down', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    routes['/apps/instafeed/widgets'] = () => new Response('err', { status: 500 });
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: (e: { isIntersecting: boolean }[]) => void) { setTimeout(() => cb([{ isIntersecting: true }]), 0); } observe() {} disconnect() {} });
    document.body.innerHTML = '<instafeed-widget data-widget-id="w1"></instafeed-widget>';
    boot();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(2); // one retry
    expect(document.querySelector('instafeed-widget')!.shadowRoot).toBeNull();
    vi.useRealTimers();
  });
});

describe('player', () => {
  it('opens accessibly, navigates with keys, closes on Escape and restores focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const p = openPlayer(payload(), 0);
    const root = overlayRoot()!;
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelector('.pl-title')!.textContent).toBe('Clip 1');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(p.current()).toBe(1);
    expect(root.querySelector('.pl-title')!.textContent).toBe('Clip 2');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(overlayRoot()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('uses official embeds with attribution for third-party videos and falls back when unplayable', () => {
    openPlayer(payload('CAROUSEL', [video(1, { source: 'YOUTUBE', playbackUrl: null, embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk', permalink: 'https://www.youtube.com/shorts/abcdefghijk', authorName: 'Brand' })]), 0);
    const root = overlayRoot()!;
    const src = new URL(root.querySelector('iframe')!.getAttribute('src')!);
    expect(src.origin + src.pathname).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(src.searchParams.get('mute')).toBe('1');
    expect(root.querySelector('.pl-source')!.textContent).toMatch(/Video from YouTube · Brand/);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    openPlayer(payload('CAROUSEL', [video(2, { source: 'TIKTOK_URL', playbackUrl: null, embedUrl: null, permalink: 'https://www.tiktok.com/@b/video/1' })]), 0);
    expect(overlayRoot()!.querySelector('.pl-fallback a')!.getAttribute('href')).toBe('https://www.tiktok.com/@b/video/1');
  });

  it('lazy-loads hls.js only when native HLS is unavailable', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    openPlayer(payload(), 0, { hlsSrc: 'https://cdn.shopify.com/instafeed-hls.js' });
    const scripts = [...document.head.querySelectorAll('script')].map((s) => s.src);
    expect(scripts).toContain('https://cdn.shopify.com/instafeed-hls.js');
    document.head.querySelectorAll('script').forEach((el) => el.remove());
  });
});

describe('product popup and cart', () => {
  it('loads the product, selects variants, disables sold-out variants and adds to cart', async () => {
    routes['/products/vitamin-c.js'] = () => Response.json(ajaxProduct);
    routes['/cart/add.js'] = () => Response.json({ id: 1001 });
    const added = vi.fn();
    document.addEventListener('instafeed:added-to-cart', added);
    openProductPopup(product, defaultWidgetConfig('CAROUSEL'), { widgetId: 'w1', videoId: 'v1' });
    await vi.waitFor(() => expect(overlayRoot()!.querySelector('.pp-btn')).not.toBeNull());
    const root = overlayRoot()!;
    const btn = root.querySelector('.pp-btn') as HTMLButtonElement;
    const select = root.querySelector('select') as HTMLSelectElement;

    select.value = '50ml';
    select.dispatchEvent(new Event('change'));
    expect(btn.textContent).toBe('Sold out');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    btn.click();
    expect(calls.some((c) => c.url.includes('/cart/add.js'))).toBe(false);

    select.value = '30ml';
    select.dispatchEvent(new Event('change'));
    (root.querySelector('input[type="number"]') as HTMLInputElement).value = '2';
    btn.click();
    await vi.waitFor(() => expect(root.querySelector('.pp-ok')).not.toBeNull());
    const add = calls.find((c) => c.url.includes('/cart/add.js'))!;
    expect(JSON.parse(String(add.init!.body))).toEqual({ items: [{ id: 1001, quantity: 2 }] });
    expect(added).toHaveBeenCalledOnce();
    expect(root.querySelector('.pp-ok')!.parentElement!.querySelector('a')!.getAttribute('href')).toBe('/cart');
  });

  it("shows Shopify's error message when Add to Cart fails, and lets the shopper retry", async () => {
    routes['/products/vitamin-c.js'] = () => Response.json(ajaxProduct);
    routes['/cart/add.js'] = () => Response.json({ status: 422, message: 'Cart Error', description: 'All 1 Vitamin C Serum are in your cart.' }, { status: 422 });
    openProductPopup(product, defaultWidgetConfig('CAROUSEL'), { widgetId: 'w1', videoId: 'v1' });
    await vi.waitFor(() => expect(overlayRoot()!.querySelector('.pp-btn')).not.toBeNull());
    (overlayRoot()!.querySelector('.pp-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(overlayRoot()!.querySelector('.pp-err')!.textContent).toBe('All 1 Vitamin C Serum are in your cart.'));
    expect(overlayRoot()!.querySelector('.pp-btn')!.textContent).toBe('Add to cart');
  });

  it('recovers from a failed product load with a retry button', async () => {
    let attempts = 0;
    routes['/products/vitamin-c.js'] = () => (++attempts === 1 ? new Response('x', { status: 500 }) : Response.json(ajaxProduct));
    openProductPopup(product, defaultWidgetConfig('CAROUSEL'), { widgetId: 'w1', videoId: 'v1' });
    await vi.waitFor(() => expect(overlayRoot()!.querySelector('.pp-err')).not.toBeNull());
    (overlayRoot()!.querySelector('.pp-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(overlayRoot()!.querySelector('.pp-title')!.textContent).toBe('Vitamin C Serum'));
  });

  it('redirects to the product page (with variant) when the CTA action is PDP', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const cfg = { ...defaultWidgetConfig('CAROUSEL'), cta: { label: 'Shop', action: 'PDP' as const } };
    shopProduct({ ...product, shopifyVariantId: 'gid://shopify/ProductVariant/1002' }, cfg, { widgetId: 'w1', videoId: 'v1' });
    expect(assign).toHaveBeenCalledWith('/products/vitamin-c?variant=1002');
  });

  it('emits interaction events for analytics', async () => {
    const events: string[] = [];
    document.addEventListener('instafeed:event', (e) => events.push((e as CustomEvent).detail.type));
    routes['/products/vitamin-c.js'] = () => Response.json(ajaxProduct);
    shopProduct(product, defaultWidgetConfig('CAROUSEL'), { widgetId: 'w1', videoId: 'v1' });
    await flush();
    expect(events).toEqual(['product_click', 'product_popup_open']);
  });
});

describe('bundle budget', () => {
  it('keeps the storefront script under 12 KB gzipped (players load lazily)', async () => {
    const res = await build({ ...storefrontBuildOptions, write: false });
    const gz = gzipSync(res.outputFiles[0]!.contents).length;
    expect(gz).toBeLessThan(12 * 1024);
  });
});
