import { el } from '../dom.ts';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, iframe, video[controls], [tabindex]:not([tabindex="-1"])';

const BASE_CSS = `
:host { all: initial; }
.ov { position: fixed; inset: 0; z-index: 2147483600; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.75); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 14px; color: #111; }
.ov * { box-sizing: border-box; }
.panel { position: relative; background: #fff; border-radius: 12px; max-height: 100%; overflow: auto; }
.x { all: unset; position: absolute; top: 8px; right: 8px; z-index: 3; width: 36px; height: 36px; border-radius: 50%; background: rgba(0,0,0,.6);
  color: #fff; font-size: 22px; line-height: 36px; text-align: center; cursor: pointer; }
.x:focus-visible, button:focus-visible, select:focus-visible, a:focus-visible { outline: 3px solid #2c6ecb; outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) { .panel { animation: in .15s ease-out; } @keyframes in { from { opacity: 0; transform: scale(.98); } } }
`;

export interface Overlay {
  panel: HTMLElement;
  root: ShadowRoot;
  close: () => void;
}

/**
 * Accessible modal: role=dialog + aria-modal, focus moved in and trapped, Escape closes,
 * page scroll locked, and focus returned to the opener on close.
 */
export function openOverlay(label: string, css: string, onClose?: () => void): Overlay {
  const opener = document.activeElement as HTMLElement | null;
  const host = el('div', { 'data-instafeed-overlay': '' });
  const root = host.attachShadow({ mode: 'open' });
  const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' });
  const prevOverflow = document.documentElement.style.overflow;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    document.documentElement.style.overflow = prevOverflow;
    onClose?.();
    opener?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      const active = root.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const backdrop: HTMLDivElement = el('div', { class: 'ov', onclick: (e: Event) => e.target === backdrop && close() }, [panel]);
  panel.append(el('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: close }, ['×']));
  root.append(el('style', {}, [BASE_CSS + css]), backdrop);
  document.body.append(host);
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey, true);
  queueMicrotask(() => panel.focus());
  return { panel, root, close };
}
