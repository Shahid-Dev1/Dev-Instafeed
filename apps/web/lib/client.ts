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

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers = { ...extra };
  if (window.shopify) headers.authorization = `Bearer ${await window.shopify.idToken()}`;
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
