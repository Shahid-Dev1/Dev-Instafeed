import { AppError } from '../../lib/errors.js';
import { hmacSha256, safeEqual } from '../../lib/crypto.js';
import { normalizeShopDomain } from './shop-domain.js';

export interface SessionTokenClaims {
  shop: string;
  /** Shopify staff user id. */
  sub: string;
  sid?: string;
}

const LEEWAY_SEC = 5;

function decodePart(part: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Malformed session token');
  }
}

/**
 * Verifies an App Bridge session token (HS256 JWT signed with the app secret).
 * https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens
 */
export function verifySessionToken(
  token: string,
  opts: { apiKey: string; apiSecret: string; nowSec?: number },
): SessionTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('UNAUTHENTICATED', 'Malformed session token');
  const [h, p, sig] = parts as [string, string, string];

  if (decodePart(h).alg !== 'HS256') throw new AppError('UNAUTHENTICATED', 'Unsupported token algorithm');
  const expected = hmacSha256(opts.apiSecret, `${h}.${p}`).toString('base64url');
  if (!safeEqual(expected, sig)) throw new AppError('UNAUTHENTICATED', 'Invalid session token signature');

  const claims = decodePart(p);
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now - LEEWAY_SEC) throw new AppError('UNAUTHENTICATED', 'Session token expired');
  if (typeof claims.nbf !== 'number' || claims.nbf > now + LEEWAY_SEC) throw new AppError('UNAUTHENTICATED', 'Session token not yet valid');
  if (claims.aud !== opts.apiKey) throw new AppError('UNAUTHENTICATED', 'Session token audience mismatch');

  const shop = normalizeShopDomain(typeof claims.dest === 'string' ? claims.dest : null);
  const issShop = normalizeShopDomain(typeof claims.iss === 'string' ? claims.iss : null);
  if (!shop || shop !== issShop) throw new AppError('UNAUTHENTICATED', 'Session token shop mismatch');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AppError('UNAUTHENTICATED', 'Session token missing user');

  return { shop, sub: claims.sub, sid: typeof claims.sid === 'string' ? claims.sid : undefined };
}
