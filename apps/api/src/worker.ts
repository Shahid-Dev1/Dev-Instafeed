import { Worker } from 'bullmq';
import { parseEnv } from './config/env.js';
import { loadRootEnvFile } from './config/load-env-file.js';
import { closeDeps, createDeps } from './lib/deps-factory.js';
import { createRedis } from './lib/redis.js';
import { processProductJob } from './modules/products/jobs.js';
import { processVideoJob } from './modules/videos/jobs.js';

loadRootEnvFile();
const deps = createDeps(parseEnv(process.env));
// Workers block on Redis, so they need their own connection.
const connection = createRedis(deps.env.REDIS_URL);

const workers = [
  new Worker('products', (job) => processProductJob(deps, job), { connection, prefix: deps.env.QUEUE_PREFIX, concurrency: 5 }),
  new Worker('videos', (job) => processVideoJob(deps, job), { connection, prefix: deps.env.QUEUE_PREFIX, concurrency: 5 }),
];
for (const w of workers) {
  w.on('failed', (job, err) => {
    console.error(`[worker] ${w.name}/${job?.name} ${job?.id} failed: ${err.message}`);
    // Out of retries: surface the failure on the video instead of leaving it "processing".
    if (job?.name === 'instagram-copy' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const { storeId, videoId } = job.data as { storeId: string; videoId: string };
      void deps.db.video
        .updateMany({ where: { storeId, id: videoId, status: { not: 'READY' } }, data: { status: 'FAILED', statusMessage: 'Could not copy the Reel from Instagram' } })
        .catch(() => undefined);
    }
  });
}

// Nightly catalog reconciliation for every installed store (03:00 UTC).
await deps.queues.products.upsertJobScheduler('nightly-reconcile', { pattern: '0 3 * * *' }, { name: 'reconcile-all', data: {} });
// Daily: embedded video availability/thumbnail checks, and Instagram long-lived token refresh.
await deps.queues.videos.upsertJobScheduler('recheck-embeds', { pattern: '30 3 * * *' }, { name: 'recheck-embeds', data: {} });
await deps.queues.videos.upsertJobScheduler('refresh-provider-tokens', { pattern: '0 4 * * *' }, { name: 'refresh-provider-tokens', data: {} });

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  await closeDeps(deps);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
console.warn(`[worker] started: ${workers.map((w) => w.name).join(', ')}`);
