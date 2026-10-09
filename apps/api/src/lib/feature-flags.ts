import type { Db } from './db.js';

export const FLAGS = ['tiktok_display_api', 'instagram_api', 'instagram_oembed', 'ai_assistant'] as const;
export type FlagKey = (typeof FLAGS)[number];

/** A per-store override wins over the global default; unknown flags are off. */
export async function isEnabled(db: Db, key: FlagKey, storeId: string): Promise<boolean> {
  const rows = await db.featureFlag.findMany({ where: { key, OR: [{ storeId }, { storeId: null }] } });
  return (rows.find((r) => r.storeId === storeId) ?? rows.find((r) => r.storeId === null))?.enabled ?? false;
}
