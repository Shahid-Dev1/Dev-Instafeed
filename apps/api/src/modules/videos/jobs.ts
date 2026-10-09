import type { Job } from 'bullmq';
import type { Deps } from '../../deps.js';
import { AppError } from '../../lib/errors.js';
import { refreshInstagramTokens, withProviderToken } from '../connections/accounts.js';
import { bunny, bunnyConfigured } from './providers/bunny.js';
import { instagram } from './providers/instagram.js';
import { tiktok, tiktokConfigured, tiktokOembed } from './providers/tiktok.js';
import { lookupYouTube } from './providers/youtube.js';
import { enqueueBunnyStatus, syncBunnyStatus } from './service.js';

/** Copies the account owner's own Reel (obtained through the Instagram API) into Bunny for reliable playback. */
export async function copyInstagramReel(deps: Deps, storeId: string, videoId: string): Promise<string> {
  const video = await deps.db.video.findFirst({ where: { storeId, id: videoId } });
  if (!video || video.status === 'READY') return 'skipped';
  const media = await withProviderToken(deps, storeId, 'instagram', (token) => instagram.getMedia(deps, token, video.externalId));
  if (!media?.mediaUrl) {
    await deps.db.video.update({
      where: { id: video.id, storeId },
      data: { status: 'UNAVAILABLE', statusMessage: media?.reason ?? 'This Reel is no longer available on Instagram' },
    });
    return 'unavailable';
  }
  const guid = video.bunnyVideoId ?? (await bunny.createVideo(deps, video.title));
  await deps.db.video.update({ where: { id: video.id, storeId }, data: { bunnyVideoId: guid, status: 'PROCESSING', statusMessage: null } });

  let res: Response;
  try {
    res = await deps.fetch(media.mediaUrl);
  } catch {
    throw new AppError('PROVIDER_ERROR', 'Could not download the Reel from Instagram');
  }
  if (!res.ok || !res.body) throw new AppError('PROVIDER_ERROR', `Instagram media returned ${res.status}`);
  const length = Number(res.headers.get('content-length')) || undefined;
  await bunny.uploadFromStream(deps, guid, res.body, length);
  await enqueueBunnyStatus(deps, storeId, video.id);
  return 'uploaded';
}

const RECHECK_AFTER_MS = 24 * 3600_000;
const RECHECK_BATCH = 500;

/** Daily availability check for embedded videos: deleted/private/blocked → UNAVAILABLE; refreshes expiring thumbnails. */
export async function recheckEmbeddedVideos(deps: Deps): Promise<number> {
  const stale = new Date(Date.now() - RECHECK_AFTER_MS);
  const videos = await deps.rawDb.video.findMany({
    where: {
      source: { in: ['YOUTUBE', 'TIKTOK_URL', 'TIKTOK_ACCOUNT'] },
      status: { in: ['READY', 'UNAVAILABLE'] },
      OR: [{ checkedAt: null }, { checkedAt: { lt: stale } }],
      store: { uninstalledAt: null },
    },
    orderBy: { checkedAt: { sort: 'asc', nulls: 'first' } },
    take: RECHECK_BATCH,
  });
  let changed = 0;
  const apply = async (v: (typeof videos)[number], ok: boolean, thumbnailUrl?: string | null, reason?: string) => {
    const status = ok ? 'READY' : 'UNAVAILABLE';
    if (status !== v.status) changed++;
    await deps.db.video.update({
      where: { id: v.id, storeId: v.storeId },
      data: { status, statusMessage: ok ? null : (reason ?? 'No longer available from the provider'), checkedAt: new Date(), ...(thumbnailUrl ? { thumbnailUrl } : {}) },
    });
  };

  const youtube = videos.filter((v) => v.source === 'YOUTUBE');
  if (deps.env.YOUTUBE_API_KEY) {
    for (let i = 0; i < youtube.length; i += 50) {
      const batch = youtube.slice(i, i + 50);
      const results = await lookupYouTube(deps, batch.map((v) => ({ id: v.externalId, shorts: v.permalink?.includes('/shorts/') ?? false })));
      for (const v of batch) {
        const r = results.get(v.externalId)!;
        await apply(v, r.ok, r.ok ? r.meta.thumbnailUrl : null, r.ok ? undefined : r.reason);
      }
    }
  }
  for (const v of videos.filter((x) => x.source === 'TIKTOK_URL' && x.permalink)) {
    const meta = await tiktokOembed(deps, v.permalink!, v.externalId);
    await apply(v, meta !== null, meta?.thumbnailUrl);
  }
  if (tiktokConfigured(deps)) {
    const byStore = Map.groupBy(videos.filter((v) => v.source === 'TIKTOK_ACCOUNT'), (v) => v.storeId);
    for (const [storeId, list] of byStore) {
      for (let i = 0; i < list.length; i += 20) {
        const batch = list.slice(i, i + 20);
        let found;
        try {
          found = await withProviderToken(deps, storeId, 'tiktok', (t) => tiktok.queryVideos(deps, t, batch.map((v) => v.externalId)));
        } catch (err) {
          if (err instanceof AppError && (err.code === 'UNAUTHENTICATED' || err.code === 'NOT_FOUND')) break; // account disconnected or needs reauth
          throw err;
        }
        const byId = new Map(found.map((f) => [f.id, f]));
        for (const v of batch) await apply(v, byId.has(v.externalId), byId.get(v.externalId)?.thumbnailUrl);
      }
    }
  }
  return changed;
}

export async function processVideoJob(deps: Deps, job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  const d = job.data as { storeId: string; videoId: string; guid: string };
  switch (job.name) {
    case 'bunny-status':
      return syncBunnyStatus(deps, d.storeId, d.videoId);
    case 'bunny-delete':
      if (!bunnyConfigured(deps)) return 'skipped';
      await bunny.deleteVideo(deps, d.guid);
      return 'deleted';
    case 'instagram-copy':
      return copyInstagramReel(deps, d.storeId, d.videoId);
    case 'recheck-embeds':
      return recheckEmbeddedVideos(deps);
    case 'refresh-provider-tokens':
      return refreshInstagramTokens(deps);
    default:
      throw new Error(`Unknown video job ${job.name}`);
  }
}
