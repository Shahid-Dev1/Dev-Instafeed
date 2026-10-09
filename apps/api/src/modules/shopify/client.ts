import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

export type FetchFn = typeof fetch;

export interface ShopifyAppCredentials {
  apiKey: string;
  apiSecret: string;
  apiVersion: string;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  refresh_token_expires_in: z.number().int().positive(),
});

export interface OfflineToken {
  accessToken: string;
  scopes: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

async function requestToken(fetchFn: FetchFn, shop: string, body: Record<string, string>): Promise<OfflineToken> {
  let res: Response;
  try {
    res = await fetchFn(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AppError('PROVIDER_ERROR', 'Shopify is unreachable');
  }
  if (res.status === 400 || res.status === 401) throw new AppError('UNAUTHENTICATED', 'Shopify rejected the token request');
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `Shopify token endpoint returned ${res.status}`);
  const parsed = tokenResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AppError('PROVIDER_ERROR', 'Unexpected Shopify token response');
  const t = parsed.data;
  const now = Date.now();
  return {
    accessToken: t.access_token,
    scopes: t.scope,
    accessTokenExpiresAt: new Date(now + t.expires_in * 1000),
    refreshToken: t.refresh_token,
    refreshTokenExpiresAt: new Date(now + t.refresh_token_expires_in * 1000),
  };
}

/** Exchanges an App Bridge session token for an expiring offline access token (Shopify-managed install). */
export function exchangeSessionToken(fetchFn: FetchFn, creds: ShopifyAppCredentials, shop: string, sessionToken: string) {
  return requestToken(fetchFn, shop, {
    client_id: creds.apiKey,
    client_secret: creds.apiSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: sessionToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  });
}

export function refreshOfflineToken(fetchFn: FetchFn, creds: ShopifyAppCredentials, shop: string, refreshToken: string) {
  return requestToken(fetchFn, shop, {
    client_id: creds.apiKey,
    client_secret: creds.apiSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

export async function adminGraphql<T>(
  fetchFn: FetchFn,
  creds: ShopifyAppCredentials,
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(`https://${shop}/admin/api/${creds.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': accessToken },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new AppError('PROVIDER_ERROR', 'Shopify is unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new AppError('UNAUTHENTICATED', 'Shopify access token rejected');
  if (res.status === 429) throw new AppError('RATE_LIMITED', 'Shopify rate limit reached');
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `Shopify GraphQL returned ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors || !json.data) throw new AppError('PROVIDER_ERROR', 'Shopify GraphQL error', json.errors);
  return json.data;
}
