'use client';

import type { WidgetConfig, WidgetPayload } from '@instafeed/shared';
import { mountWidget } from '@instafeed/widget-sdk';
import { useEffect, useRef, useState } from 'react';

/** Renders with the storefront renderer, inside a device-sized frame, using the unsaved config. */
export function WidgetPreview({ payload, config }: { payload: WidgetPayload | null; config: WidgetConfig }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current || !payload) return;
    const handle = mountWidget(host.current, { ...payload, config }, {
      device,
      preview: true,
      onEvent: (e) => setLastEvent(e.type === 'open' ? 'Shopper opens the video player' : `Shopper clicks “${config.cta.label}” (${config.cta.action === 'PDP' ? 'goes to product page' : 'opens product popup'})`),
    });
    return () => handle.destroy();
  }, [payload, config, device]);

  return (
    <section aria-label="Preview">
      <p role="group" aria-label="Preview device">
        {(['desktop', 'mobile'] as const).map((d) => (
          <button key={d} onClick={() => setDevice(d)} aria-pressed={device === d} style={{ fontWeight: device === d ? 700 : 400 }}>{d === 'desktop' ? 'Desktop' : 'Mobile'}</button>
        ))}
      </p>
      <div style={{ width: device === 'desktop' ? '100%' : 375, maxWidth: '100%', minHeight: 320, position: 'relative', border: '1px dashed #bbb', background: '#fafafa', overflow: 'hidden' }}>
        <div ref={host} />
      </div>
      <small>{lastEvent ?? 'Video playback, the product popup and Add to Cart come with the storefront player (Phase 6).'}</small>
    </section>
  );
}
