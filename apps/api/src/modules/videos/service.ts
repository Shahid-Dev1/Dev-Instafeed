import type { VideoDto } from '@instafeed/shared';
import type { Deps } from '../../deps.js';
import { Prisma, type Video, type VideoSource } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { isEnabled } from '../../lib/feature-flags.js';
import type { StoreContext } from '../auth/context.js';
import { bunny, mapBunnyStatus } from './providers/bunny.js';
import { instagramOembed } from './providers/instagram.js';
import { tiktokOembed } from './providers/tiktok.js';
import type { AccountVideo } from './providers/types.js';
import { lookupYouTube, type ExternalVideoMeta } from './providers/youtube.js';
import { parseVideoUrl, UnsupportedUrlError } from './url-parsers.js';

export const VIDEO_INCLUDE = {
  products: {
    orderBy: { position: 'asc' as const },
    include: {
      product: { select: { title: true, imageUrl: true, deletedAt: true } },
      variant: { select: { title: true } },
    },
  },
} satisfies Prisma.VideoInclude;

type VideoWithProducts = Prisma.VideoGetPayload<{ include: typeof VIDEO_INCLUDE }>;

export function toVideoDto(v: VideoWithProducts): VideoDto {
  return {
    id: v.id,
    source: v.source,
    status: v.status,
    statusMessage: v.statusMessage,
    title: v.title,
    durationSec: v.durationSec,
    width: v.width,
    height: v.height,
    thumbnailUrl: v.thumbnailUrl,
    playbackUrl: v.playbackUrl,
    embedUrl: v.embedUrl,
    permalink: v.permalink,
    authorName: v.authorName,
    tags: v.tags,
    archived: v.archivedAt !== null,
    createdAt: v.createdAt.toISOString(),
    products: v.products.map((p) => ({
      productId: p.productId,
      variantId: p.variantId,
      title: p.product.title,
      variantTitle: p.variant?.title ?? null,
      imageUrl: p.product.imageUrl,
      deleted: p.product.deletedAt !== null,
    })),
  };
}

export async function loadVideo(deps: Deps, storeId: string, id: string): Promise<VideoWithProducts> {
  const video = await deps.db.video.findFirst({ where: { storeId, id }, include: VIDEO_INCLUDE });
  if (!video) throw new AppError('NOT_FOUND', 'Video not found');
  return video;
}

/** Inserts a video; the (store, source, externalId) unique key turns duplicates into a CONFLICT naming the existing video. */
async function createVideo(deps: Deps, ctx: StoreContext, source: VideoSource, data: Omit<Prisma.VideoUncheckedCreateInput, 'storeId' | 'source'>) {
  try {
    return await deps.db.video.create({ data: { ...data, storeId: ctx.storeId, source, createdById: ctx.userId }, include: VIDEO_INCLUDE });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await deps.db.video.findFirst({ where: { storeId: ctx.storeId, source, externalId: data.externalId }, select: { id: true } });
      throw new AppError('CONFLICT', 'This video is already in your library', { videoId: existing?.id });
    }
    throw err;
  }
}

const fromMeta = (m: ExternalVideoMeta) => ({
  externalId: m.externalId,
  status: 'READY' as const,
  title: m.title,
  durationSec: m.durationSec,
  width: m.width,
  height: m.height,
  thumbnailUrl: m.thumbnailUrl,
  embedUrl: m.embedUrl,
  permalink: m.permalink,
  authorName: m.authorName,
  checkedAt: new Date(),
});

/** Imports a public YouTube/Shorts, TikTok or Instagram Reel URL using official APIs and embeds only. */
export async function importFromUrl(deps: Deps, ctx: StoreContext, rawUrl: string) {
  let parsed;
  try {
    parsed = parseVideoUrl(rawUrl);
  } catch (err) {
    if (err instanceof UnsupportedUrlError) throw new AppError('VALIDATION_ERROR', err.message, [{ path: 'url', message: err.message }]);
    throw err;
  }

  if (parsed.provider === 'youtube') {
    const result = (await lookupYouTube(deps, [parsed])).get(parsed.id)!;
    if (!result.ok) throw new AppError('VALIDATION_ERROR', result.reason, [{ path: 'url', message: result.reason }]);
    return createVideo(deps, ctx, 'YOUTUBE', fromMeta(result.meta));
  }
  if (parsed.provider === 'tiktok') {
    const meta = await tiktokOembed(deps, parsed.canonicalUrl, parsed.id);
    if (!meta) throw new AppError('VALIDATION_ERROR', 'This TikTok video is private, removed or cannot be embedded', [{ path: 'url', message: 'Unavailable' }]);
    return createVideo(deps, ctx, 'TIKTOK_URL', fromMeta(meta));
  }
  if (!(await isEnabled(deps.rawDb, 'instagram_oembed', ctx.storeId))) {
    throw new AppError('FORBIDDEN', 'Instagram link embedding is not enabled. Connect your Instagram account to import your own Reels.');
  }
  const meta = await instagramOembed(deps, parsed.canonicalUrl, parsed.shortcode);
  if (!meta) throw new AppError('VALIDATION_ERROR', 'This Instagram Reel is private, removed or cannot be embedded', [{ path: 'url', message: 'Unavailable' }]);
  return createVideo(deps, ctx, 'INSTAGRAM_URL', fromMeta(meta));
}

/** Creates the Bunny video and returns pre-signed TUS headers; the browser uploads directly to Bunny. */
export async function createUpload(deps: Deps, ctx: StoreContext, input: { title: string; bytes: number }) {
  if (input.bytes > deps.env.UPLOAD_MAX_MB * 1024 * 1024) {
    throw new AppError('VALIDATION_ERROR', `Files up to ${deps.env.UPLOAD_MAX_MB} MB are supported`, [{ path: 'bytes', message: 'Too large' }]);
  }
  const guid = await bunny.createVideo(deps, input.title);
  const video = await createVideo(deps, ctx, 'UPLOAD', {
    externalId: guid,
    bunnyVideoId: guid,
    status: 'PENDING',
    title: input.title,
    bytes: BigInt(input.bytes),
  });
  await enqueueBunnyStatus(deps, ctx.storeId, video.id, 60_000);
  return { video, tus: { endpoint: 'https://video.bunnycdn.com/tusupload', headers: bunny.tusHeaders(deps, guid) } };
}

const STATUS_POLL_MS = 30_000;
const STATUS_POLL_MAX_AGE_MS = 6 * 3600_000;

export async function enqueueBunnyStatus(deps: Deps, storeId: string, videoId: string, delay = 0) {
  await deps.queues.videos.add('bunny-status', { storeId, videoId }, { delay, jobId: `bunny-status-${videoId}-${Date.now()}`, removeOnComplete: true, removeOnFail: 200 });
}

/**
 * Reads the authoritative encoding state from Bunny (webhooks are only hints) and updates the video.
 * Keeps polling while processing; gives up after 6 hours.
 */
export async function syncBunnyStatus(deps: Deps, storeId: string, videoId: string): Promise<Video['status'] | 'gone'> {
  const video = await deps.db.video.findFirst({ where: { storeId, id: videoId } });
  if (!video?.bunnyVideoId) return 'gone';
  let remote;
  try {
    remote = await bunny.getVideo(deps, video.bunnyVideoId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_FOUND') {
      await deps.db.video.update({ where: { id: video.id, storeId }, data: { status: 'FAILED', statusMessage: 'The video file was not found at the host' } });
      return 'FAILED';
    }
    throw err;
  }
  const mapped = mapBunnyStatus(remote.status);
  // Bunny reports 0 (queued) both before the upload starts and after; keep PENDING until bytes arrive.
  const status = mapped === 'PROCESSING' && remote.status === 0 && video.status === 'PENDING' && !remote.storageSize ? 'PENDING' : (mapped ?? video.status);
  const ready = status === 'READY';
  await deps.db.video.update({
    where: { id: video.id, storeId },
    data: {
      status,
      statusMessage: status === 'FAILED' ? 'Video processing failed. Try uploading a different file.' : null,
      ...(ready ? { ...bunny.urls(deps, remote), durationSec: remote.length || null, width: remote.width || null, height: remote.height || null, bytes: BigInt(remote.storageSize || 0), checkedAt: new Date() } : {}),
    },
  });
  if ((status === 'PENDING' || status === 'PROCESSING') && Date.now() - video.createdAt.getTime() < STATUS_POLL_MAX_AGE_MS) {
    await enqueueBunnyStatus(deps, storeId, video.id, STATUS_POLL_MS);
  } else if (status === 'PENDING' || status === 'PROCESSING') {
    await deps.db.video.update({ where: { id: video.id, storeId }, data: { status: 'FAILED', statusMessage: 'Upload was not completed' } });
    return 'FAILED';
  }
  return status;
}

/** Records selected creator-account videos. TikTok uses the official embed; Instagram Reels are copied to Bunny. */
export async function importAccountVideos(deps: Deps, ctx: StoreContext, provider: 'tiktok' | 'instagram', videos: AccountVideo[]) {
  const imported: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const v of videos) {
    if (!v.importable) {
      skipped.push({ id: v.id, reason: v.reason ?? 'Not importable' });
      continue;
    }
    try {
      if (provider === 'tiktok') {
        const created = await createVideo(deps, ctx, 'TIKTOK_ACCOUNT', {
          externalId: v.id,
          status: 'READY',
          title: v.title,
          durationSec: v.durationSec,
          width: v.width,
          height: v.height,
          thumbnailUrl: v.thumbnailUrl,
          embedUrl: v.embedUrl,
          permalink: v.permalink,
          checkedAt: new Date(),
        });
        imported.push(created.id);
      } else {
        const created = await createVideo(deps, ctx, 'INSTAGRAM_ACCOUNT', {
          externalId: v.id,
          status: 'PENDING',
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
          permalink: v.permalink,
        });
        await deps.queues.videos.add('instagram-copy', { storeId: ctx.storeId, videoId: created.id }, { jobId: `instagram-copy-${created.id}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true, removeOnFail: 200 });
        imported.push(created.id);
      }
    } catch (err) {
      if (err instanceof AppError && err.code === 'CONFLICT') skipped.push({ id: v.id, reason: 'Already in your library' });
      else throw err;
    }
  }
  return { imported, skipped };
}

/** Product tags: every product/variant must belong to this store and not be deleted. Replaces the full ordered list. */
export async function setVideoProducts(deps: Deps, storeId: string, videoId: string, items: { productId: string; variantId?: string | null }[]) {
  await loadVideo(deps, storeId, videoId);
  const products = await deps.db.product.findMany({ where: { storeId, id: { in: items.map((i) => i.productId) }, deletedAt: null }, select: { id: true } });
  const variantIds = items.map((i) => i.variantId).filter((v): v is string => !!v);
  const variants = await deps.db.variant.findMany({ where: { storeId, id: { in: variantIds } }, select: { id: true, productId: true } });
  const productSet = new Set(products.map((p) => p.id));
  const variantProduct = new Map(variants.map((v) => [v.id, v.productId]));
  const errors = items.flatMap((i, idx) => [
    ...(!productSet.has(i.productId) ? [{ path: `${idx}.productId`, message: 'Product not found' }] : []),
    ...(i.variantId && variantProduct.get(i.variantId) !== i.productId ? [{ path: `${idx}.variantId`, message: 'Variant does not belong to the product' }] : []),
  ]);
  if (errors.length) throw new AppError('VALIDATION_ERROR', 'Invalid product tags', errors);

  await deps.db.$transaction(async (tx) => {
    await tx.videoProduct.deleteMany({ where: { storeId, videoId } });
    if (items.length) {
      await tx.videoProduct.createMany({
        data: items.map((i, position) => ({ storeId, videoId, productId: i.productId, variantId: i.variantId ?? null, position })),
      });
    }
  });
  return loadVideo(deps, storeId, videoId);
}

/** Deletes videos and their tags; hosted media is removed from Bunny asynchronously. */
export async function deleteVideos(deps: Deps, storeId: string, ids: string[]): Promise<number> {
  const videos = await deps.db.video.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, bunnyVideoId: true } });
  await deps.db.video.deleteMany({ where: { storeId, id: { in: videos.map((v) => v.id) } } });
  for (const v of videos) {
    if (v.bunnyVideoId) await deps.queues.videos.add('bunny-delete', { guid: v.bunnyVideoId }, { jobId: `bunny-delete-${v.bunnyVideoId}`, attempts: 5, removeOnComplete: true, removeOnFail: 500 });
  }
  return videos.length;
}
