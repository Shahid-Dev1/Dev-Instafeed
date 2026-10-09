import type { Deps } from '../../deps.js';
import type { Provider, ProviderAccount } from '../../generated/prisma/client.js';
import { decrypt, encrypt, randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { isEnabled, type FlagKey } from '../../lib/feature-flags.js';
import { instagram, instagramConfigured } from '../videos/providers/instagram.js';
import { tiktok, tiktokConfigured } from '../videos/providers/tiktok.js';
import { ReauthRequiredError, type OAuthTokens } from '../videos/providers/types.js';

export type ProviderSlug = 'tiktok' | 'instagram';
export const PROVIDER: Record<ProviderSlug, Provider> = { tiktok: 'TIKTOK', instagram: 'INSTAGRAM' };
const FLAG: Record<ProviderSlug, FlagKey> = { tiktok: 'tiktok_display_api', instagram: 'instagram_api' };
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export const providerConfigured = (deps: Deps, p: ProviderSlug) => (p === 'tiktok' ? tiktokConfigured(deps) : instagramConfigured(deps));
export const redirectUri = (deps: Deps, p: ProviderSlug) => `${new URL(deps.env.SHOPIFY_APP_URL).origin}/oauth/${p}/callback`;

/** Provider connections need both the feature flag (external approval) and credentials. */
export async function assertProviderAvailable(deps: Deps, storeId: string, p: ProviderSlug): Promise<void> {
  if (!(await isEnabled(deps.rawDb, FLAG[p], storeId))) throw new AppError('FORBIDDEN', `${p === 'tiktok' ? 'TikTok' : 'Instagram'} account import is not enabled`);
  if (!providerConfigured(deps, p)) throw new AppError('SERVICE_UNAVAILABLE', `${p === 'tiktok' ? 'TikTok' : 'Instagram'} is not configured`);
}

export async function providerEnabled(deps: Deps, storeId: string, p: ProviderSlug) {
  return isEnabled(deps.rawDb, FLAG[p], storeId);
}

/** Creates a single-use state bound to store + user; only its hash is stored. */
export async function createOAuthState(deps: Deps, storeId: string, userId: string, p: ProviderSlug): Promise<string> {
  const state = randomToken();
  await deps.db.oAuthState.deleteMany({ where: { storeId, expiresAt: { lt: new Date() } } });
  await deps.db.oAuthState.create({ data: { stateHash: sha256(state), storeId, userId, provider: PROVIDER[p], expiresAt: new Date(Date.now() + STATE_TTL_MS) } });
  return state;
}

/** Atomically consumes a state (delete-returning), so a replayed callback fails. */
export async function consumeOAuthState(deps: Deps, state: string, p: ProviderSlug) {
  const rows = await deps.rawDb.$queryRaw<{ storeId: string; userId: string; provider: string; expiresAt: Date }[]>`
    DELETE FROM "OAuthState" WHERE "stateHash" = ${sha256(state)} RETURNING "storeId", "userId", "provider", "expiresAt"`;
  const row = rows[0];
  if (!row || row.provider !== PROVIDER[p] || row.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 'Invalid or expired authorization request');
  return row;
}

export async function saveAccount(deps: Deps, storeId: string, userId: string, p: ProviderSlug, t: OAuthTokens): Promise<ProviderAccount> {
  const key = deps.env.ENCRYPTION_KEY;
  const data = {
    externalUserId: t.externalUserId,
    username: t.username,
    accessTokenEnc: encrypt(t.accessToken, key),
    accessTokenExpiresAt: t.accessTokenExpiresAt,
    refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken, key) : null,
    refreshTokenExpiresAt: t.refreshTokenExpiresAt,
    scopes: t.scopes,
    status: 'ACTIVE',
    lastError: null,
    connectedById: userId,
  };
  return deps.db.providerAccount.upsert({
    where: { storeId_provider: { storeId, provider: PROVIDER[p] } },
    create: { storeId, provider: PROVIDER[p], ...data },
    update: data,
  });
}

export async function getAccount(deps: Deps, storeId: string, p: ProviderSlug) {
  return deps.db.providerAccount.findUnique({ where: { storeId_provider: { storeId, provider: PROVIDER[p] } } });
}

async function markReauth(deps: Deps, storeId: string, p: ProviderSlug, message: string) {
  await deps.db.providerAccount.updateMany({ where: { storeId, provider: PROVIDER[p] }, data: { status: 'REAUTH_REQUIRED', lastError: message.slice(0, 300) } });
}

/** Returns a usable access token, refreshing TikTok tokens on demand; revoked/expired grants require reconnecting. */
export async function getProviderToken(deps: Deps, storeId: string, p: ProviderSlug): Promise<string> {
  const account = await getAccount(deps, storeId, p);
  if (!account) throw new AppError('NOT_FOUND', 'Account is not connected');
  if (account.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED', 'Reconnect your account to continue');
  const key = deps.env.ENCRYPTION_KEY;
  if (account.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) return decrypt(account.accessTokenEnc, key);

  if (p === 'tiktok' && account.refreshTokenEnc && (!account.refreshTokenExpiresAt || account.refreshTokenExpiresAt > new Date())) {
    try {
      const t = await tiktok.refresh(deps, decrypt(account.refreshTokenEnc, key));
      await deps.db.providerAccount.update({
        where: { storeId_provider: { storeId, provider: 'TIKTOK' } },
        data: {
          accessTokenEnc: encrypt(t.accessToken, key),
          accessTokenExpiresAt: t.accessTokenExpiresAt,
          ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken, key), refreshTokenExpiresAt: t.refreshTokenExpiresAt } : {}),
        },
      });
      return t.accessToken;
    } catch (err) {
      if (!(err instanceof ReauthRequiredError)) throw err;
      await markReauth(deps, storeId, p, err.message);
    }
  } else {
    await markReauth(deps, storeId, p, 'Authorization expired');
  }
  throw new AppError('UNAUTHENTICATED', 'Reconnect your account to continue');
}

/** Runs a provider call; if the provider reports the grant revoked, flags the account for reconnection. */
export async function withProviderToken<T>(deps: Deps, storeId: string, p: ProviderSlug, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getProviderToken(deps, storeId, p);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await markReauth(deps, storeId, p, err.message);
      throw new AppError('UNAUTHENTICATED', 'Reconnect your account to continue');
    }
    throw err;
  }
}

/** Instagram long-lived tokens are refreshed when 24h+ old and within 30 days of expiry (scheduled job). */
export async function refreshInstagramTokens(deps: Deps): Promise<number> {
  const key = deps.env.ENCRYPTION_KEY;
  const due = await deps.rawDb.providerAccount.findMany({
    where: {
      provider: 'INSTAGRAM',
      status: 'ACTIVE',
      updatedAt: { lt: new Date(Date.now() - 24 * 3600_000) },
      accessTokenExpiresAt: { lt: new Date(Date.now() + 30 * 86400_000) },
    },
  });
  let refreshed = 0;
  for (const a of due) {
    try {
      const t = await instagram.refresh(deps, decrypt(a.accessTokenEnc, key));
      await deps.db.providerAccount.update({
        where: { storeId_provider: { storeId: a.storeId, provider: 'INSTAGRAM' } },
        data: { accessTokenEnc: encrypt(t.accessToken, key), accessTokenExpiresAt: t.accessTokenExpiresAt, lastError: null },
      });
      refreshed++;
    } catch (err) {
      if (err instanceof ReauthRequiredError) await markReauth(deps, a.storeId, 'instagram', err.message);
    }
  }
  return refreshed;
}
