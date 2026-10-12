import type { Job } from 'bullmq';
import type { Deps } from '../../deps.js';
import { checkUsage, syncSubscription } from './entitlements.js';
import { partnerConfigured } from './partner.js';

const activeStores = (deps: Deps) => deps.rawDb.store.findMany({ where: { uninstalledAt: null }, select: { id: true } });

export async function processBillingJob(deps: Deps, job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  switch (job.name) {
    // Daily: catches cancellations, freezes and failed renewals, which have no redirect or webhook.
    case 'sync-all': {
      if (!partnerConfigured(deps)) return 'not-configured';
      let n = 0;
      for (const s of await activeStores(deps)) {
        try {
          await syncSubscription(deps, s.id);
          n++;
        } catch {
          /* keep last known state; next run retries */
        }
      }
      return n;
    }
    case 'usage-all': {
      let over = 0;
      for (const s of await activeStores(deps)) if (await checkUsage(deps, s.id)) over++;
      return over;
    }
    default:
      throw new Error(`Unknown billing job ${job.name}`);
  }
}
