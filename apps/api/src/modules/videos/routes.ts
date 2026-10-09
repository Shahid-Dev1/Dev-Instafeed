import {
  bulkVideoSchema,
  createUploadSchema,
  importUrlSchema,
  updateVideoSchema,
  videoListQuerySchema,
  videoProductsSchema,
  type VideoCapabilities,
} from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError, validate } from '../../lib/errors.js';
import { isEnabled } from '../../lib/feature-flags.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { getAccount, providerConfigured, providerEnabled } from '../connections/accounts.js';
import { bunny, bunnyConfigured } from './providers/bunny.js';
import { createUpload, deleteVideos, enqueueBunnyStatus, importFromUrl, loadVideo, setVideoProducts, toVideoDto, VIDEO_INCLUDE } from './service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });

export function videoRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const read = { preHandler: [authenticate(deps), requireRole('ANALYST')] };
    const write = { preHandler: [authenticate(deps), requireRole('EDITOR')] };

    app.get('/api/v1/videos/capabilities', read, async (req): Promise<VideoCapabilities> => {
      const { storeId } = storeCtx(req);
      const providers = await Promise.all(
        (['tiktok', 'instagram'] as const).map(async (provider) => {
          const account = await getAccount(deps, storeId, provider);
          return {
            provider,
            enabled: await providerEnabled(deps, storeId, provider),
            configured: providerConfigured(deps, provider),
            connected: !!account,
            username: account?.username ?? null,
            status: account?.status ?? null,
          };
        }),
      );
      return {
        upload: bunnyConfigured(deps),
        youtube: !!deps.env.YOUTUBE_API_KEY,
        tiktokUrl: true,
        instagramUrl: !!deps.env.META_OEMBED_TOKEN && (await isEnabled(deps.rawDb, 'instagram_oembed', storeId)),
        maxUploadMb: deps.env.UPLOAD_MAX_MB,
        providers,
      };
    });

    app.get('/api/v1/videos', read, async (req) => {
      const { storeId } = storeCtx(req);
      const f = validate(videoListQuerySchema, req.query);
      const where: Prisma.VideoWhereInput = {
        storeId,
        archivedAt: f.archived ? { not: null } : null,
        ...(f.source ? { source: f.source } : {}),
        ...(f.status ? { status: f.status } : {}),
        ...(f.tag ? { tags: { has: f.tag } } : {}),
        ...(f.q ? { OR: [{ title: { contains: f.q, mode: 'insensitive' } }, { tags: { has: f.q.toLowerCase() } }] } : {}),
      };
      const orderBy: Prisma.VideoOrderByWithRelationInput[] =
        f.sort === 'title' ? [{ title: 'asc' }, { id: 'asc' }] : [{ createdAt: f.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }];
      const rows = await deps.db.video.findMany({
        where,
        orderBy,
        include: VIDEO_INCLUDE,
        take: f.limit + 1,
        ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
      });
      const items = rows.slice(0, f.limit);
      return { items: items.map(toVideoDto), nextCursor: rows.length > f.limit ? items.at(-1)!.id : null };
    });

    app.get('/api/v1/videos/:id', read, async (req) => {
      const { storeId } = storeCtx(req);
      return { video: toVideoDto(await loadVideo(deps, storeId, validate(idParams, req.params).id)) };
    });

    app.post('/api/v1/videos/import', write, async (req, reply) => {
      const ctx = storeCtx(req);
      const { url } = validate(importUrlSchema, req.body);
      return reply.code(201).send({ video: toVideoDto(await importFromUrl(deps, ctx, url)) });
    });

    app.post('/api/v1/videos/uploads', write, async (req, reply) => {
      const ctx = storeCtx(req);
      const input = validate(createUploadSchema, req.body);
      const { video, tus } = await createUpload(deps, ctx, input);
      return reply.code(201).send({ videoId: video.id, tus });
    });

    /** Called by the browser when its TUS upload finishes, to refresh status immediately. */
    app.post('/api/v1/videos/:id/upload-complete', write, async (req) => {
      const { storeId } = storeCtx(req);
      const video = await loadVideo(deps, storeId, validate(idParams, req.params).id);
      if (video.source !== 'UPLOAD') throw new AppError('VALIDATION_ERROR', 'Not an upload');
      await enqueueBunnyStatus(deps, storeId, video.id);
      return { ok: true };
    });

    app.patch('/api/v1/videos/:id', write, async (req) => {
      const { storeId } = storeCtx(req);
      const { id } = validate(idParams, req.params);
      const input = validate(updateVideoSchema, req.body);
      await loadVideo(deps, storeId, id);
      await deps.db.video.update({ where: { id, storeId }, data: input });
      return { video: toVideoDto(await loadVideo(deps, storeId, id)) };
    });

    app.put('/api/v1/videos/:id/products', write, async (req) => {
      const { storeId } = storeCtx(req);
      const { id } = validate(idParams, req.params);
      return { video: toVideoDto(await setVideoProducts(deps, storeId, id, validate(videoProductsSchema, req.body))) };
    });

    app.delete('/api/v1/videos/:id', write, async (req) => {
      const { storeId } = storeCtx(req);
      const { id } = validate(idParams, req.params);
      if (!(await deleteVideos(deps, storeId, [id]))) throw new AppError('NOT_FOUND', 'Video not found');
      return { ok: true };
    });

    app.post('/api/v1/videos/bulk', write, async (req) => {
      const { storeId } = storeCtx(req);
      const input = validate(bulkVideoSchema, req.body);
      const where = { storeId, id: { in: input.ids } };
      let affected = 0;
      switch (input.action) {
        case 'archive':
          affected = (await deps.db.video.updateMany({ where: { ...where, archivedAt: null }, data: { archivedAt: new Date() } })).count;
          break;
        case 'unarchive':
          affected = (await deps.db.video.updateMany({ where, data: { archivedAt: null } })).count;
          break;
        case 'delete':
          affected = await deleteVideos(deps, storeId, input.ids);
          break;
        case 'addTags':
        case 'removeTags': {
          const videos = await deps.db.video.findMany({ where, select: { id: true, tags: true } });
          for (const v of videos) {
            const tags = input.action === 'addTags' ? [...new Set([...v.tags, ...input.tags])].slice(0, 20) : v.tags.filter((t) => !input.tags.includes(t));
            await deps.db.video.update({ where: { id: v.id, storeId }, data: { tags } });
          }
          affected = videos.length;
        }
      }
      return { affected };
    });
  };
}

/** Bunny Stream encoding webhook. The payload is only a hint: status is always re-read from Bunny's API. */
export function bunnyWebhookRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    app.post('/webhooks/bunny', async (req) => {
      const raw = req.body as Buffer;
      const sig = req.headers['x-bunnystream-signature'];
      if (!Buffer.isBuffer(raw) || !bunny.verifyWebhook(deps, raw, typeof sig === 'string' ? sig : undefined)) {
        throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature');
      }
      let payload: { VideoGuid?: unknown; VideoLibraryId?: unknown };
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Invalid JSON');
      }
      if (String(payload.VideoLibraryId) !== deps.env.BUNNY_STREAM_LIBRARY_ID || typeof payload.VideoGuid !== 'string') return { ok: true };
      // Library-wide lookup: the guid is unique to our library, and the tenant comes from the matched row.
      const video = await deps.rawDb.video.findFirst({ where: { bunnyVideoId: payload.VideoGuid }, select: { id: true, storeId: true } });
      if (video) await enqueueBunnyStatus(deps, video.storeId, video.id);
      return { ok: true };
    });
  };
}
