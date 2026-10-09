import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashPassword, verifyPassword } from '../src/lib/crypto.js';
import { TENANT_MODELS } from '../src/lib/tenant-guard.js';
import { verifySessionToken } from '../src/modules/shopify/session-token.js';
import { normalizeShopDomain } from '../src/modules/shopify/shop-domain.js';
import { TEST_SHOPIFY } from './env.js';
import { sessionToken } from './helpers.js';

const KEY = Buffer.alloc(32, 1).toString('base64');
const opts = { apiKey: TEST_SHOPIFY.apiKey, apiSecret: TEST_SHOPIFY.apiSecret };
const SHOP = 'a-shop.myshopify.com';

describe('encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('shpat_secret', KEY);
    expect(a).not.toContain('shpat_secret');
    expect(a).not.toBe(encrypt('shpat_secret', KEY));
    expect(decrypt(a, KEY)).toBe('shpat_secret');
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const [v, iv, tag, ct] = encrypt('x', KEY).split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString('base64url')].join('.'), KEY)).toThrow();
    expect(() => decrypt(encrypt('x', KEY), Buffer.alloc(32, 2).toString('base64'))).toThrow();
  });
});

describe('passwords', () => {
  it('verifies only the correct password', async () => {
    const h = await hashPassword('password1234');
    expect(await verifyPassword('password1234', h)).toBe(true);
    expect(await verifyPassword('password1235', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('normalizeShopDomain', () => {
  it.each([
    ['https://Pep-Tech.myshopify.com/', 'pep-tech.myshopify.com'],
    ['shop.myshopify.com', 'shop.myshopify.com'],
    ['evil.com', null],
    ['shop.myshopify.com.evil.com', null],
    ['', null],
  ])('%s -> %s', (input, expected) => expect(normalizeShopDomain(input)).toBe(expected));
});

describe('verifySessionToken', () => {
  it('accepts a valid token', () => {
    expect(verifySessionToken(sessionToken(SHOP, '42'), opts)).toMatchObject({ shop: SHOP, sub: '42' });
  });

  it.each([
    ['wrong secret', () => sessionToken(SHOP, '1', {}, 'other-secret'), /signature/],
    ['expired', () => sessionToken(SHOP, '1', { exp: Math.floor(Date.now() / 1000) - 60 }), /expired/],
    ['not yet valid', () => sessionToken(SHOP, '1', { nbf: Math.floor(Date.now() / 1000) + 60 }), /not yet valid/],
    ['wrong audience', () => sessionToken(SHOP, '1', { aud: 'other-app' }), /audience/],
    ['iss/dest mismatch', () => sessionToken(SHOP, '1', { iss: 'https://other.myshopify.com/admin' }), /shop mismatch/],
    ['non-Shopify dest', () => sessionToken(SHOP, '1', { dest: 'https://evil.com', iss: 'https://evil.com/admin' }), /shop mismatch/],
    ['malformed', () => 'not.a-jwt', /Malformed/],
  ])('rejects %s', (_name, make, msg) => {
    expect(() => verifySessionToken(make(), opts)).toThrow(msg);
  });

  it('rejects alg=none tokens', () => {
    const [, p] = sessionToken(SHOP, '1').split('.');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    expect(() => verifySessionToken(none, opts)).toThrow();
  });
});

describe('tenant model registry', () => {
  it('registers every store-owned model with the tenant guard', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    // System tables accessed only through rawDb with an explicit tenant: documented exceptions.
    const SYSTEM = new Set(['Store', 'Session', 'AuditLog', 'FeatureFlag']);
    const withStoreId = [...schema.matchAll(/model (\w+) \{([^}]*)\}/g)]
      .filter(([, , body]) => /^\s+storeId\s/m.test(body!))
      .map(([, name]) => name!);
    for (const model of withStoreId) {
      if (!SYSTEM.has(model)) expect(TENANT_MODELS.has(model), `${model} missing from TENANT_MODELS`).toBe(true);
    }
  });
});
