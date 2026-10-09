import type { FetchFn } from '../../shopify/client.js';
import { AppError } from '../../../lib/errors.js';

export interface JsonResponse<T> {
  status: number;
  ok: boolean;
  body: T | null;
}

/** JSON request to a provider API with uniform network/rate-limit error mapping. Never logs credentials. */
export async function providerJson<T>(fetchFn: FetchFn, provider: string, url: string, init?: RequestInit): Promise<JsonResponse<T>> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, headers: { accept: 'application/json', ...init?.headers } });
  } catch {
    throw new AppError('PROVIDER_ERROR', `${provider} is unreachable`);
  }
  if (res.status === 429) throw new AppError('RATE_LIMITED', `${provider} rate limit reached, try again shortly`);
  if (res.status >= 500) throw new AppError('PROVIDER_ERROR', `${provider} returned ${res.status}`);
  const body = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, ok: res.ok, body };
}

export const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});
