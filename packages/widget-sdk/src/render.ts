import type { PayloadVideo, WidgetPayload } from '@instafeed/shared';
import { el, safeUrl } from './dom.ts';
import { widgetCss } from './styles.ts';

export type WidgetEvent =
  | { type: 'open'; videoId: string }
  | { type: 'cta'; videoId: string; productId: string | null };

export interface MountOptions {
  device: 'desktop' | 'mobile';
  /** Preview mode positions floating widgets inside the container instead of the viewport. */
  preview?: boolean;
  /** Use Bunny's lightweight animated preview image on cards (storefront, when autoplay is on and motion is allowed). */
  animatedPreviews?: boolean;
  /** Merchant CSS (server-validated), scoped to this widget's shadow root. */
  customCss?: string;
  onEvent?: (e: WidgetEvent) => void;
}

function formatPrice(price: string | null, currency: string | null): string | null {
  if (!price) return null;
  try {
    return currency ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(price)) : price;
  } catch {
    return price;
  }
}

export function mountWidget(host: HTMLElement, payload: WidgetPayload, opts: MountOptions): { destroy: () => void } {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();
  const { config: c, type } = payload;
  const device = c[opts.device];
  const emit = (e: WidgetEvent) => opts.onEvent?.(e);
  if (!device.show) return { destroy: () => root.replaceChildren() };

  const wrap = el('div', { class: 'if', 'data-type': type.toLowerCase() });
  root.append(el('style', {}, [widgetCss(c, opts.device, !!opts.preview) + (opts.customCss ? `\n/* merchant */\n${opts.customCss}` : '')]), wrap);
  if (c.style.title && type !== 'FLOATING') wrap.append(el('h2', { class: 'if-title' }, [c.style.title]));

  if (payload.videos.length === 0) {
    if (opts.preview) wrap.append(el('p', { class: 'if-empty' }, ['No ready videos yet: add videos to see the preview.']));
    return { destroy: () => root.replaceChildren() };
  }

  const products = (v: PayloadVideo) => {
    if (c.product.display === 'none' || v.products.length === 0) return null;
    return el('div', { class: 'if-products' }, [...v.products.map((p) =>
      el('div', { class: 'if-product' }, [
        safeUrl(p.imageUrl) ? el('img', { src: safeUrl(p.imageUrl), alt: '', loading: 'lazy' }) : null,
        el('span', {}, [p.title, c.product.showPrice && formatPrice(p.price, payload.currency) ? ` · ${formatPrice(p.price, payload.currency)}` : '']),
      ]),
    ), el('button', { class: 'if-btn', type: 'button', onclick: () => emit({ type: 'cta', videoId: v.id, productId: v.products[0]?.id ?? null }) }, [c.cta.label])]);
  };

  const poster = (v: PayloadVideo) => {
    const still = safeUrl(v.thumbnailUrl);
    const animated = opts.animatedPreviews && c.playback.autoplay && v.playbackUrl ? safeUrl(v.playbackUrl.replace(/playlist\.m3u8$/, 'preview.webp')) : undefined;
    const src = animated ?? still;
    if (!src) return null;
    const img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async' });
    if (animated && still) img.addEventListener('error', () => { if (img.src !== still) img.src = still; }, { once: true });
    return img;
  };

  const media = (v: PayloadVideo, withTitle = false) =>
    el('button', { class: 'if-media', type: 'button', 'aria-label': `Play video: ${v.title}`, onclick: () => emit({ type: 'open', videoId: v.id }) }, [
      poster(v),
      withTitle ? el('span', { class: 'if-video-title' }, [v.title]) : null,
    ]);

  const card = (v: PayloadVideo) =>
    el('div', { class: `if-card ${c.product.display === 'below' ? 'if-below' : 'if-overlay'}`, 'data-video-id': v.id }, [media(v), products(v)]);

  switch (type) {
    case 'STORIES':
      wrap.append(el('div', { class: 'if-row', role: 'list' }, payload.videos.map((v) =>
        el('button', { class: 'if-story', type: 'button', role: 'listitem', 'data-video-id': v.id, 'aria-label': `Open story: ${v.title}`, onclick: () => emit({ type: 'open', videoId: v.id }) }, [
          safeUrl(v.thumbnailUrl) ? el('img', { src: safeUrl(v.thumbnailUrl), alt: '', loading: 'lazy' }) : el('img', { alt: '' }),
          el('span', {}, [v.title]),
        ]),
      )));
      break;
    case 'CAROUSEL':
      wrap.append(el('div', { class: 'if-row', role: 'list' }, payload.videos.map(card)));
      break;
    case 'GRID':
    case 'PRODUCT_GALLERY':
      wrap.append(el('div', { class: 'if-grid' }, payload.videos.map(card)));
      break;
    case 'BANNER': {
      const v = payload.videos[0]!;
      wrap.append(el('div', { class: 'if-banner', 'data-video-id': v.id }, [
        media(v),
        el('div', { class: 'if-banner-cta' }, [
          el('strong', {}, [v.title]),
          el('button', { class: 'if-btn', type: 'button', onclick: () => emit({ type: 'cta', videoId: v.id, productId: v.products[0]?.id ?? null }) }, [c.cta.label]),
        ]),
      ]));
      break;
    }
    case 'FLOATING': {
      const v = payload.videos[0]!;
      const box = el('div', { class: 'if-card if-floating if-overlay', 'data-video-id': v.id, role: 'complementary', 'aria-label': 'Shoppable video' }, [
        c.floating.closable ? el('button', { class: 'if-close', type: 'button', 'aria-label': 'Close video', onclick: () => box.remove() }, ['×']) : null,
        media(v),
        products(v),
      ]);
      wrap.append(box);
      break;
    }
  }
  return { destroy: () => root.replaceChildren() };
}
