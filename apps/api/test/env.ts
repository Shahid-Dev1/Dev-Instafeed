import { parseEnv, type Env } from '../src/config/env.js';
import { loadRootEnvFile } from '../src/config/load-env-file.js';

/** Test env: always points at the dedicated test database, never the dev one. */
export function testEnv(): Env {
  loadRootEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set to run tests');
  return parseEnv({ ...process.env, NODE_ENV: 'test', DATABASE_URL: url });
}
