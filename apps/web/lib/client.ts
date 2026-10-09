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

/** Browser API call: Shopify session token when embedded, otherwise the httpOnly session cookie. */
export async function clientApi<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers['content-type'] = 'application/json';
  if (window.shopify) headers.authorization = `Bearer ${await window.shopify.idToken()}`;
  else {
    const store = selectedStore();
    if (store) headers['x-store-id'] = store;
  }
  return apiFetch(window.location.origin, path, schema, { ...init, headers, credentials: 'same-origin' });
}

/** Navigates the top-level window (leaving the Shopify admin iframe), e.g. for provider OAuth consent screens. */
export function openTopLevel(url: string): void {
  window.open(url, '_top');
}

export const errorMessage = (e: unknown, fallback = 'Something went wrong') =>
  e instanceof Error && e.message ? e.message : fallback;
