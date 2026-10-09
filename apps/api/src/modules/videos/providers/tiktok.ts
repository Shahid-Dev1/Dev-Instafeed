import type { Deps } from '../../../deps.js';
import { AppError } from '../../../lib/errors.js';
import { form, providerJson } from './http.js';
import { ReauthRequiredError, type AccountVideo, type AccountVideoPage, type OAuthTokens } from './types.js';
import type { ExternalVideoMeta } from './youtube.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';
/** Least privilege: profile basics and the user's own public video list. */
export const TIKTOK_SCOPES = 'user.info.basic,video.list';
const VIDEO_FIELDS = 'id,title,video_description,duration,cover_image_url,embed_link,share_url,width,height';

export const tiktokConfigured = (deps: Deps) => Boolean(deps.env.TIKTOK_CLIENT_KEY && deps.env.TIKTOK_CLIENT_SECRET);

function creds(deps: Deps) {
  if (!tiktokConfigured(deps)) throw new AppError('SERVICE_UNAVAILABLE', 'TikTok is not configured');
  return { client_key: deps.env.TIKTOK_CLIENT_KEY!, client_secret: deps.env.TIKTOK_CLIENT_SECRET! };
}

interface TokenBody {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_token?: string;
  refresh_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function token(deps: Deps, params: Record<string, string>): Promise<Omit<OAuthTokens, 'username'>> {
  const res = await providerJson<TokenBody>(deps.fetch, 'TikTok', `${API}/oauth/token/`, form({ ...creds(deps), ...params }));
  const b = res.body;
  if (!b?.access_token || !b.open_id) {
    if (params.grant_type === 'refresh_token') throw new ReauthRequiredError(b?.error_description ?? 'TikTok refresh failed');
    throw new AppError('UNAUTHENTICATED', `TikTok authorization failed${b?.error ? `: ${b.error}` : ''}`);
  }
  const now = Date.now();
  return {
    externalUserId: b.open_id,
    accessToken: b.access_token,
    accessTokenExpiresAt: new Date(now + (b.expires_in ?? 86400) * 1000),
    refreshToken: b.refresh_token ?? null,
    refreshTokenExpiresAt: b.refresh_expires_in ? new Date(now + b.refresh_expires_in * 1000) : null,
    scopes: b.scope ?? '',
  };
}

interface TikTokVideo {
  id: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  embed_link?: string;
  share_url?: string;
  width?: number;
  height?: number;
}

function toAccountVideo(v: TikTokVideo): AccountVideo {
  return {
    id: v.id,
    title: (v.title || v.video_description || 'TikTok video').slice(0, 200),
    thumbnailUrl: v.cover_image_url ?? null,
    durationSec: v.duration ?? null,
    width: v.width ?? null,
    height: v.height ?? null,
    embedUrl: v.embed_link ?? `https://www.tiktok.com/player/v1/${v.id}`,
    permalink: v.share_url ?? null,
    mediaUrl: null,
    importable: true,
    reason: null,
  };
}

async function api<T>(deps: Deps, accessToken: string, path: string, body: object): Promise<T> {
  const res = await providerJson<{ data?: T; error?: { code?: string; message?: string } }>(deps.fetch, 'TikTok', `${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const code = res.body?.error?.code;
  if (code === 'access_token_invalid' || code === 'scope_not_authorized' || res.status === 401) {
    throw new ReauthRequiredError(res.body?.error?.message ?? 'TikTok authorization expired');
  }
  if ((code && code !== 'ok') || !res.body?.data) throw new AppError('PROVIDER_ERROR', `TikTok error: ${res.body?.error?.message ?? res.status}`);
  return res.body.data;
}

export const tiktok = {
  authorizeUrl(deps: Deps, state: string, redirectUri: string): string {
    const u = new URL(AUTH_URL);
    u.search = new URLSearchParams({ client_key: creds(deps).client_key, response_type: 'code', scope: TIKTOK_SCOPES, redirect_uri: redirectUri, state }).toString();
    return u.toString();
  },

  async exchangeCode(deps: Deps, code: string, redirectUri: string): Promise<OAuthTokens> {
    const t = await token(deps, { code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    const info = await providerJson<{ data?: { user?: { display_name?: string } } }>(deps.fetch, 'TikTok', `${API}/user/info/?fields=open_id,display_name`, {
      headers: { authorization: `Bearer ${t.accessToken}` },
    });
    return { ...t, username: info.body?.data?.user?.display_name ?? null };
  },

  refresh: (deps: Deps, refreshToken: string) => token(deps, { grant_type: 'refresh_token', refresh_token: refreshToken }),

  async revoke(deps: Deps, accessToken: string): Promise<void> {
    await providerJson(deps.fetch, 'TikTok', `${API}/oauth/revoke/`, form({ ...creds(deps), token: accessToken }));
  },

  async listVideos(deps: Deps, accessToken: string, cursor: string | null): Promise<AccountVideoPage> {
    const data = await api<{ videos?: TikTokVideo[]; cursor?: number; has_more?: boolean }>(deps, accessToken, `/video/list/?fields=${VIDEO_FIELDS}`, {
      max_count: 20,
      ...(cursor ? { cursor: Number(cursor) } : {}),
    });
    return { items: (data.videos ?? []).map(toAccountVideo), nextCursor: data.has_more && data.cursor ? String(data.cursor) : null };
  },

  /** Fresh metadata for specific ids owned by the authorized user (deleted/private ones are omitted by TikTok). */
  async queryVideos(deps: Deps, accessToken: string, ids: string[]): Promise<AccountVideo[]> {
    const data = await api<{ videos?: TikTokVideo[] }>(deps, accessToken, `/video/query/?fields=${VIDEO_FIELDS}`, { filters: { video_ids: ids } });
    return (data.videos ?? []).map(toAccountVideo);
  },
};

/** Public TikTok URL → metadata via TikTok's official oEmbed endpoint (no account connection needed). */
export async function tiktokOembed(deps: Deps, canonicalUrl: string, id: string): Promise<ExternalVideoMeta | null> {
  const res = await providerJson<{ title?: string; author_name?: string; thumbnail_url?: string; thumbnail_width?: number; thumbnail_height?: number }>(
    deps.fetch,
    'TikTok',
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`,
  );
  if (res.status === 400 || res.status === 404 || !res.body) return null;
  if (!res.ok) throw new AppError('PROVIDER_ERROR', `TikTok returned ${res.status}`);
  return {
    externalId: id,
    title: (res.body.title || 'TikTok video').slice(0, 200),
    durationSec: null,
    width: res.body.thumbnail_width ?? 1080,
    height: res.body.thumbnail_height ?? 1920,
    thumbnailUrl: res.body.thumbnail_url ?? null,
    embedUrl: `https://www.tiktok.com/player/v1/${id}`,
    permalink: canonicalUrl,
    authorName: res.body.author_name ?? null,
  };
}
