import { Worker } from 'bullmq';
import { parseEnv } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { closeDeps, createDeps } from './lib/deps-factory.js';
import { createRedis } from './lib/redis.js';
import { processProductJob } from './modules/products/jobs.js';

loadRootEnvFile();
const deps = createDeps(parseEnv(process.env));
// Workers block on Redis, so they need their own connection.
const connection = createRedis(deps.env.REDIS_URL);

const workers = [
  new Worker('products', (job) => processProductJob(deps, job), { connection, prefix: deps.env.QUEUE_PREFIX, concurrency: 5 }),
];
for (const w of workers) {
  w.on('failed', (job, err) => console.error(`[worker] ${w.name}/${job?.name} ${job?.id} failed: ${err.message}`));
}

// Nightly catalog reconciliation for every installed store (03:00 UTC).
await deps.queues.products.upsertJobScheduler('nightly-reconcile', { pattern: '0 3 * * *' }, { name: 'reconcile-all', data: {} });

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  await closeDeps(deps);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
console.warn(`[worker] started: ${workers.map((w) => w.name).join(', ')}`);
