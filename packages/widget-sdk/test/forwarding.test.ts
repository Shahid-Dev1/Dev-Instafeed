import { defaultWidgetConfig, type WidgetPayload } from '@instafeed/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWidget } from '../src/render.ts';
import { track } from '../src/storefront/events.ts';
import { initForwarding } from '../src/storefront/forwarding.ts';

beforeEach(() => {
  window.dataLayer = [];
  window.gtag = vi.fn();
  window.fbq = vi.fn();
  window.mixpanel = { track: vi.fn() };
  window.clevertap = { event: { push: vi.fn() } };
  window.Shopify = { routes: { root: '/' }, currency: { active: 'INR' } };
});

// One listener for the whole file: forwarding is initialised once per page in production.
initForwarding({
  GTM: { config: { containerId: 'GTM-ABC123' }, events: ['video_open', 'add_to_cart'] },
  GA4: { config: { measurementId: 'G-ABC1234', sendVia: 'gtm' }, events: ['video_open', 'add_to_cart'] },
  META: { config: { pixelId: '123456789012345' }, events: ['add_to_cart'] },
  MIXPANEL: { config: { token: 'x', region: 'us' }, events: ['video_open'] },
  CLEVERTAP: { config: { accountId: 'W9R-486-4W5Z', region: 'in1' }, events: ['video_open'] },
});

describe('integration forwarding', () => {
  it('sends namespaced events once per destination and skips gtag when GA4 runs via GTM', () => {
    track('video_open', { widgetId: 'w1', videoId: 'v1' });
    expect(window.dataLayer).toEqual([{ event: 'instafeed_video_open', instafeed: expect.objectContaining({ widget_id: 'w1', video_id: 'v1' }) }]);
    expect(window.gtag).not.toHaveBeenCalled();
    expect(window.mixpanel!.track).toHaveBeenCalledWith('Instafeed Video Open', expect.objectContaining({ video_id: 'v1' }));
    expect(window.clevertap!.event!.push).toHaveBeenCalledWith('Instafeed Video Open', expect.any(Object));
    expect(window.fbq).not.toHaveBeenCalled(); // not in Meta's allow-list
  });

  it('converts value to major units and only targets the configured Meta pixel', () => {
    track('add_to_cart', { widgetId: 'w1', productId: 'p1', value: 99800, quantity: 2 });
    expect(window.fbq).toHaveBeenCalledWith('trackSingleCustom', '123456789012345', 'InstafeedAddToCart', expect.objectContaining({ value: 998, currency: 'INR' }));
  });

  it('respects consent: analytics tools need analytics consent, Meta needs marketing consent', () => {
    window.Shopify!.customerPrivacy = { analyticsProcessingAllowed: () => false, marketingAllowed: () => true } as never;
    track('add_to_cart', { productId: 'p1', value: 100 });
    expect(window.dataLayer).toEqual([]);
    expect(window.fbq).toHaveBeenCalledOnce();
    window.Shopify!.customerPrivacy = { analyticsProcessingAllowed: () => true, marketingAllowed: () => false } as never;
    track('add_to_cart', { productId: 'p1', value: 100 });
    expect(window.fbq).toHaveBeenCalledOnce();
    expect(window.dataLayer).toHaveLength(1);
  });
});

describe('custom CSS', () => {
  it('is scoped inside the widget shadow root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const payload: WidgetPayload = { id: 'w', type: 'GRID', version: 1, currency: null, config: defaultWidgetConfig('GRID'), videos: [] };
    mountWidget(host, payload, { device: 'desktop', preview: true, customCss: '.if-card { border-radius: 30px; }' });
    expect(host.shadowRoot!.querySelector('style')!.textContent).toContain('.if-card { border-radius: 30px; }');
    expect(document.head.innerHTML).not.toContain('border-radius: 30px');
  });
});
