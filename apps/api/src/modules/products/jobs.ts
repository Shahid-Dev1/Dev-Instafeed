import type { Job } from 'bullmq';
import type { Deps } from '../../deps.js';
import { refreshProduct, runFullSync } from './sync.js';

export type ProductJob =
  | { name: 'full-sync'; data: { storeId: string; syncRunId: string } }
  | { name: 'refresh'; data: { storeId: string; shopifyId: string } }
  | { name: 'reconcile-all'; data: Record<string, never> };

const STALE_SYNC_MS = 2 * 60 * 60 * 1000;

export type SyncTrigger = 'MANUAL' | 'INSTALL' | 'SCHEDULED';

/** Creates (or returns the active) sync run and enqueues it. One full sync per store at a time. */
export async function enqueueFullSync(deps: Deps, storeId: string, trigger: SyncTrigger) {
  const active = await deps.db.syncRun.findFirst({
    where: { storeId, kind: 'PRODUCTS_FULL', status: { in: ['QUEUED', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (active && Date.now() - active.createdAt.getTime() < STALE_SYNC_MS) return active;
  if (active) {
    // A worker crash can leave a run stuck; expire it so syncing is never blocked permanently.
    await deps.db.syncRun.update({ where: { id: active.id, storeId }, data: { status: 'FAILED', error: 'Expired: no progress', finishedAt: new Date() } });
  }
  const run = await deps.db.syncRun.create({ data: { storeId, kind: 'PRODUCTS_FULL', trigger } });
  await deps.queues.products.add(
    'full-sync',
    { storeId, syncRunId: run.id },
    { jobId: `full-sync-${storeId}-${run.id}`, removeOnComplete: true, removeOnFail: 100, attempts: 3 },
  );
  return run;
}

/** Webhook-triggered single-product refresh; the id includes updated_at so distinct updates are never collapsed. */
export async function enqueueProductRefresh(deps: Deps, storeId: string, shopifyId: string, updatedAt: string) {
  const id = `refresh-${storeId}-${shopifyId.split('/').pop()}-${Date.parse(updatedAt) || Date.now()}`;
  await deps.queues.products.add('refresh', { storeId, shopifyId }, { jobId: id, removeOnComplete: true, removeOnFail: 500 });
}

export async function processProductJob(deps: Deps, job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  const j = job as ProductJob;
  switch (j.name) {
    case 'full-sync':
      return runFullSync(deps, j.data.storeId, j.data.syncRunId);
    case 'refresh': {
      const store = await deps.rawDb.store.findUnique({ where: { id: j.data.storeId }, select: { uninstalledAt: true } });
      if (!store || store.uninstalledAt) return 'skipped';
      return refreshProduct(deps, j.data.storeId, j.data.shopifyId);
    }
    case 'reconcile-all': {
      const stores = await deps.rawDb.store.findMany({ where: { uninstalledAt: null, refreshTokenEnc: { not: null } }, select: { id: true } });
      for (const s of stores) await enqueueFullSync(deps, s.id, 'SCHEDULED');
      return stores.length;
    }
    default:
      throw new Error(`Unknown product job ${(job as Job).name}`);
  }
}
