import type { Deps } from '../../../deps.js';
import { AppError } from '../../../lib/errors.js';
import { form, providerJson } from './http.js';
import { ReauthRequiredError, type AccountVideo, type AccountVideoPage, type OAuthTokens } from './types.js';
import type { ExternalVideoMeta } from './youtube.js';

/** Instagram API with Instagram Login (Business/Creator accounts). Read-only access to the user's own media. */
export const INSTAGRAM_SCOPES = 'instagram_business_basic';
const MEDIA_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';

export const instagramConfigured = (deps: Deps) => Boolean(deps.env.INSTAGRAM_APP_ID && deps.env.INSTAGRAM_APP_SECRET);
const graph = (deps: Deps, path: string) => `https://graph.instagram.com/${deps.env.INSTAGRAM_GRAPH_VERSION}${path}`;

function creds(deps: Deps) {
  if (!instagramConfigured(deps)) throw new AppError('SERVICE_UNAVAILABLE', 'Instagram is not configured');
  return { client_id: deps.env.INSTAGRAM_APP_ID!, client_secret: deps.env.INSTAGRAM_APP_SECRET! };
}

interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
}

/**
 * media_product_type (REELS) is not available with Instagram Login, so every VIDEO is treated as a Reel.
 * media_url is omitted for videos with licensed audio; those cannot be imported.
 */
function toAccountVideo(m: IgMedia): AccountVideo {
  const isVideo = m.media_type === 'VIDEO';
  const reason = !isVideo ? 'Not a video' : !m.media_url ? 'Instagram does not provide this video file (e.g. licensed audio)' : null;
  return {
    id: m.id,
    title: (m.caption?.split('\n')[0] || 'Instagram Reel').slice(0, 200),
    thumbnailUrl: m.thumbnail_url ?? null,
    durationSec: null,
    width: null,
    height: null,
    embedUrl: m.permalink ? `${m.permalink.replace(/\/?$/, '/')}embed` : null,
    permalink: m.permalink ?? null,
    mediaUrl: m.media_url ?? null,
    importable: reason === null,
    reason,
  };
}

async function graphGet<T>(deps: Deps, url: string): Promise<T> {
  const res = await providerJson<T & { error?: { code?: number; type?: string; message?: string } }>(deps.fetch, 'Instagram', url);
  const err = res.body?.error;
  if (err?.code === 190 || res.status === 401) throw new ReauthRequiredError(err?.message ?? 'Instagram authorization expired');
  if (err || !res.ok || !res.body) throw new AppError('PROVIDER_ERROR', `Instagram error: ${err?.message ?? res.status}`);
  return res.body;
}

export const instagram = {
  authorizeUrl(deps: Deps, state: string, redirectUri: string): string {
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.search = new URLSearchParams({ client_id: creds(deps).client_id, redirect_uri: redirectUri, response_type: 'code', scope: INSTAGRAM_SCOPES, state }).toString();
    return u.toString();
  },

  /** Code → short-lived token → 60-day long-lived token, plus the account username. */
  async exchangeCode(deps: Deps, code: string, redirectUri: string): Promise<OAuthTokens> {
    const c = creds(deps);
    type Short = { access_token?: string; user_id?: string | number; permissions?: string | string[] };
    const res = await providerJson<Short & { data?: Short[]; error_message?: string }>(
      deps.fetch,
      'Instagram',
      'https://api.instagram.com/oauth/access_token',
      form({ ...c, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
    );
    const short = res.body?.data?.[0] ?? res.body;
    if (!short?.access_token || short.user_id === undefined) {
      throw new AppError('UNAUTHENTICATED', `Instagram authorization failed${res.body?.error_message ? `: ${res.body.error_message}` : ''}`);
    }
    const long = await graphGet<{ access_token: string; expires_in: number }>(
      deps,
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: c.client_secret, access_token: short.access_token })}`,
    );
    const me = await graphGet<{ username?: string }>(deps, `${graph(deps, '/me')}?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`);
    return {
      externalUserId: String(short.user_id),
      username: me.username ?? null,
      accessToken: long.access_token,
      accessTokenExpiresAt: new Date(Date.now() + long.expires_in * 1000),
      refreshToken: null,
      refreshTokenExpiresAt: null,
      scopes: Array.isArray(short.permissions) ? short.permissions.join(',') : (short.permissions ?? INSTAGRAM_SCOPES),
    };
  },

  /** Long-lived tokens can be refreshed once at least 24h old; each refresh grants 60 more days. */
  async refresh(deps: Deps, accessToken: string): Promise<{ accessToken: string; accessTokenExpiresAt: Date }> {
    const r = await graphGet<{ access_token: string; expires_in: number }>(
      deps,
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`,
    );
    return { accessToken: r.access_token, accessTokenExpiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },

  async listReels(deps: Deps, accessToken: string, cursor: string | null): Promise<AccountVideoPage> {
    const q = new URLSearchParams({ fields: MEDIA_FIELDS, limit: '25', access_token: accessToken, ...(cursor ? { after: cursor } : {}) });
    const page = await graphGet<{ data?: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }>(deps, `${graph(deps, '/me/media')}?${q}`);
    return {
      items: (page.data ?? []).filter((m) => m.media_type === 'VIDEO').map(toAccountVideo),
      nextCursor: page.paging?.next && page.paging.cursors?.after ? page.paging.cursors.after : null,
    };
  },

  /** Fresh media (media_url expires) for one of the account's own posts. */
  async getMedia(deps: Deps, accessToken: string, mediaId: string): Promise<AccountVideo | null> {
    try {
      return toAccountVideo(await graphGet<IgMedia>(deps, `${graph(deps, `/${encodeURIComponent(mediaId)}`)}?fields=${MEDIA_FIELDS}&access_token=${encodeURIComponent(accessToken)}`));
    } catch (err) {
      if (err instanceof AppError && err.code === 'PROVIDER_ERROR') return null;
      throw err;
    }
  },
};

/** Public Reel URL embed via Meta's oEmbed (requires the oEmbed Read feature and an app token). */
export async function instagramOembed(deps: Deps, canonicalUrl: string, shortcode: string): Promise<ExternalVideoMeta | null> {
  const token = deps.env.META_OEMBED_TOKEN;
  if (!token) throw new AppError('SERVICE_UNAVAILABLE', 'Instagram link embedding is not configured');
  const q = new URLSearchParams({ url: canonicalUrl, access_token: token, omitscript: 'true' });
  const res = await providerJson<{ author_name?: string; thumbnail_url?: string; title?: string; error?: { message?: string } }>(
    deps.fetch,
    'Instagram',
    `https://graph.facebook.com/${deps.env.INSTAGRAM_GRAPH_VERSION}/instagram_oembed?${q}`,
  );
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok || !res.body) throw new AppError('PROVIDER_ERROR', `Instagram returned ${res.status}`);
  return {
    externalId: shortcode,
    title: (res.body.title || `Instagram Reel by ${res.body.author_name ?? 'creator'}`).slice(0, 200),
    durationSec: null,
    width: 1080,
    height: 1920,
    thumbnailUrl: res.body.thumbnail_url ?? null,
    embedUrl: `https://www.instagram.com/reel/${shortcode}/embed`,
    permalink: canonicalUrl,
    authorName: res.body.author_name ?? null,
  };
}
