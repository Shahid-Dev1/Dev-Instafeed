import type { Job } from 'bullmq';
import type { Deps } from '../../deps.js';
import { ingestEvents } from './ingest.js';
import { attributeOrder } from './orders.js';
import { ensureWebPixel } from './pixel.js';

export async function enqueueEvents(deps: Deps, storeId: string, events: unknown[]) {
  await deps.queues.analytics.add('ingest', { storeId, events, receivedAt: Date.now() }, { removeOnComplete: true, removeOnFail: 1000, attempts: 5, backoff: { type: 'exponential', delay: 2000 } });
}

export async function processAnalyticsJob(deps: Deps, job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  const d = job.data as { storeId: string; events: unknown[]; receivedAt: number; orderId: string };
  switch (job.name) {
    case 'ingest':
      return ingestEvents(deps, d.storeId, d.events, new Date(d.receivedAt));
    case 'ensure-pixel':
      return ensureWebPixel(deps, d.storeId);
    case 'attribute-order':
      return (await attributeOrder(deps, d.storeId, d.orderId))?.attribution ?? 'missing';
    default:
      throw new Error(`Unknown analytics job ${job.name}`);
  }
}

export async function enqueueEnsurePixel(deps: Deps, storeId: string) {
  await deps.queues.analytics.add('ensure-pixel', { storeId }, { jobId: `ensure-pixel-${storeId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true, removeOnFail: 100 });
}
