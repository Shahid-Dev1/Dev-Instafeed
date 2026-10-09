import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';

const valid = {
  API_URL: 'http://localhost:4000',
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies defaults to a valid environment', () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces the port', () => {
    expect(parseEnv({ ...valid, API_PORT: '5001' }).API_PORT).toBe(5001);
  });

  it('reports every invalid or missing variable', () => {
    const run = () => parseEnv({ ...valid, DATABASE_URL: 'mysql://x', REDIS_URL: undefined, API_PORT: '99999' });
    expect(run).toThrow(EnvValidationError);
    expect(run).toThrow(/DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/);
    expect(run).toThrow(/API_PORT/);
  });
});
