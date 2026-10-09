/** Shopify storefront helpers: only public, same-origin Ajax APIs (no tokens). */

declare global {
  interface Window {
    Shopify?: { routes?: { root?: string }; currency?: { active?: string }; locale?: string };
  }
}

export const root = () => window.Shopify?.routes?.root ?? '/';
export const numericId = (gid: string | null | undefined) => (gid ? gid.split('/').pop() ?? null : null);

export function money(cents: number): string {
  const currency = window.Shopify?.currency?.active;
  const amount = cents / 100;
  try {
    return currency ? new Intl.NumberFormat(window.Shopify?.locale ?? undefined, { style: 'currency', currency }).format(amount) : amount.toFixed(2);
  } catch {
    return amount.toFixed(2);
  }
}

export interface AjaxVariant {
  id: number;
  title: string;
  price: number;
  available: boolean;
  options: string[];
  featured_image?: { src: string } | null;
}
export interface AjaxProduct {
  id: number;
  title: string;
  handle: string;
  featured_image?: string | null;
  options: { name: string; values: string[] }[];
  variants: AjaxVariant[];
}

export class StorefrontError extends Error {}

export async function fetchProduct(handle: string): Promise<AjaxProduct> {
  const res = await fetch(`${root()}products/${encodeURIComponent(handle)}.js`, { headers: { accept: 'application/json' } });
  if (res.status === 404) throw new StorefrontError('This product is no longer available.');
  if (!res.ok) throw new StorefrontError('Could not load the product. Please try again.');
  return res.json() as Promise<AjaxProduct>;
}

/** Adds to the cart via the Ajax Cart API; surfaces Shopify's own error text (e.g. sold out, limits). */
export async function addToCart(variantId: number, quantity: number, properties?: Record<string, string>): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${root()}cart/add.js`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: variantId, quantity, ...(properties ? { properties } : {}) }] }),
    });
  } catch {
    throw new StorefrontError('Network error. Check your connection and try again.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { description?: string; message?: string } | null;
    throw new StorefrontError(body?.description || body?.message || 'Could not add to cart. Please try again.');
  }
}

export const productUrl = (handle: string, variantId?: string | number | null) =>
  `${root()}products/${encodeURIComponent(handle)}${variantId ? `?variant=${variantId}` : ''}`;
