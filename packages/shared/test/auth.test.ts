import { describe, expect, it } from 'vitest';
import { hasRole, registerSchema, updateRoleSchema } from '../src/index.ts';

describe('roles', () => {
  it('orders roles by privilege', () => {
    expect(hasRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasRole('EDITOR', 'EDITOR')).toBe(true);
    expect(hasRole('ANALYST', 'EDITOR')).toBe(false);
    expect(hasRole('ADMIN', 'OWNER')).toBe(false);
  });

  it('does not allow assigning OWNER via role update', () => {
    expect(updateRoleSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('normalizes email and enforces password strength', () => {
    expect(registerSchema.parse({ email: 'A@B.co', password: 'abcdefghij1', name: 'A' }).email).toBe('a@b.co');
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'short1', name: 'A' }).success).toBe(false);
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'onlyletterslong', name: 'A' }).success).toBe(false);
  });
});
