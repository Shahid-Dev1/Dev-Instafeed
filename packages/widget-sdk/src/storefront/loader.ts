import type { StorefrontIntegrations, WidgetPayload } from '@instafeed/shared';
import { mountWidget } from '../render.ts';
import { initAnalytics } from './analytics.ts';
import { initForwarding } from './forwarding.ts';
import { openPlayer } from './player.ts';
import { shopProduct } from './popup.ts';
import { track } from './events.ts';

interface StorefrontWidget {
  placement: 'block' | 'embed';
  payload: WidgetPayload;
}

const MOBILE = '(max-width: 749px)';
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const device = () => (window.matchMedia?.(MOBILE).matches ? 'mobile' : 'desktop');

/** Page context written by the Liquid block/embed (request.page_type, product.id, collection.handle). */
function pageParams(elm: HTMLElement): Record<string, string> {
  const d = elm.dataset;
  return Object.fromEntries(
    Object.entries({ page_type: d.pageType, path: d.path ?? location.pathname, product_id: d.productId, collection: d.collection }).filter((e): e is [string, string] => !!e[1]),
  );
}

interface ProxyResponse {
  widgets: StorefrontWidget[];
  integrations?: StorefrontIntegrations;
  customCss?: string;
}

async function fetchWidgets(proxy: string, params: Record<string, string>, attempt = 0): Promise<ProxyResponse> {
  try {
    const res = await fetch(`${proxy}/widgets?${new URLSearchParams(params)}`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ProxyResponse;
  } catch (e) {
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 2000));
      return fetchWidgets(proxy, params, attempt + 1);
    }
    // The storefront must never break: fail closed (render nothing) and log for developers.
    console.warn('[instafeed] widgets unavailable', e);
    return { widgets: [] };
  }
}

function mount(host: HTMLElement, w: StorefrontWidget, hlsSrc: string | undefined, customCss: string | undefined) {
  const { payload } = w;
  const render = () =>
    mountWidget(host, payload, {
      device: device(),
      animatedPreviews: !reducedMotion(),
      customCss,
      onEvent: (e) => {
        const index = Math.max(0, payload.videos.findIndex((v) => v.id === e.videoId));
        const video = payload.videos[index];
        if (e.type === 'open') openPlayer(payload, index, { hlsSrc });
        else if (video) {
          const product = video.products.find((p) => p.id === e.productId) ?? video.products[0];
          if (product) shopProduct(product, payload.config, { widgetId: payload.id, videoId: video.id });
          else openPlayer(payload, index, { hlsSrc });
        }
      },
    });
  const seen = new Set<string>();
  const observeVideos = () => {
    // A video impression = its card at least half visible; counted once per page view.
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.videoId;
        if (e.isIntersecting && id && !seen.has(id)) {
          seen.add(id);
          track('video_impression', { widgetId: payload.id, videoId: id });
        }
      }
    }, { threshold: 0.5 });
    host.shadowRoot?.querySelectorAll<HTMLElement>('[data-video-id]').forEach((n) => io.observe(n));
  };
  render();
  observeVideos();
  window.matchMedia?.(MOBILE).addEventListener?.('change', () => { render(); observeVideos(); });
  track('widget_impression', { widgetId: payload.id });
}

/**
 * Finds <instafeed-widget> (theme app blocks) and <instafeed-embed> (app embed) elements, waits until a block
 * is near the viewport (or the page is idle for the embed), then loads every widget for the page in one request.
 */
export function boot(doc: Document = document): void {
  const blocks = [...doc.querySelectorAll<HTMLElement>('instafeed-widget[data-widget-id]')];
  const embed = doc.querySelector<HTMLElement>('instafeed-embed');
  const anchor = embed ?? blocks[0];
  if (!anchor) return;
  const proxy = anchor.dataset.proxy || '/apps/instafeed';
  initAnalytics(proxy);
  const hlsSrc = anchor.dataset.hlsSrc || blocks.find((b) => b.dataset.hlsSrc)?.dataset.hlsSrc;
  let loaded = false;

  const load = async () => {
    if (loaded) return;
    loaded = true;
    observer?.disconnect();
    const ids = [...new Set(blocks.map((b) => b.dataset.widgetId!).filter(Boolean))];
    const { widgets, integrations, customCss } = await fetchWidgets(proxy, { ...pageParams(anchor), ...(ids.length ? { ids: ids.join(',') } : {}), ...(embed ? { embed: '1' } : {}) });
    // Forwarding starts before mounting so the first widget_impression is forwarded too.
    if (integrations) initForwarding(integrations);
    for (const w of widgets) {
      if (w.placement === 'block') blocks.filter((b) => b.dataset.widgetId === w.payload.id).forEach((b) => mount(b, w, hlsSrc, customCss));
      else if (embed) {
        const host = doc.createElement('div');
        embed.append(host);
        mount(host, w, hlsSrc, customCss);
      }
    }
  };

  const observer = blocks.length && 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(), { rootMargin: '300px' })
    : null;
  if (observer) blocks.forEach((b) => observer.observe(b));
  if (embed || !observer) {
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500));
    if (doc.readyState === 'complete') idle(() => void load());
    else window.addEventListener('load', () => idle(() => void load()), { once: true });
  }
}
