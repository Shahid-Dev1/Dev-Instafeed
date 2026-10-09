import { createHash } from 'node:crypto';
import type { VideoStatus } from '@instafeed/shared';
import type { Deps } from '../../../deps.js';
import { hmacSha256, safeEqual } from '../../../lib/crypto.js';
import { AppError } from '../../../lib/errors.js';
import { providerJson } from './http.js';

const API = 'https://video.bunnycdn.com';
export const TUS_ENDPOINT = `${API}/tusupload`;

interface BunnyConfig {
  libraryId: string;
  apiKey: string;
  cdnHost: string;
}

export function bunnyConfigured(deps: Deps): boolean {
  return Boolean(deps.env.BUNNY_STREAM_LIBRARY_ID && deps.env.BUNNY_STREAM_API_KEY && deps.env.BUNNY_STREAM_CDN_HOSTNAME);
}

function config(deps: Deps): BunnyConfig {
  if (!bunnyConfigured(deps)) throw new AppError('SERVICE_UNAVAILABLE', 'Video hosting (Bunny Stream) is not configured');
  return { libraryId: deps.env.BUNNY_STREAM_LIBRARY_ID!, apiKey: deps.env.BUNNY_STREAM_API_KEY!, cdnHost: deps.env.BUNNY_STREAM_CDN_HOSTNAME! };
}

export interface BunnyVideo {
  guid: string;
  title: string;
  length: number;
  status: number;
  width: number;
  height: number;
  storageSize: number;
  thumbnailFileName?: string | null;
}

/** Bunny encoding status codes → library status. Unknown/informational codes return null (no change). */
export function mapBunnyStatus(code: number): VideoStatus | null {
  if ([0, 1, 2, 6, 7].includes(code)) return 'PROCESSING';
  if (code === 3 || code === 4) return 'READY';
  if (code === 5 || code === 8) return 'FAILED';
  return null;
}

async function call<T>(deps: Deps, path: string, init?: RequestInit): Promise<T> {
  const c = config(deps);
  const res = await providerJson<T>(deps.fetch, 'Bunny Stream', `${API}/library/${c.libraryId}${path}`, {
    ...init,
    headers: { AccessKey: c.apiKey, ...(init?.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (res.status === 401 || res.status === 403) throw new AppError('PROVIDER_ERROR', 'Bunny Stream rejected the API key');
  if (res.status === 404) throw new AppError('NOT_FOUND', 'Video not found in Bunny Stream');
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `Bunny Stream returned ${res.status}`);
  return res.body as T;
}

export const bunny = {
  async createVideo(deps: Deps, title: string): Promise<string> {
    const v = await call<{ guid: string }>(deps, '/videos', { method: 'POST', body: JSON.stringify({ title }) });
    if (!v?.guid) throw new AppError('PROVIDER_ERROR', 'Bunny Stream did not return a video id');
    return v.guid;
  },

  getVideo: (deps: Deps, guid: string) => call<BunnyVideo>(deps, `/videos/${encodeURIComponent(guid)}`),

  async deleteVideo(deps: Deps, guid: string): Promise<void> {
    try {
      await call(deps, `/videos/${encodeURIComponent(guid)}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'NOT_FOUND')) throw err;
    }
  },

  /** Streams a file the merchant is authorized to use into an existing Bunny video (PUT upload). */
  async uploadFromStream(deps: Deps, guid: string, body: ReadableStream<Uint8Array>, bytes?: number): Promise<void> {
    await call(deps, `/videos/${encodeURIComponent(guid)}`, {
      method: 'PUT',
      body,
      headers: { 'content-type': 'application/octet-stream', ...(bytes ? { 'content-length': String(bytes) } : {}) },
      // Required by undici for streaming request bodies.
      duplex: 'half',
    } as RequestInit);
  },

  /** Pre-signed TUS headers so the browser uploads straight to Bunny without seeing the API key. */
  tusHeaders(deps: Deps, guid: string, ttlSec = 6 * 3600): Record<string, string> {
    const c = config(deps);
    const expire = Math.floor(Date.now() / 1000) + ttlSec;
    const signature = createHash('sha256').update(`${c.libraryId}${c.apiKey}${expire}${guid}`).digest('hex');
    return { AuthorizationSignature: signature, AuthorizationExpire: String(expire), VideoId: guid, LibraryId: c.libraryId };
  },

  urls(deps: Deps, v: Pick<BunnyVideo, 'guid' | 'thumbnailFileName'>) {
    const c = config(deps);
    return {
      playbackUrl: `https://${c.cdnHost}/${v.guid}/playlist.m3u8`,
      thumbnailUrl: `https://${c.cdnHost}/${v.guid}/${v.thumbnailFileName || 'thumbnail.jpg'}`,
    };
  },

  /** Verifies X-BunnyStream-Signature when a webhook key is configured. Without a key, payloads are only hints. */
  verifyWebhook(deps: Deps, raw: Buffer, signature: string | undefined): boolean {
    const key = deps.env.BUNNY_STREAM_WEBHOOK_KEY;
    if (!key) return true;
    if (!signature) return false;
    return safeEqual(hmacSha256(key, raw).toString('hex'), signature.toLowerCase());
  },
};
