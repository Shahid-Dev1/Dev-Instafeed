import type { z } from 'zod';
import { apiFetch } from './api';

declare global {
  interface Window {
    /** Injected by the App Bridge script when embedded in Shopify admin. */
    shopify?: { idToken(): Promise<string> };
  }
}

const STORE_KEY = 'ifs_store';

export function selectedStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

export function selectStore(storeId: string): void {
  try {
    localStorage.setItem(STORE_KEY, storeId);
  } catch {
    /* storage unavailable: the server-side default store is used */
  }
}

/**
 * Embedded pages carry the shopify-api-key meta tag. Next.js async chunks can execute before the App Bridge CDN
 * script finishes loading, so wait for it (up to 5s) rather than falling back to cookie auth inside Shopify admin.
 */
async function appBridge(): Promise<Window['shopify']> {
  if (window.shopify || !document.querySelector('meta[name="shopify-api-key"]')) return window.shopify;
  for (let waited = 0; waited < 5000 && !window.shopify; waited += 50) await new Promise((r) => setTimeout(r, 50));
  return window.shopify;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers = { ...extra };
  const shopify = await appBridge();
  if (shopify) headers.authorization = `Bearer ${await shopify.idToken()}`;
  else {
    const store = selectedStore();
    if (store) headers['x-store-id'] = store;
  }
  return headers;
}

/** Browser API call: Shopify session token when embedded, otherwise the httpOnly session cookie. */
export async function clientApi<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const headers = await authHeaders({ ...(init.headers as Record<string, string>), ...(init.body ? { 'content-type': 'application/json' } : {}) });
  return apiFetch(window.location.origin, path, schema, { ...init, headers, credentials: 'same-origin' });
}

/** Authenticated file download (e.g. CSV export) saved via a temporary object URL. */
export async function clientDownload(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { headers: await authHeaders(), credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Navigates the top-level window (leaving the Shopify admin iframe), e.g. for provider OAuth consent screens. */
export function openTopLevel(url: string): void {
  window.open(url, '_top');
}

export const errorMessage = (e: unknown, fallback = 'Something went wrong') =>
  e instanceof Error && e.message ? e.message : fallback;
