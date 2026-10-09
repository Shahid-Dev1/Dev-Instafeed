import { Redis } from 'ioredis';

export function createRedis(redisUrl: string): Redis {
  // maxRetriesPerRequest: null is required by BullMQ for blocking connections.
  return new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
}
