import type { Onboarding } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { shopifyAdmin } from '../shopify/admin.js';

/** Must match the Theme App Extension's app-embed block file name (extensions/…/blocks/<handle>.liquid). */
export const APP_EMBED_HANDLE = 'instafeed-embed';

const THEME_SETTINGS_QUERY = `query MainThemeSettings {
  themes(first: 1, roles: [MAIN]) {
    nodes { files(filenames: ["config/settings_data.json"], first: 1) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } }
  }
}`;

interface ThemeSettingsResult {
  themes: { nodes: { files: { nodes: { body: { content?: string } }[] } }[] };
}

/** Reads the main theme's settings_data.json and reports whether our app embed is present and enabled. */
export function appEmbedState(settingsJson: string | undefined): 'enabled' | 'disabled' {
  if (!settingsJson) return 'disabled';
  // settings_data.json may start with a /* … */ comment header.
  const data = JSON.parse(settingsJson.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')) as { current?: { blocks?: Record<string, { type?: string; disabled?: boolean }> } };
  const blocks = Object.values(data.current?.blocks ?? {});
  return blocks.some((b) => b.type?.includes(`/blocks/${APP_EMBED_HANDLE}/`) && b.disabled !== true) ? 'enabled' : 'disabled';
}

export async function getOnboarding(deps: Deps, storeId: string): Promise<Onboarding> {
  const [store, products, videoCount, publishedWidgets] = await Promise.all([
    deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { shopDomain: true } }),
    deps.db.product.count({ where: { storeId, deletedAt: null } }),
    deps.db.video.count({ where: { storeId, archivedAt: null } }),
    deps.db.widget.count({ where: { storeId, status: 'PUBLISHED' } }),
  ]);
  let appEmbed: Onboarding['appEmbed'] = 'unknown';
  try {
    const admin = await shopifyAdmin(deps, storeId);
    const res = await admin.query<ThemeSettingsResult>(THEME_SETTINGS_QUERY);
    appEmbed = appEmbedState(res.themes.nodes[0]?.files.nodes[0]?.body.content);
  } catch {
    // Theme access is best-effort; the checklist still renders with "unknown".
  }
  return {
    productsSynced: products > 0,
    videoCount,
    publishedWidgets,
    appEmbed,
    themeEditorUrl: `https://${store.shopDomain}/admin/themes/current/editor?context=apps&activateAppId=${deps.env.SHOPIFY_API_KEY}/${APP_EMBED_HANDLE}`,
  };
}
