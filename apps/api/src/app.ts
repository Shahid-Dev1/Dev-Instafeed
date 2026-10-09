import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { ApiError } from '@instafeed/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Deps } from './deps.js';
import { AppError } from './lib/errors.js';
import { TenantScopeError } from './lib/tenant-guard.js';
import { authRoutes } from './modules/auth/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { connectionRoutes } from './modules/connections/routes.js';
import { productRoutes } from './modules/products/routes.js';
import { bunnyWebhookRoutes, videoRoutes } from './modules/videos/routes.js';
import { storefrontRoutes } from './modules/storefront/routes.js';
import { widgetRoutes } from './modules/widgets/routes.js';
import { teamRoutes } from './modules/team/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    // Shopify embeds the app in the admin, so framing must be allowed for Shopify origins only.
    contentSecurityPolicy: { directives: { frameAncestors: ["'self'", 'https://admin.shopify.com', 'https://*.myshopify.com'] } },
    frameguard: false,
  });
  await app.register(cors, { origin: [env.WEB_URL], credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false, redis: deps.redis, nameSpace: 'rl:' });
  app.decorateRequest('ctx', null);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    let body: ApiError;
    let status: number;
    if (err instanceof AppError) {
      status = err.statusCode;
      body = { error: { code: err.code, message: err.message, details: err.details } };
    } else if (err instanceof TenantScopeError) {
      // A programming error: never let an unscoped tenant query run.
      req.log.error({ err }, 'tenant scope violation');
      status = 500;
      body = { error: { code: 'INTERNAL', message: 'Internal server error' } };
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

  await app.register(healthRoutes(deps.checks));
  await app.register(authRoutes(deps));
  await app.register(teamRoutes(deps));
  await app.register(productRoutes(deps));
  await app.register(videoRoutes(deps));
  await app.register(connectionRoutes(deps));
  await app.register(widgetRoutes(deps));
  await app.register(storefrontRoutes(deps));
  await app.register(bunnyWebhookRoutes(deps));
  await app.register(webhookRoutes(deps));
  return app;
}
