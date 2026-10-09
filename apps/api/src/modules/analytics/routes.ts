import { eventBatchSchema, REPORTS, reportQuerySchema } from '@instafeed/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { normalizeShopDomain } from '../shopify/shop-domain.js';
import { verifyProxySignature } from '../storefront/proxy-signature.js';
import { enqueueEvents } from './jobs.js';
import { breakdown, summary, timeseries, toCsv } from './reports.js';

function parseBody(req: FastifyRequest): unknown {
  const b = req.body;
  if (typeof b !== 'string') return b;
  try {
    return JSON.parse(b);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid JSON');
  }
}

async function activeStore(deps: Deps, shopParam: unknown) {
  const shop = normalizeShopDomain(typeof shopParam === 'string' ? shopParam : null);
  const store = shop ? await deps.rawDb.store.findUnique({ where: { shopDomain: shop }, select: { id: true, uninstalledAt: true } }) : null;
  return store && !store.uninstalledAt ? store.id : null;
}

/** Public ingestion endpoints. Both only enqueue; validation and dedup happen in the worker. */
export function eventIngestRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    // sendBeacon posts text/plain; JSON is parsed manually so both work.
    app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));

    app.post('/proxy/events', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } }, bodyLimit: 64 * 1024 }, async (req, reply) => {
      if (!verifyProxySignature(req.url.split('?')[1] ?? '', deps.env.SHOPIFY_API_SECRET)) throw new AppError('UNAUTHENTICATED', 'Invalid proxy signature');
      const storeId = await activeStore(deps, (req.query as Record<string, unknown>).shop);
      const { events } = validate(eventBatchSchema, parseBody(req));
      if (storeId) await enqueueEvents(deps, storeId, events);
      return reply.code(202).send({ accepted: storeId ? events.length : 0 });
    });

    /**
     * Web Pixel (checkout_started). Pixels cannot sign requests, so this endpoint only accepts checkout events for
     * visitors who already have storefront events in that store, is rate-limited, and is deduplicated by eventId.
     */
    const pixelBody = z.object({ shop: z.string().max(255), events: z.array(z.unknown()).min(1).max(5) });
    app.post('/pixel/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, bodyLimit: 16 * 1024 }, async (req, reply) => {
      const body = validate(pixelBody, parseBody(req));
      const storeId = await activeStore(deps, body.shop);
      const events = body.events.filter((e): e is { type: string; visitorId: string } =>
        typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'checkout_start' && typeof (e as { visitorId?: unknown }).visitorId === 'string');
      if (storeId && events.length) {
        const known = await deps.db.analyticsEvent.findFirst({ where: { storeId, visitorId: { in: events.map((e) => e.visitorId) } }, select: { id: true } });
        if (known) await enqueueEvents(deps, storeId, events);
      }
      return reply.code(202).send({ ok: true });
    });
  };
}

const settingsSchema = z.object({ attributionWindowDays: z.number().int().min(1).max(30) }).strict();

export function analyticsRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const read = { preHandler: [authenticate(deps), requireRole('ANALYST')] };
    const admin = { preHandler: [authenticate(deps), requireRole('ADMIN')] };

    app.get('/api/v1/analytics/summary', read, async (req) => summary(deps, storeCtx(req).storeId, validate(reportQuerySchema, req.query)));
    app.get('/api/v1/analytics/timeseries', read, async (req) => timeseries(deps, storeCtx(req).storeId, validate(reportQuerySchema, req.query)));
    for (const dim of ['videos', 'products', 'widgets'] as const) {
      app.get(`/api/v1/analytics/${dim}`, read, async (req) => ({ rows: await breakdown(deps, storeCtx(req).storeId, validate(reportQuerySchema, req.query), dim) }));
    }

    app.get('/api/v1/analytics/export.csv', read, async (req, reply) => {
      const { storeId } = storeCtx(req);
      const q = validate(reportQuerySchema.and(z.object({ report: z.enum(REPORTS) })), req.query);
      const rows: Record<string, unknown>[] = q.report === 'daily' ? (await timeseries(deps, storeId, q)).days : await breakdown(deps, storeId, q, q.report, 1000);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="instafeed-${q.report}-${q.from}-to-${q.to}.csv"`)
        .send(toCsv(rows));
    });

    app.get('/api/v1/settings/attribution', read, async (req) => {
      const s = await deps.db.storeSettings.findUnique({ where: { storeId: storeCtx(req).storeId } });
      return { attributionWindowDays: s?.attributionWindowDays ?? 7 };
    });
    app.patch('/api/v1/settings/attribution', admin, async (req) => {
      const ctx = storeCtx(req);
      const input = validate(settingsSchema, req.body);
      await deps.db.storeSettings.upsert({ where: { storeId: ctx.storeId }, create: { storeId: ctx.storeId, ...input }, update: input });
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'settings.attribution_window', meta: input, ip: req.ip });
      return input;
    });
  };
}
