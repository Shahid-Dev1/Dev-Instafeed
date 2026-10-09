import type { Readiness } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';

export interface HealthChecks {
  database: () => Promise<void>;
  redis: () => Promise<void>;
}

async function probe(check: () => Promise<void>): Promise<'ok' | 'error'> {
  try {
    await check();
    return 'ok';
  } catch {
    return 'error';
  }
}

export function healthRoutes(checks: HealthChecks) {
  return async (app: FastifyInstance) => {
    app.get('/health', async () => ({ status: 'ok' }));

    app.get('/health/ready', async (_req, reply) => {
      const [database, redis] = await Promise.all([probe(checks.database), probe(checks.redis)]);
      const body: Readiness = {
        status: database === 'ok' && redis === 'ok' ? 'ok' : 'error',
        checks: { database, redis },
      };
      return reply.code(body.status === 'ok' ? 200 : 503).send(body);
    });
  };
}
