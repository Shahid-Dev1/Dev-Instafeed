import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Models owned by a store. Every query on them must be scoped by storeId.
 * Add each new tenant model here; the tenant-guard test fails if a model has a storeId column but is missing.
 */
export const TENANT_MODELS = new Set<string>(['Membership', 'Product', 'Variant', 'SyncRun', 'Video', 'VideoProduct', 'ProviderAccount', 'OAuthState']);

export class TenantScopeError extends Error {}

function hasStoreScope(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.storeId === 'string') return true;
  // Compound unique keys such as storeId_userId.
  return Object.entries(o).some(([k, v]) => k.startsWith('storeId_') && typeof v === 'object' && v !== null && typeof (v as { storeId?: unknown }).storeId === 'string');
}

function isScoped(operation: string, args: Record<string, unknown> | undefined): boolean {
  switch (operation) {
    case 'create':
      return hasStoreScope(args?.data);
    case 'createMany':
    case 'createManyAndReturn': {
      const data = args?.data;
      return Array.isArray(data) ? data.length > 0 && data.every(hasStoreScope) : hasStoreScope(data);
    }
    case 'upsert':
      return hasStoreScope(args?.where) && hasStoreScope(args?.create);
    default:
      return hasStoreScope(args?.where);
  }
}

/** Wraps a Prisma client so tenant-model queries without a concrete storeId throw instead of leaking data. */
export function withTenantGuard(db: PrismaClient) {
  return db.$extends({
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (TENANT_MODELS.has(model) && !isScoped(operation, args as Record<string, unknown>)) {
            throw new TenantScopeError(`${model}.${operation} must be scoped by storeId`);
          }
          return query(args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof withTenantGuard>;
