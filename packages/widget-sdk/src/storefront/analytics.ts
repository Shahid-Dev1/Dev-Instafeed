import type { TrackType } from './events.ts';
import { root } from './shopify.ts';

const VISITOR_KEY = 'instafeed_vid';
const FLUSH_MS = 4000;
const MAX_BATCH = 50;
let proxy = '/apps/instafeed';
const queue: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let memoryVisitor: string | undefined;

const uuid = () =>
  crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))).toString(16));

/** Respects Shopify's Customer Privacy API when the store loads it; otherwise the store's own settings govern. */
export function consentGiven(): boolean {
  const cp = window.Shopify?.customerPrivacy;
  return typeof cp?.analyticsProcessingAllowed === 'function' ? cp.analyticsProcessingAllowed() : true;
}

/** Random, first-party visitor id (no personal data). Only persisted with consent. */
export function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = uuid().replace(/-/g, '');
    if (consentGiven()) localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return (memoryVisitor ??= uuid().replace(/-/g, ''));
  }
}

function flush(useBeacon = false): void {
  clearTimeout(timer);
  timer = undefined;
  while (queue.length) {
    const body = JSON.stringify({ events: queue.splice(0, MAX_BATCH) });
    const url = `${proxy}/events`;
    // text/plain avoids a CORS preflight and works with sendBeacon during page unload.
    if (useBeacon && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) continue;
    void fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
  }
}

const MAP: Partial<Record<TrackType, string>> = {
  widget_impression: 'widget_impression',
  video_impression: 'video_impression',
  video_open: 'video_open',
  video_start: 'video_start',
  video_pause: 'video_pause',
  video_progress: 'video_progress',
  video_complete: 'video_complete',
  product_click: 'product_click',
  product_popup_open: 'product_popup_open',
  variant_select: 'variant_select',
  add_to_cart: 'add_to_cart',
};

/** Starts sending the interaction events emitted by the widgets (schema v1) to the app proxy. */
export function initAnalytics(proxyBase: string): void {
  proxy = proxyBase;
  document.addEventListener('instafeed:event', (e) => {
    if (!consentGiven()) return;
    const d = (e as CustomEvent<Record<string, unknown>>).detail;
    const type = MAP[d.type as TrackType];
    if (!type) return;
    const pick = (k: string) => (d[k] === undefined || d[k] === null ? {} : { [k]: d[k] });
    queue.push({
      v: 1,
      eventId: uuid(),
      type,
      visitorId: visitorId(),
      ...pick('widgetId'),
      ...pick('videoId'),
      ...pick('productId'),
      ...pick('variantId'),
      ...pick('quantity'),
      ...pick('value'),
      ...pick('progress'),
      ...(type === 'add_to_cart' && window.Shopify?.currency?.active ? { currency: window.Shopify.currency.active } : {}),
      occurredAt: Date.now(),
    });
    if (queue.length >= MAX_BATCH) flush();
    else timer ??= setTimeout(() => flush(), FLUSH_MS);
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
  window.addEventListener('pagehide', () => flush(true));
}

/**
 * Links the cart (and so the eventual order) to this visitor via a hidden cart attribute (leading underscore =
 * hidden at checkout). Only the random visitor id is stored; requires consent.
 */
export async function tagCart(): Promise<void> {
  if (!consentGiven()) return;
  await fetch(`${root()}cart/update.js`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ attributes: { _ifv: visitorId() } }),
  }).catch(() => undefined);
}

/** Test hook. */
export const _flushNow = () => flush();
