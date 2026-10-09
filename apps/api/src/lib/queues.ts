import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

/** Queue names are the contract between the API (producers) and the worker (consumers). */
export const QUEUE_NAMES = ['products'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export function createQueue(name: QueueName, connection: Redis, prefix: string): Queue {
  return new Queue(name, {
    connection,
    prefix,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
}
