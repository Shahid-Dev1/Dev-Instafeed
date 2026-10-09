import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { closeDeps, createDeps } from '../src/lib/deps-factory.js';
import { AppError, validate } from '../src/lib/errors.js';
import { testEnv } from './env.js';

const deps = createDeps(testEnv());
const realChecks = deps.checks;

afterAll(() => closeDeps(deps));

describe('health endpoints (real PostgreSQL and Redis)', () => {
  it('GET /health is ok', async () => {
    const app = await buildApp(deps);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready reports database and redis ok', async () => {
    const app = await buildApp(deps);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('GET /health/ready returns 503 when a dependency fails', async () => {
    const app = await buildApp({ ...deps, checks: { ...realChecks, database: async () => Promise.reject(new Error('down')) } });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ database: 'error', redis: 'ok' });
  });
});

describe('error envelope', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp(deps);
    app.post('/_test/validate', async (req) => validate(z.object({ name: z.string().min(1) }), req.body));
    app.get('/_test/forbidden', async () => {
      throw new AppError('FORBIDDEN', 'nope');
    });
    app.get('/_test/crash', async () => {
      throw new Error('secret internals');
    });
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION_ERROR with field details', async () => {
    const res = await app.inject({ method: 'POST', url: '/_test/validate', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'name' }] });
  });

  it('maps AppError codes to HTTP status', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/forbidden' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope' } });
  });

  it('hides internal error details', async () => {
    const res = await app.inject({ method: 'GET', url: '/_test/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internals');
  });
});
