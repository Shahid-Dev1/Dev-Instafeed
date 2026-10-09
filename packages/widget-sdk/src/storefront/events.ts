export type TrackType =
  | 'widget_impression' | 'video_open' | 'video_start' | 'video_complete' | 'product_click'
  | 'product_popup_open' | 'variant_select' | 'add_to_cart';

/**
 * Interaction hook. Phase 7 attaches the analytics transport; integrations and themes can listen too:
 * document.addEventListener('instafeed:event', e => …)
 */
export function track(type: TrackType, detail: Record<string, unknown>): void {
  document.dispatchEvent(new CustomEvent('instafeed:event', { detail: { type, ...detail, at: Date.now() } }));
}
