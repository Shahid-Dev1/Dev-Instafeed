import { readinessSchema } from '@instafeed/shared';
import { describe, expect, it } from 'vitest';
import { apiFetch, ApiRequestError } from '../lib/api';

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  it('returns schema-validated data', async () => {
    const body = { status: 'ok', checks: { database: 'ok', redis: 'ok' } };
    await expect(apiFetch('http://x', '/h', readinessSchema, undefined, json(200, body))).resolves.toEqual(body);
  });

  it('surfaces the API error envelope', async () => {
    const run = apiFetch('http://x', '/h', readinessSchema, undefined, json(403, { error: { code: 'FORBIDDEN', message: 'no' } }));
    await expect(run).rejects.toMatchObject({ status: 403, error: { code: 'FORBIDDEN' } });
  });

  it('reports an unreachable API', async () => {
    const run = apiFetch('http://x', '/h', readinessSchema, undefined, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(run).rejects.toBeInstanceOf(ApiRequestError);
    await expect(run).rejects.toMatchObject({ status: 0, error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('rejects malformed success bodies', async () => {
    await expect(apiFetch('http://x', '/h', readinessSchema, undefined, json(200, { nope: 1 }))).rejects.toMatchObject({
      error: { code: 'INTERNAL' },
    });
  });
});
