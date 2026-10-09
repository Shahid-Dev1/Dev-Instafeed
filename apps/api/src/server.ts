import { buildApp } from './app.js';
import { parseEnv } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { createDb } from './lib/db.js';
import { createRedis } from './lib/redis.js';

loadRootEnvFile();
const env = parseEnv(process.env);
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

const app = await buildApp({
  env,
  checks: {
    database: async () => void (await db.$queryRaw`SELECT 1`),
    redis: async () => void (await redis.ping()),
  },
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.allSettled([db.$disconnect(), redis.quit()]);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
