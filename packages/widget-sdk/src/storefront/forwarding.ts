import type { StorefrontIntegrations } from '@instafeed/shared';
import { consentGiven } from './analytics.ts';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    mixpanel?: { track?: (event: string, props: Record<string, unknown>) => void };
    clevertap?: { event?: { push: (name: string, data: Record<string, unknown>) => void } };
  }
}

const title = (type: string) => type.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
const marketingAllowed = () => {
  const cp = window.Shopify?.customerPrivacy as { marketingAllowed?: () => boolean } | undefined;
  return typeof cp?.marketingAllowed === 'function' ? cp.marketingAllowed() : consentGiven();
};

/**
 * Forwards Instafeed's own namespaced events (never standard ecommerce events, which Shopify's channels already
 * send) to analytics tools the merchant has installed. Each event goes to each destination at most once:
 * when GA4 is set to "via GTM", gtag is skipped and only the dataLayer receives it.
 */
export function initForwarding(cfg: StorefrontIntegrations): void {
  if (!Object.keys(cfg).length) return;
  document.addEventListener('instafeed:event', (e) => {
    const d = (e as CustomEvent<Record<string, unknown>>).detail;
    const type = String(d.type);
    const props = {
      widget_id: d.widgetId, video_id: d.videoId, product_id: d.productId, variant_id: d.variantId, quantity: d.quantity,
      // value is in minor units on our events; tools expect major units.
      ...(typeof d.value === 'number' ? { value: d.value / 100, currency: window.Shopify?.currency?.active } : {}),
    };
    const wants = (k: keyof StorefrontIntegrations) => cfg[k]?.events.includes(type);

    if (consentGiven()) {
      if (wants('GTM')) (window.dataLayer ??= []).push({ event: `instafeed_${type}`, instafeed: props });
      if (wants('GA4') && cfg.GA4!.config.sendVia !== 'gtm') window.gtag?.('event', `instafeed_${type}`, { ...props, send_to: cfg.GA4!.config.measurementId });
      if (wants('MIXPANEL')) window.mixpanel?.track?.(`Instafeed ${title(type)}`, props);
      if (wants('CLEVERTAP')) window.clevertap?.event?.push(`Instafeed ${title(type)}`, props);
    }
    if (wants('META') && marketingAllowed()) window.fbq?.('trackSingleCustom', cfg.META!.config.pixelId, `Instafeed${title(type).replace(/ /g, '')}`, props);
  });
}
