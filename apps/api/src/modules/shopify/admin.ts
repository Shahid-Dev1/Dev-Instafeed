import type { Deps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { adminGraphql } from './client.js';
import { getAccessToken, shopifyCreds } from './install.js';

const MAX_THROTTLE_RETRIES = 8;

export interface ShopifyAdmin {
  shop: string;
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Store-scoped Admin GraphQL client: refreshes expiring tokens and waits out cost throttling. */
export async function shopifyAdmin(deps: Deps, storeId: string): Promise<ShopifyAdmin> {
  const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { shopDomain: true } });
  return {
    shop: store.shopDomain,
    async query<T>(query: string, variables?: Record<string, unknown>) {
      for (let attempt = 0; ; attempt++) {
        const token = await getAccessToken(deps, storeId);
        try {
          return await adminGraphql<T>(deps.fetch, shopifyCreds(deps), store.shopDomain, token, query, variables);
        } catch (err) {
          if (!(err instanceof AppError) || err.code !== 'RATE_LIMITED' || attempt >= MAX_THROTTLE_RETRIES) throw err;
          const wait = (err.details as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 1000;
          await deps.sleep(wait * (attempt + 1));
        }
      }
    },
  };
}
