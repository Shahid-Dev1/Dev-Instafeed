import { apiErrorSchema, type ApiError } from '@instafeed/shared';
import type { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError['error'],
  ) {
    super(error.message);
  }
}

/** Typed fetch: validates successful responses against `schema` and normalizes error envelopes. */
export async function apiFetch<S extends z.ZodType>(
  baseUrl: string,
  path: string,
  schema: S,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetchImpl(new URL(path, baseUrl), { ...init, headers: { accept: 'application/json', ...init?.headers } });
  } catch {
    throw new ApiRequestError(0, { code: 'SERVICE_UNAVAILABLE', message: 'API is unreachable' });
  }
  const body: unknown = await res.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const err = apiErrorSchema.safeParse(body);
  throw new ApiRequestError(
    res.status,
    err.success ? err.data.error : { code: 'INTERNAL', message: `Unexpected response (${res.status})` },
  );
}
