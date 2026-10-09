import { storefrontEventSchema } from '@instafeed/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _flushNow, initAnalytics, tagCart, visitorId } from '../src/storefront/analytics.ts';
import { track } from '../src/storefront/events.ts';

let calls: { url: string; body: string }[];
beforeEach(() => {
  calls = [];
  localStorage.clear();
  window.Shopify = { routes: { root: '/' }, currency: { active: 'INR' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    return new Response('{}');
  }));
});
afterEach(() => vi.unstubAllGlobals());

initAnalytics('/apps/instafeed');

describe('storefront analytics transport', () => {
  it('batches events that satisfy the server v1 contract', () => {
    track('video_open', { widgetId: 'w1', videoId: 'v1' });
    track('add_to_cart', { widgetId: 'w1', videoId: 'v1', productId: 'p1', variantId: '1001', quantity: 2, value: 99800 });
    track('video_progress', { widgetId: 'w1', videoId: 'v1', progress: 50 });
    _flushNow();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/apps/instafeed/events');
    const { events } = JSON.parse(calls[0]!.body) as { events: unknown[] };
    expect(events).toHaveLength(3);
    for (const e of events) expect(storefrontEventSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
    expect(events[1]).toMatchObject({ type: 'add_to_cart', currency: 'INR', value: 99800, quantity: 2 });
    expect(new Set(events.map((e) => (e as { eventId: string }).eventId)).size).toBe(3);
  });

  it('keeps a stable random visitor id and sends nothing without consent', () => {
    const id = visitorId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(visitorId()).toBe(id);
    window.Shopify!.customerPrivacy = { analyticsProcessingAllowed: () => false };
    track('video_open', { widgetId: 'w1', videoId: 'v1' });
    _flushNow();
    expect(calls).toHaveLength(0);
  });

  it('tags the cart with only the visitor id (hidden attribute) when consent is given', async () => {
    await tagCart();
    expect(calls[0]!.url).toBe('/cart/update.js');
    expect(JSON.parse(calls[0]!.body)).toEqual({ attributes: { _ifv: visitorId() } });
    window.Shopify!.customerPrivacy = { analyticsProcessingAllowed: () => false };
    calls.length = 0;
    await tagCart();
    expect(calls).toHaveLength(0);
  });
});
