import type { Deps } from '../../deps.js';
import type { Store } from '../../generated/prisma/client.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { enqueueEnsurePixel } from '../analytics/jobs.js';
import { enqueueFullSync } from '../products/jobs.js';
import { adminGraphql, exchangeSessionToken, refreshOfflineToken, type OfflineToken, type ShopifyAppCredentials } from './client.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const shopifyCreds = (deps: Deps): ShopifyAppCredentials => ({
  apiKey: deps.env.SHOPIFY_API_KEY,
  apiSecret: deps.env.SHOPIFY_API_SECRET,
  apiVersion: deps.env.SHOPIFY_API_VERSION,
});

function tokenFields(deps: Deps, t: OfflineToken) {
  const key = deps.env.ENCRYPTION_KEY;
  return {
    accessTokenEnc: encrypt(t.accessToken, key),
    accessTokenExpiresAt: t.accessTokenExpiresAt,
    refreshTokenEnc: encrypt(t.refreshToken, key),
    refreshTokenExpiresAt: t.refreshTokenExpiresAt,
    scopes: t.scopes,
  };
}

/** True when the store has no usable offline credentials and must go through token exchange. */
export function needsInstall(store: Store | null, now = new Date()): boolean {
  return (
    !store ||
    store.uninstalledAt !== null ||
    !store.refreshTokenEnc ||
    !store.refreshTokenExpiresAt ||
    store.refreshTokenExpiresAt.getTime() - REFRESH_MARGIN_MS < now.getTime()
  );
}

const SHOP_QUERY = `query { shop { name currencyCode ianaTimezone } }`;

/** Shopify-managed install / reinstall: exchange the session token, store encrypted tokens, load shop details. */
export async function installFromSessionToken(deps: Deps, shop: string, sessionToken: string): Promise<Store> {
  const creds = shopifyCreds(deps);
  const token = await exchangeSessionToken(deps.fetch, creds, shop, sessionToken);
  const info = await adminGraphql<{ shop: { name: string; currencyCode: string; ianaTimezone: string } }>(
    deps.fetch,
    creds,
    shop,
    token.accessToken,
    SHOP_QUERY,
  );

  const existing = await deps.rawDb.store.findUnique({ where: { shopDomain: shop } });
  const data = {
    ...tokenFields(deps, token),
    name: info.shop.name,
    currency: info.shop.currencyCode,
    timezone: info.shop.ianaTimezone,
    uninstalledAt: null,
    ...(existing?.uninstalledAt || !existing ? { installedAt: new Date() } : {}),
  };
  const store = await deps.rawDb.store.upsert({ where: { shopDomain: shop }, create: { shopDomain: shop, ...data }, update: data });
  if (!existing || existing.uninstalledAt) {
    await audit(deps.rawDb, {
      storeId: store.id,
      actorType: 'SHOPIFY',
      action: existing ? 'store.reinstalled' : 'store.installed',
      meta: { scopes: token.scopes },
    });
    await enqueueFullSync(deps, store.id, 'INSTALL');
    await enqueueEnsurePixel(deps, store.id);
  }
  return store;
}

/**
 * Returns a valid Admin API access token, refreshing it when close to expiry.
 * A Redis lock prevents concurrent refreshes from racing on the rotating refresh token.
 */
export async function getAccessToken(deps: Deps, storeId: string): Promise<string> {
  const key = deps.env.ENCRYPTION_KEY;
  const load = () => deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId } });
  const fresh = (s: Store) =>
    s.accessTokenEnc && s.accessTokenExpiresAt && s.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();

  let store = await load();
  if (store.uninstalledAt) throw new AppError('FORBIDDEN', 'Store has uninstalled the app');
  if (fresh(store)) return decrypt(store.accessTokenEnc!, key);

  const lockKey = `lock:shopify-refresh:${storeId}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await deps.redis.set(lockKey, '1', 'PX', 15_000, 'NX')) {
      try {
        store = await load();
        if (fresh(store)) return decrypt(store.accessTokenEnc!, key);
        if (needsInstall(store)) throw new AppError('UNAUTHENTICATED', 'Store must be re-authorized from Shopify admin');
        const token = await refreshOfflineToken(deps.fetch, shopifyCreds(deps), store.shopDomain, decrypt(store.refreshTokenEnc!, key));
        await deps.rawDb.store.update({ where: { id: storeId }, data: tokenFields(deps, token) });
        return token.accessToken;
      } finally {
        await deps.redis.del(lockKey);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    store = await load();
    if (fresh(store)) return decrypt(store.accessTokenEnc!, key);
  }
  throw new AppError('SERVICE_UNAVAILABLE', 'Timed out waiting for token refresh');
}
