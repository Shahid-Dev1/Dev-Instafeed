import type { Deps } from '../../../deps.js';
import { AppError } from '../../../lib/errors.js';
import { parseIsoDuration } from '../url-parsers.js';
import { providerJson } from './http.js';

export interface ExternalVideoMeta {
  externalId: string;
  title: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  embedUrl: string;
  permalink: string;
  authorName: string | null;
}

interface YtThumb {
  url: string;
  width?: number;
  height?: number;
}
interface YtItem {
  id: string;
  snippet: { title: string; channelTitle?: string; thumbnails?: Record<string, YtThumb> };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string; uploadStatus?: string };
}

export type YouTubeLookup = { ok: true; meta: ExternalVideoMeta } | { ok: false; reason: string };

function toMeta(item: YtItem, shorts: boolean): ExternalVideoMeta {
  const t = item.snippet.thumbnails ?? {};
  const thumb = t.maxres ?? t.standard ?? t.high ?? t.medium ?? t.default;
  return {
    externalId: item.id,
    title: item.snippet.title.slice(0, 200),
    durationSec: parseIsoDuration(item.contentDetails?.duration),
    // The Data API does not expose a video's aspect ratio; Shorts URLs are vertical.
    width: shorts ? 1080 : 1920,
    height: shorts ? 1920 : 1080,
    thumbnailUrl: thumb?.url ?? null,
    embedUrl: `https://www.youtube-nocookie.com/embed/${item.id}`,
    permalink: shorts ? `https://www.youtube.com/shorts/${item.id}` : `https://www.youtube.com/watch?v=${item.id}`,
    authorName: item.snippet.channelTitle ?? null,
  };
}

function availability(item: YtItem | undefined): string | null {
  if (!item) return 'This YouTube video is private, deleted or does not exist';
  if (item.status?.privacyStatus === 'private') return 'This YouTube video is private';
  if (item.status?.embeddable === false) return 'The owner of this YouTube video has disabled embedding';
  if (item.status?.uploadStatus && !['processed', 'uploaded'].includes(item.status.uploadStatus)) return 'This YouTube video is not available';
  return null;
}

/** YouTube Data API v3 videos.list for up to 50 ids. Returns availability per id. */
export async function lookupYouTube(deps: Deps, ids: { id: string; shorts: boolean }[]): Promise<Map<string, YouTubeLookup>> {
  const key = deps.env.YOUTUBE_API_KEY;
  if (!key) throw new AppError('SERVICE_UNAVAILABLE', 'YouTube import is not configured');
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'snippet,contentDetails,status');
  url.searchParams.set('id', ids.map((i) => i.id).join(','));
  url.searchParams.set('key', key);
  const res = await providerJson<{ items?: YtItem[]; error?: { message?: string } }>(deps.fetch, 'YouTube', url.toString());
  if (res.status === 400 || res.status === 403) throw new AppError('PROVIDER_ERROR', 'YouTube rejected the request (check the API key and quota)');
  if (!res.ok || !res.body) throw new AppError('PROVIDER_ERROR', `YouTube returned ${res.status}`);
  const items = new Map((res.body.items ?? []).map((i) => [i.id, i]));
  return new Map(
    ids.map(({ id, shorts }) => {
      const item = items.get(id);
      const reason = availability(item);
      return [id, reason ? { ok: false, reason } : { ok: true, meta: toMeta(item!, shorts) }];
    }),
  );
}
