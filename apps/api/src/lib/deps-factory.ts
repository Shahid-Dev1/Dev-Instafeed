import type { Env } from '../config/env.js';
import type { Deps } from '../deps.js';
import { createDb } from './db.js';
import { createRedis } from './redis.js';
import { withTenantGuard } from './tenant-guard.js';

export function createDeps(env: Env, fetchFn: typeof fetch = fetch): Deps {
  const rawDb = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  return {
    env,
    rawDb,
    db: withTenantGuard(rawDb),
    redis,
    fetch: fetchFn,
    checks: {
      database: async () => void (await rawDb.$queryRaw`SELECT 1`),
      redis: async () => void (await redis.ping()),
    },
  };
}

export async function closeDeps(deps: Deps): Promise<void> {
  await Promise.allSettled([deps.rawDb.$disconnect(), deps.redis.quit()]);
}
