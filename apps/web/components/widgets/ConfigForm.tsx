'use client';

import { FONT_FAMILIES, type WidgetConfig, type WidgetType } from '@instafeed/shared';
import type { ReactNode } from 'react';

type Updater = (fn: (c: WidgetConfig) => WidgetConfig) => void;

const row = (label: string, input: ReactNode) => (
  <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8, margin: '4px 0' }}>
    <span>{label}</span>
    {input}
  </label>
);

function Num({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 80 }} />;
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />;
}

const SIZE_LABEL: Record<WidgetType, string> = {
  STORIES: 'Bubble size', CAROUSEL: 'Card width', FLOATING: 'Player width', BANNER: 'Banner height', GRID: 'Card width', PRODUCT_GALLERY: 'Card width',
};

/** Form over the strict WidgetConfig; values are validated with the shared schema before saving. */
export function ConfigForm({ type, config, update }: { type: WidgetType; config: WidgetConfig; update: Updater }) {
  const style = <K extends keyof WidgetConfig['style']>(k: K, v: WidgetConfig['style'][K]) => update((c) => ({ ...c, style: { ...c.style, [k]: v } }));
  const set = <S extends 'playback' | 'cta' | 'product' | 'floating'>(section: S, patch: Partial<WidgetConfig[S]>) => update((c) => ({ ...c, [section]: { ...c[section], ...patch } }));
  const dev = (d: 'desktop' | 'mobile', patch: Partial<WidgetConfig['desktop']>) => update((c) => ({ ...c, [d]: { ...c[d], ...patch } }));
  const s = config.style;

  return (
    <div>
      <fieldset>
        <legend>Heading and typography</legend>
        {row('Heading', <input value={s.title} maxLength={80} onChange={(e) => style('title', e.target.value)} />)}
        {row('Alignment', <select value={s.titleAlign} onChange={(e) => style('titleAlign', e.target.value as 'left' | 'center')}><option value="left">Left</option><option value="center">Center</option></select>)}
        {row('Font', <select value={s.fontFamily} onChange={(e) => style('fontFamily', e.target.value as WidgetConfig['style']['fontFamily'])}>{FONT_FAMILIES.map((f) => <option key={f} value={f}>{f === 'inherit' ? 'Theme font' : f}</option>)}</select>)}
        {row('Heading size', <Num value={s.titleSize} min={12} max={40} onChange={(n) => style('titleSize', n)} />)}
        {row('Text size', <Num value={s.textSize} min={10} max={20} onChange={(n) => style('textSize', n)} />)}
      </fieldset>
      <fieldset>
        <legend>Colours and shape</legend>
        {row('Text', <Color value={s.textColor} onChange={(v) => style('textColor', v)} />)}
        {row('Button', <Color value={s.accentColor} onChange={(v) => style('accentColor', v)} />)}
        {row('Button text', <Color value={s.accentTextColor} onChange={(v) => style('accentTextColor', v)} />)}
        {row('Transparent background', <input type="checkbox" checked={s.transparentBackground} onChange={(e) => style('transparentBackground', e.target.checked)} />)}
        {!s.transparentBackground && row('Background', <Color value={s.background} onChange={(v) => style('background', v)} />)}
        {row('Corner radius', <Num value={s.cardRadius} min={0} max={40} onChange={(n) => style('cardRadius', n)} />)}
        {row('Border width', <Num value={s.borderWidth} min={0} max={8} onChange={(n) => style('borderWidth', n)} />)}
        {s.borderWidth > 0 && row('Border colour', <Color value={s.borderColor} onChange={(v) => style('borderColor', v)} />)}
        {row('Gap', <Num value={s.gap} min={0} max={48} onChange={(n) => style('gap', n)} />)}
        {row('Padding', <Num value={s.padding} min={0} max={64} onChange={(n) => style('padding', n)} />)}
      </fieldset>
      {(['desktop', 'mobile'] as const).map((d) => (
        <fieldset key={d}>
          <legend>{d === 'desktop' ? 'Desktop' : 'Mobile'}</legend>
          {row('Show', <input type="checkbox" checked={config[d].show} onChange={(e) => dev(d, { show: e.target.checked })} />)}
          {row(SIZE_LABEL[type], <Num value={config[d].itemSize} min={48} max={640} onChange={(n) => dev(d, { itemSize: n })} />)}
          {(type === 'GRID' || type === 'PRODUCT_GALLERY') && row('Columns', <Num value={config[d].columns} min={1} max={6} onChange={(n) => dev(d, { columns: n })} />)}
        </fieldset>
      ))}
      <fieldset>
        <legend>Playback</legend>
        {row('Autoplay (muted)', <input type="checkbox" checked={config.playback.autoplay} onChange={(e) => set('playback', { autoplay: e.target.checked, ...(e.target.checked ? { muted: true } : {}) })} />)}
        {row('Start muted', <input type="checkbox" checked={config.playback.muted} disabled={config.playback.autoplay} onChange={(e) => set('playback', { muted: e.target.checked })} />)}
        {row('Loop', <input type="checkbox" checked={config.playback.loop} onChange={(e) => set('playback', { loop: e.target.checked })} />)}
        {row('Show controls', <input type="checkbox" checked={config.playback.showControls} onChange={(e) => set('playback', { showControls: e.target.checked })} />)}
      </fieldset>
      <fieldset>
        <legend>Products and purchase</legend>
        {row('Button label', <input value={config.cta.label} maxLength={24} onChange={(e) => set('cta', { label: e.target.value })} />)}
        {row('Button action', <select value={config.cta.action} onChange={(e) => set('cta', { action: e.target.value as 'POPUP' | 'PDP' })}><option value="POPUP">Product popup + Add to Cart</option><option value="PDP">Go to product page</option></select>)}
        {row('Product display', <select value={config.product.display} onChange={(e) => set('product', { display: e.target.value as WidgetConfig['product']['display'] })}><option value="overlay">On the video</option><option value="below">Below the video</option><option value="none">Hidden</option></select>)}
        {row('Show price', <input type="checkbox" checked={config.product.showPrice} onChange={(e) => set('product', { showPrice: e.target.checked })} />)}
        {row('Products per video', <Num value={config.product.maxProducts} min={1} max={5} onChange={(n) => set('product', { maxProducts: n })} />)}
      </fieldset>
      {type === 'FLOATING' && (
        <fieldset>
          <legend>Floating player</legend>
          {row('Position', <select value={config.floating.position} onChange={(e) => set('floating', { position: e.target.value as WidgetConfig['floating']['position'] })}><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option></select>)}
          {row('Shoppers can close it', <input type="checkbox" checked={config.floating.closable} onChange={(e) => set('floating', { closable: e.target.checked })} />)}
        </fieldset>
      )}
    </div>
  );
}
