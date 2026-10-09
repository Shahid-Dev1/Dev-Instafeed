import { parseEnv } from '../src/config/env.js';
import { loadRootEnvFile } from '../src/config/load-env-file.js';
import { createDb, type Db } from '../src/lib/db.js';

const PLANS = [
  { id: 'FREE', name: 'Free', priceMonthlyUsd: 0, limits: { videos: 10, widgets: 1, monthlyViews: 2_000, storageGb: 1 }, features: ['stories', 'carousel'] },
  { id: 'STARTER', name: 'Starter', priceMonthlyUsd: 1900, limits: { videos: 50, widgets: 5, monthlyViews: 25_000, storageGb: 10 }, features: ['stories', 'carousel', 'floating', 'analytics'] },
  { id: 'GROWTH', name: 'Growth', priceMonthlyUsd: 4900, limits: { videos: 250, widgets: 20, monthlyViews: 150_000, storageGb: 50 }, features: ['stories', 'carousel', 'floating', 'banner', 'grid', 'gallery', 'analytics', 'integrations', 'custom_css'] },
  { id: 'PRO', name: 'Pro', priceMonthlyUsd: 14900, limits: { videos: 2_000, widgets: 100, monthlyViews: 1_000_000, storageGb: 250 }, features: ['stories', 'carousel', 'floating', 'banner', 'grid', 'gallery', 'analytics', 'integrations', 'custom_css', 'ai_assistant', 'tiktok_account'] },
] as const;

/** Features requiring external approval or credentials default to off. */
const FLAGS = [
  { key: 'tiktok_display_api', enabled: false },
  { key: 'ai_assistant', enabled: false },
  { key: 'instagram_api', enabled: false },
  { key: 'instagram_oembed', enabled: false },
];

export async function seed(db: Db): Promise<void> {
  for (const p of PLANS) {
    const data = { name: p.name, priceMonthlyUsd: p.priceMonthlyUsd, limits: p.limits, features: [...p.features] };
    await db.plan.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
  }
  // Global flags have storeId NULL, which a compound unique cannot match, so look up explicitly.
  // Existing values are left untouched so operators' changes survive re-seeding.
  for (const f of FLAGS) {
    const existing = await db.featureFlag.findFirst({ where: { key: f.key, storeId: null } });
    if (!existing) await db.featureFlag.create({ data: { key: f.key, enabled: f.enabled } });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadRootEnvFile();
  const db = createDb(parseEnv(process.env).DATABASE_URL);
  await seed(db);
  await db.$disconnect();
  console.warn('[seed] done');
}
