import type { PayloadVideo, WidgetPayload } from '@instafeed/shared';
import { el, safeUrl } from '../dom.ts';
import { openOverlay } from './overlay.ts';
import { shopProduct } from './popup.ts';
import { track } from './events.ts';

const CSS = `
.panel { width: min(420px, 100vw); height: min(92vh, 860px); background: #000; color: #fff; display: flex; flex-direction: column; border-radius: 12px; }
.pl-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.pl-stage video, .pl-stage iframe { width: 100%; height: 100%; border: 0; object-fit: contain; background: #000; }
.pl-nav { all: unset; position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,.2); text-align: center; line-height: 40px; font-size: 22px; cursor: pointer; }
.pl-prev { left: 8px; } .pl-next { right: 8px; }
.pl-info { padding: 12px; display: grid; gap: 8px; background: #111; }
.pl-title { font-weight: 600; }
.pl-product { display: flex; gap: 10px; align-items: center; }
.pl-product img { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; }
.pl-product span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-cta { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 8px; background: var(--accent); color: var(--accent-text); font-weight: 600; }
.pl-source { font-size: 12px; color: #ccc; }
.pl-source a { color: #fff; }
.pl-fallback { padding: 24px; text-align: center; }
`;

const SOURCE_NAME: Partial<Record<PayloadVideo['source'], string>> = {
  YOUTUBE: 'YouTube', TIKTOK_URL: 'TikTok', TIKTOK_ACCOUNT: 'TikTok', INSTAGRAM_URL: 'Instagram', INSTAGRAM_ACCOUNT: 'Instagram',
};

declare global {
  interface Window {
    Hls?: { isSupported(): boolean; new (): { loadSource(u: string): void; attachMedia(v: HTMLVideoElement): void; destroy(): void } };
  }
}

let hlsLoading: Promise<void> | null = null;
/** hls.js is only fetched when a shopper actually plays hosted video in a browser without native HLS. */
function loadHls(src: string): Promise<void> {
  hlsLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('hls.js failed to load'));
    document.head.append(s);
  });
  return hlsLoading;
}

function withParams(url: string, params: Record<string, string>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export interface PlayerOptions {
  hlsSrc?: string;
}

export function openPlayer(payload: WidgetPayload, startIndex: number, opts: PlayerOptions = {}) {
  const { config } = payload;
  let index = startIndex;
  let cleanup: (() => void) | undefined;
  const ov = openOverlay('Shoppable video', CSS, () => cleanup?.());
  ov.panel.style.setProperty('--accent', config.style.accentColor);
  ov.panel.style.setProperty('--accent-text', config.style.accentTextColor);
  const stage = el('div', { class: 'pl-stage' });
  const info = el('div', { class: 'pl-info', 'aria-live': 'polite' });
  ov.panel.append(stage, info);

  const fallback = (v: PayloadVideo, text: string) => {
    stage.replaceChildren(el('div', { class: 'pl-fallback' }, [
      el('p', {}, [text]),
      safeUrl(v.permalink) ? el('a', { href: safeUrl(v.permalink), target: '_blank', rel: 'noopener' }, [`Watch on ${SOURCE_NAME[v.source] ?? 'the original site'}`]) : null,
    ]));
  };

  const show = (i: number) => {
    cleanup?.();
    cleanup = undefined;
    index = (i + payload.videos.length) % payload.videos.length;
    const v = payload.videos[index]!;
    const ctx = { widgetId: payload.id, videoId: v.id };
    track('video_open', ctx);
    stage.replaceChildren();

    if (v.playbackUrl && safeUrl(v.playbackUrl)) {
      const video = el('video', { playsinline: true, autoplay: true, controls: true, poster: safeUrl(v.thumbnailUrl), 'aria-label': v.title });
      video.muted = config.playback.muted;
      video.loop = config.playback.loop;
      video.addEventListener('playing', () => track('video_start', ctx), { once: true });
      video.addEventListener('ended', () => track('video_complete', ctx));
      video.addEventListener('error', () => fallback(v, 'This video could not be played.'));
      stage.append(video);
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = v.playbackUrl;
      else if (opts.hlsSrc) {
        let destroyed = false;
        loadHls(opts.hlsSrc).then(() => {
          if (destroyed || !window.Hls?.isSupported()) return fallback(v, 'Your browser cannot play this video.');
          const hls = new window.Hls();
          hls.loadSource(v.playbackUrl!);
          hls.attachMedia(video);
          cleanup = () => hls.destroy();
        }, () => fallback(v, 'This video could not be loaded.'));
        cleanup = () => { destroyed = true; };
      } else fallback(v, 'Your browser cannot play this video.');
    } else if (v.embedUrl && safeUrl(v.embedUrl)) {
      // Official provider players only; autoplay starts muted where the provider requires it.
      const src = v.source === 'YOUTUBE'
        ? withParams(v.embedUrl, { autoplay: '1', mute: '1', playsinline: '1', rel: '0', ...(config.playback.loop ? { loop: '1', playlist: v.embedUrl.split('/').pop()! } : {}) })
        : v.source.startsWith('TIKTOK') ? withParams(v.embedUrl, { autoplay: '1', description: '0', music_info: '0' }) : v.embedUrl;
      stage.append(el('iframe', { src, title: v.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
      track('video_start', ctx);
    } else fallback(v, 'This video is not available right now.');

    if (payload.videos.length > 1) {
      stage.append(
        el('button', { class: 'pl-nav pl-prev', type: 'button', 'aria-label': 'Previous video', onclick: () => show(index - 1) }, ['‹']),
        el('button', { class: 'pl-nav pl-next', type: 'button', 'aria-label': 'Next video', onclick: () => show(index + 1) }, ['›']),
      );
    }
    const source = SOURCE_NAME[v.source];
    const parts: Node[] = [
      el('div', { class: 'pl-title' }, [v.title]),
      ...v.products.map((p) =>
        el('div', { class: 'pl-product' }, [
          safeUrl(p.imageUrl) ? el('img', { src: safeUrl(p.imageUrl), alt: '' }) : null,
          el('span', {}, [p.title]),
          el('button', { class: 'pl-cta', type: 'button', onclick: () => shopProduct(p, config, ctx) }, [config.cta.label]),
        ]),
      ),
      // Attribution for third-party content, as required by provider embed policies.
    ];
    if (source) parts.push(el('div', { class: 'pl-source' }, [`Video from ${source}${v.authorName ? ` · ${v.authorName}` : ''} `, safeUrl(v.permalink) ? el('a', { href: safeUrl(v.permalink), target: '_blank', rel: 'noopener' }, ['View original']) : null]));
    info.replaceChildren(...parts);
  };

  ov.panel.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') show(index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') show(index - 1);
  });
  let touchY = 0;
  let touchX = 0;
  ov.panel.addEventListener('touchstart', (e: TouchEvent) => { touchY = e.touches[0]!.clientY; touchX = e.touches[0]!.clientX; }, { passive: true });
  ov.panel.addEventListener('touchend', (e: TouchEvent) => {
    const dy = e.changedTouches[0]!.clientY - touchY;
    const dx = e.changedTouches[0]!.clientX - touchX;
    const d = Math.abs(dy) > Math.abs(dx) ? dy : dx;
    if (Math.abs(d) > 50 && payload.videos.length > 1) show(index + (d < 0 ? 1 : -1));
  }, { passive: true });

  show(startIndex);
  return { ...ov, show, current: () => index };
}
