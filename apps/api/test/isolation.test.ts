import type { Role } from '@instafeed/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDeps } from '../src/lib/deps-factory.js';
import { TenantScopeError } from '../src/lib/tenant-guard.js';
import { createTestContext, installShop, ORIGIN, registerUser, resetData, type TestContext } from './helpers.js';

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => closeDeps(t.deps));

let storeA: string;
let storeB: string;
let bobId: string; // member of store B
const cookies: Partial<Record<Role | 'B_ADMIN', string>> = {};

async function addMember(storeId: string, email: string, role: Role): Promise<string> {
  const cookie = await registerUser(t.app, email);
  const user = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email } });
  await t.deps.db.membership.create({ data: { storeId, userId: user.id, role } });
  await t.deps.rawDb.session.updateMany({ where: { userId: user.id }, data: { storeId } });
  return cookie;
}

beforeEach(async () => {
  await resetData(t.deps);
  storeA = await installShop(t, 'store-a.myshopify.com', '1');
  storeB = await installShop(t, 'store-b.myshopify.com', '1');
  for (const role of ['OWNER', 'ADMIN', 'EDITOR', 'ANALYST'] as const) {
    // OWNER exists from install; this owner is a second, email-based owner for cookie tests.
    cookies[role] = await addMember(storeA, `${role.toLowerCase()}@a.co`, role);
  }
  cookies.B_ADMIN = await addMember(storeB, 'bob@b.co', 'ADMIN');
  bobId = (await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'bob@b.co' } })).id;
});

const req = (method: 'GET' | 'PATCH' | 'DELETE', url: string, cookie: string, extra: Record<string, string> = {}, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...extra }, payload });

describe('tenant isolation', () => {
  it('store A admin sees only store A members', async () => {
    const res = await req('GET', '/api/v1/team', cookies.ADMIN!);
    expect(res.statusCode).toBe(200);
    const emails = res.json().members.map((m: { email: string | null }) => m.email);
    expect(emails).not.toContain('bob@b.co');
    expect(emails).toContain('admin@a.co');
  });

  it('store A admin cannot modify or remove a store B member', async () => {
    expect((await req('PATCH', `/api/v1/team/${bobId}`, cookies.ADMIN!, {}, { role: 'ANALYST' })).statusCode).toBe(404);
    expect((await req('DELETE', `/api/v1/team/${bobId}`, cookies.ADMIN!)).statusCode).toBe(404);
    const bob = await t.deps.db.membership.findUniqueOrThrow({ where: { storeId_userId: { storeId: storeB, userId: bobId } } });
    expect(bob.role).toBe('ADMIN');
  });

  it('cannot switch into a store the user is not a member of', async () => {
    const res = await req('GET', '/api/v1/team', cookies.ADMIN!, { 'x-store-id': storeB });
    expect(res.statusCode).toBe(403);
    // Unknown store ids get the identical response, so ids cannot be probed.
    const unknown = await req('GET', '/api/v1/team', cookies.ADMIN!, { 'x-store-id': 'does-not-exist' });
    expect(unknown.statusCode).toBe(403);
    expect(unknown.json()).toEqual(res.json());
  });

  it('a Shopify session token for store B never resolves to store A', async () => {
    const { sessionToken } = await import('./helpers.js');
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/team',
      headers: { authorization: `Bearer ${sessionToken('store-b.myshopify.com', '1')}`, 'x-store-id': storeA },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().members.map((m: { email: string | null }) => m.email)).toEqual([null, 'bob@b.co']);
  });

  it('uninstalled stores are not accessible by members', async () => {
    await t.deps.rawDb.store.update({ where: { id: storeA }, data: { uninstalledAt: new Date() } });
    expect((await req('GET', '/api/v1/team', cookies.ADMIN!)).statusCode).toBe(403);
  });

  it('the tenant guard rejects unscoped queries on store-owned models', async () => {
    await expect(t.deps.db.membership.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(t.deps.db.membership.findMany({ where: { role: 'ADMIN' } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(t.deps.db.membership.deleteMany({ where: { userId: bobId } })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(t.deps.db.membership.count({ where: { storeId: storeA } })).resolves.toBe(5);
  });
});

describe('role-based access to team management', () => {
  it.each([
    ['OWNER', 200],
    ['ADMIN', 200],
    ['EDITOR', 403],
    ['ANALYST', 403],
  ] as const)('%s listing team -> %i', async (role, status) => {
    expect((await req('GET', '/api/v1/team', cookies[role]!)).statusCode).toBe(status);
  });

  it('admins change roles; editors and analysts cannot', async () => {
    const analyst = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'analyst@a.co' } });
    expect((await req('PATCH', `/api/v1/team/${analyst.id}`, cookies.EDITOR!, {}, { role: 'EDITOR' })).statusCode).toBe(403);
    expect((await req('PATCH', `/api/v1/team/${analyst.id}`, cookies.ADMIN!, {}, { role: 'EDITOR' })).statusCode).toBe(200);
    expect(await t.deps.rawDb.auditLog.count({ where: { action: 'team.role_changed', storeId: storeA } })).toBe(1);
  });

  it('protects the owner, self-changes and owner promotion', async () => {
    const owner = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'owner@a.co' } });
    const admin = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'admin@a.co' } });
    expect((await req('PATCH', `/api/v1/team/${owner.id}`, cookies.ADMIN!, {}, { role: 'ANALYST' })).statusCode).toBe(403);
    expect((await req('DELETE', `/api/v1/team/${admin.id}`, cookies.ADMIN!)).statusCode).toBe(403);
    const editor = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'editor@a.co' } });
    expect((await req('PATCH', `/api/v1/team/${editor.id}`, cookies.ADMIN!, {}, { role: 'OWNER' })).statusCode).toBe(400);
  });

  it('rejects cookie-authenticated mutations from foreign origins (CSRF)', async () => {
    const editor = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'editor@a.co' } });
    const res = await req('PATCH', `/api/v1/team/${editor.id}`, cookies.ADMIN!, { origin: 'https://evil.example' }, { role: 'ANALYST' });
    expect(res.statusCode).toBe(403);
  });

  it('removing a member revokes their store sessions', async () => {
    const editor = await t.deps.rawDb.user.findUniqueOrThrow({ where: { email: 'editor@a.co' } });
    expect((await req('DELETE', `/api/v1/team/${editor.id}`, cookies.ADMIN!)).statusCode).toBe(200);
    expect((await req('GET', '/api/v1/me', cookies.EDITOR!)).statusCode).toBe(401);
  });
});
