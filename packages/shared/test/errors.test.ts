import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from '../src/index.ts';

describe('apiErrorSchema', () => {
  it('accepts a known error code', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success).toBe(true);
  });

  it('rejects unknown codes', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(false);
  });
});
