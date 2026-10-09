import { Worker } from 'bullmq';
import { parseEnv } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { createRedis } from './lib/redis.js';

loadRootEnvFile();
const env = parseEnv(process.env);
const connection = createRedis(env.REDIS_URL);

// Job processors are registered per module as later phases add them.
const workers = [
  new Worker('maintenance', async (job) => ({ ok: true, name: job.name }), { connection }),
];

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
console.warn(`[worker] started: ${workers.map((w) => w.name).join(', ')}`);
