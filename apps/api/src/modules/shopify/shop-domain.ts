const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Returns the normalized shop domain or null when it is not a valid *.myshopify.com host. */
export function normalizeShopDomain(input: string | undefined | null): string | null {
  if (!input) return null;
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return SHOP_RE.test(host) ? host : null;
}
