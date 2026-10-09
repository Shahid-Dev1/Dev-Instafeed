import { hmacSha256, safeEqual } from '../../lib/crypto.js';

/**
 * Shopify App Proxy signature: every query param except `signature`, sorted by key, formatted as key=value
 * (repeated keys joined with ","), concatenated without separators, HMAC-SHA256 hex with the app secret.
 * https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 */
export function verifyProxySignature(rawQuery: string, secret: string): boolean {
  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  if (!signature) return false;
  const grouped = new Map<string, string[]>();
  for (const [k, v] of params) if (k !== 'signature') grouped.set(k, [...(grouped.get(k) ?? []), v]);
  const message = [...grouped.entries()]
    .map(([k, vs]) => `${k}=${vs.join(',')}`)
    .sort()
    .join('');
  return safeEqual(hmacSha256(secret, message).toString('hex'), signature);
}
