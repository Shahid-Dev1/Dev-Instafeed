import type { WidgetConfig } from '@instafeed/shared';

const FONTS: Record<WidgetConfig['style']['fontFamily'], string> = {
  inherit: 'inherit',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** All values come from the validated config schema (hex colours, bounded integers), so interpolation is safe. */
export function widgetCss(c: WidgetConfig, device: 'desktop' | 'mobile', preview: boolean): string {
  const s = c.style;
  const d = c[device];
  return `
:host { all: initial; display: block; }
.if { --if-text: ${s.textColor}; --if-accent: ${s.accentColor}; --if-accent-text: ${s.accentTextColor}; --if-radius: ${s.cardRadius}px;
  --if-gap: ${s.gap}px; --if-size: ${d.itemSize}px; --if-cols: ${d.columns};
  font-family: ${FONTS[s.fontFamily]}; font-size: ${s.textSize}px; color: var(--if-text); padding: ${s.padding}px;
  background: ${s.transparentBackground ? 'transparent' : s.background}; box-sizing: border-box; }
.if *, .if *::before, .if *::after { box-sizing: border-box; }
.if-title { font-size: ${s.titleSize}px; text-align: ${s.titleAlign}; margin: 0 0 var(--if-gap); font-weight: 600; }
.if-row { display: flex; gap: var(--if-gap); overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; }
.if-row > * { flex: 0 0 auto; scroll-snap-align: start; }
.if-grid { display: grid; gap: var(--if-gap); grid-template-columns: repeat(var(--if-cols), minmax(0, 1fr)); }
.if-card { position: relative; width: var(--if-size); border-radius: var(--if-radius); overflow: hidden; background: #000;
  border: ${s.borderWidth}px solid ${s.borderColor}; }
.if-grid .if-card { width: auto; }
.if-media { all: unset; display: block; width: 100%; aspect-ratio: 9 / 16; cursor: pointer; position: relative; }
.if-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.if-media:focus-visible, .if-btn:focus-visible, .if-story:focus-visible { outline: 3px solid var(--if-accent); outline-offset: 2px; }
.if-video-title { position: absolute; left: 8px; right: 8px; top: 8px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.if-products { padding: 8px; display: grid; gap: 6px; }
.if-overlay .if-products { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(transparent, rgba(0,0,0,.65)); color: #fff; }
.if-below { background: transparent; }
.if-below .if-products { color: var(--if-text); background: ${s.transparentBackground ? 'transparent' : s.background}; }
.if-product { display: flex; gap: 8px; align-items: center; min-width: 0; }
.if-product img { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex: none; }
.if-product span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.if-btn { all: unset; cursor: pointer; text-align: center; background: var(--if-accent); color: var(--if-accent-text); padding: 8px 12px;
  border-radius: calc(var(--if-radius) / 2); font-weight: 600; }
.if-story { all: unset; cursor: pointer; width: var(--if-size); text-align: center; }
.if-story img { width: var(--if-size); height: var(--if-size); border-radius: 50%; object-fit: cover; display: block;
  border: 3px solid var(--if-accent); padding: 2px; background: #fff; }
.if-story span { display: block; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.if-banner { position: relative; width: 100%; height: var(--if-size); border-radius: var(--if-radius); overflow: hidden; background: #000; }
.if-banner .if-media { aspect-ratio: auto; height: 100%; }
.if-banner-cta { position: absolute; left: 24px; bottom: 24px; display: grid; gap: 8px; color: #fff; max-width: 60%; }
.if-floating { position: ${preview ? 'absolute' : 'fixed'}; bottom: 16px; ${c.floating.position === 'bottom-left' ? 'left' : 'right'}: 16px; z-index: 2147483000;
  width: var(--if-size); box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.if-close { all: unset; position: absolute; top: 4px; right: 4px; z-index: 1; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,.6);
  color: #fff; text-align: center; line-height: 24px; cursor: pointer; }
.if-empty { color: #666; font-style: italic; }
@media (prefers-reduced-motion: reduce) { .if-row { scroll-behavior: auto; } }
`;
}
