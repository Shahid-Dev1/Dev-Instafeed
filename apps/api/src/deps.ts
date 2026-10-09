import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Env } from './config/env.js';
import type { Db } from './lib/db.js';
import type { TenantDb } from './lib/tenant-guard.js';
import type { HealthChecks } from './modules/health/routes.js';
import type { FetchFn } from './modules/shopify/client.js';

/** Everything a module needs, injected so tests can swap the network boundary. */
export interface Deps {
  env: Env;
  /** Unguarded client: only for auth, install and webhooks, which resolve the tenant themselves. */
  rawDb: Db;
  /** Tenant-guarded client: required for all store-owned data in feature modules. */
  db: TenantDb;
  redis: Redis;
  fetch: FetchFn;
  checks: HealthChecks;
  queues: { products: Queue; videos: Queue };
  /** Injected so retry/backoff paths run instantly in tests. */
  sleep: (ms: number) => Promise<void>;
}
