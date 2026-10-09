import { register } from '@shopify/web-pixels-extension';

/** Deterministic UUID (version 8) from Shopify's event id, so retries of the same event deduplicate server-side. */
async function eventUuid(source: string): Promise<string> {
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Reports checkout starts for carts linked to an Instafeed visitor (hidden `_ifv` cart attribute set after a
 * widget Add to Cart). Only the random visitor id and a timestamp are sent; no customer or checkout PII.
 */
register(({ analytics, settings }) => {
  analytics.subscribe('checkout_started', async (event) => {
    const attrs = (event.data?.checkout?.attributes ?? []) as { key?: string; value?: string }[];
    const visitorId = attrs.find((a) => a.key === '_ifv')?.value;
    if (!visitorId || !/^[A-Za-z0-9_-]{1,64}$/.test(visitorId) || !settings.endpoint) return;
    const body = JSON.stringify({
      shop: settings.shop,
      events: [{ v: 1, eventId: await eventUuid(event.id), type: 'checkout_start', visitorId, occurredAt: Date.parse(event.timestamp) || Date.now() }],
    });
    await fetch(settings.endpoint, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true }).catch(() => undefined);
  });
});
