import { parseEnv, type Env } from '../src/config/env.js';
import { loadRootEnvFile } from '../src/config/load-env-file.js';

/** Fixed test-only Shopify credentials: tests never use the developer's real app secret. */
export const TEST_SHOPIFY = { apiKey: 'test-api-key', apiSecret: 'test-api-secret' };

/** Test env: always points at the dedicated test database, never the dev one. */
export function testEnv(): Env {
  loadRootEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set to run tests');
  return parseEnv({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    SHOPIFY_API_KEY: TEST_SHOPIFY.apiKey,
    SHOPIFY_API_SECRET: TEST_SHOPIFY.apiSecret,
    SHOPIFY_SCOPES: 'read_products,read_orders,read_themes',
    SHOPIFY_APP_URL: 'https://app.test',
    WEB_URL: 'http://localhost:3000',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    QUEUE_PREFIX: 'ifq-test',
  });
}
