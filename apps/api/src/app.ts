import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ApiError } from '@instafeed/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { healthRoutes, type HealthChecks } from './modules/health/routes.js';

export interface AppDeps {
  env: Env;
  checks: HealthChecks;
}

export async function buildApp({ env, checks }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet);
  await app.register(cors, { origin: [env.WEB_URL], credentials: true });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    let body: ApiError;
    let status: number;
    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, details: err.details } };
    } else if (err.validation) {
      status = 400;
      body = { error: { code: 'VALIDATION_ERROR', message: err.message } };
    } else if (err.statusCode === 429) {
      status = 429;
      body = { error: { code: 'RATE_LIMITED', message: 'Too many requests' } };
    } else {
      req.log.error({ err }, 'unhandled error');
      status = 500;
      body = { error: { code: 'INTERNAL', message: 'Internal server error' } };
    }
    return reply.code(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = { error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } };
    return reply.code(404).send(body);
  });

  await app.register(healthRoutes(checks));
  return app;
}
