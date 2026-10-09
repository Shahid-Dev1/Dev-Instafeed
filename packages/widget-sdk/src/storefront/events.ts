export type TrackType =
  | 'widget_impression' | 'video_impression' | 'video_open' | 'video_start' | 'video_pause' | 'video_progress' | 'video_complete'
  | 'product_click' | 'product_popup_open' | 'variant_select' | 'add_to_cart';

/**
 * Interaction hook consumed by the analytics transport (analytics.ts); integrations and themes can listen too:
 * document.addEventListener('instafeed:event', e => …)
 */
export function track(type: TrackType, detail: Record<string, unknown>): void {
  document.dispatchEvent(new CustomEvent('instafeed:event', { detail: { type, ...detail, at: Date.now() } }));
}
