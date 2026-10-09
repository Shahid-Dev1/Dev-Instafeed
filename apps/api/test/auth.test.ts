import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { sha256 } from '../src/lib/crypto.js';
import { createTestContext, ORIGIN, registerUser, resetData, type TestContext } from './helpers.js';

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
beforeEach(() => resetData(t.deps));
afterAll(() => closeDeps(t.deps));

const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN, ...headers } });

describe('email registration and login', () => {
  it('registers, reads /me, logs out and invalidates the session', async () => {
    const cookie = await registerUser(t.app, 'Owner@Brand.com');
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: 'owner@brand.com' }, memberships: [], current: null });

    const user = await t.deps.rawDb.user.findFirstOrThrow();
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain('password1234');

    expect((await post('/api/v1/auth/logout', {}, { cookie })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await registerUser(t.app, 'a@b.co');
    const raw = cookie.split('=')[1]!;
    const session = await t.deps.rawDb.session.findFirstOrThrow();
    expect(session.tokenHash).toBe(sha256(raw));
  });

  it('rejects duplicate emails, invalid input and wrong passwords', async () => {
    await registerUser(t.app, 'a@b.co');
    expect((await post('/api/v1/auth/register', { email: 'A@b.co', password: 'password1234', name: 'x' })).statusCode).toBe(409);
    const bad = await post('/api/v1/auth/register', { email: 'nope', password: 'short', name: '' });
    expect(bad.statusCode).toBe(400);
    expect([...new Set(bad.json().error.details.map((d: { path: string }) => d.path))].sort()).toEqual(['email', 'name', 'password']);
    expect((await post('/api/v1/auth/login', { email: 'a@b.co', password: 'wrongpass123' })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: 'ghost@b.co', password: 'wrongpass123' })).json().error.message).toBe(
      'Invalid email or password',
    );
    expect((await post('/api/v1/auth/login', { email: 'a@b.co', password: 'password1234' })).statusCode).toBe(200);
  });

  it('rate-limits repeated login attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post('/api/v1/auth/login', { email: 'x@y.co', password: 'wrongpass123' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('rejects expired sessions', async () => {
    const cookie = await registerUser(t.app, 'a@b.co');
    await t.deps.rawDb.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('requires authentication', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });
});
