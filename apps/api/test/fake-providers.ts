/** In-memory stand-ins for provider HTTP APIs, used only by tests at the fetch boundary. */
export class FakeProviders {
  calls: { method: string; url: string; body: string | null }[] = [];

  youtube: Record<string, { title: string; embeddable?: boolean; privacy?: string; duration?: string }> = {};
  tiktokOembed: Record<string, { title: string; author_name: string; thumbnail_url: string }> = {};
  tiktokVideos: { id: string; title: string; cover_image_url: string; duration: number }[] = [];
  tiktokRefreshFails = false;
  tiktokTokenInvalid = false;
  igMedia: { id: string; caption: string; media_type: string; media_url?: string; thumbnail_url: string; permalink: string }[] = [];
  igOembed: Record<string, { author_name: string; thumbnail_url: string }> = {};
  bunnyVideos: Record<string, { status: number; storageSize: number; length: number; width: number; height: number }> = {};
  bunnyUploads: Record<string, number> = {};
  /** Next Claude response: a JSON-serializable structured output, or 'refusal'. */
  aiOutput: unknown = null;
  /** Integration endpoints respond with failure when true. */
  integrationsFail = false;
  private guidCounter = 0;
  private tokenCounter = 0;

  reset() {
    // Keep this instance's bound fetch; copy only fresh state.
    const { fetch: _fresh, ...state } = new FakeProviders();
    Object.assign(this, state);
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    let body: string | null = null;
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof ReadableStream) body = `[stream ${(await new Response(init.body).arrayBuffer()).byteLength}]`;
    this.calls.push({ method, url: url.toString(), body });
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    const form = () => new URLSearchParams(body ?? '');

    switch (url.hostname) {
      case 'www.googleapis.com': {
        const items = (url.searchParams.get('id') ?? '').split(',').flatMap((id) => {
          const v = this.youtube[id];
          if (!v || v.privacy === 'deleted') return [];
          return [{
            id,
            snippet: { title: v.title, channelTitle: 'Brand', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg` } } },
            contentDetails: { duration: v.duration ?? 'PT45S' },
            status: { embeddable: v.embeddable ?? true, privacyStatus: v.privacy ?? 'public', uploadStatus: 'processed' },
          }];
        });
        return json({ items });
      }
      case 'www.tiktok.com': {
        const v = this.tiktokOembed[url.searchParams.get('url') ?? ''];
        return v ? json({ ...v, thumbnail_width: 720, thumbnail_height: 1280 }) : json({ code: 400 }, 400);
      }
      case 'open.tiktokapis.com': {
        const auth = new Headers(init?.headers).get('authorization');
        if (url.pathname === '/v2/oauth/token/') {
          const f = form();
          if (f.get('grant_type') === 'refresh_token' && this.tiktokRefreshFails) return json({ error: 'invalid_grant', error_description: 'revoked' });
          if (f.get('grant_type') === 'authorization_code' && f.get('code') !== 'good-code') return json({ error: 'invalid_request' });
          const n = ++this.tokenCounter;
          return json({ access_token: `tt-at-${n}`, expires_in: 86400, open_id: 'tt-open-1', refresh_token: `tt-rt-${n}`, refresh_expires_in: 31536000, scope: 'user.info.basic,video.list' });
        }
        if (url.pathname === '/v2/oauth/revoke/') return json({});
        if (url.pathname === '/v2/user/info/') return json({ data: { user: { display_name: 'brand_tiktok' } }, error: { code: 'ok' } });
        if (this.tiktokTokenInvalid || !auth?.startsWith('Bearer tt-at-')) return json({ error: { code: 'access_token_invalid', message: 'invalid' } }, 401);
        const req = JSON.parse(body ?? '{}') as { cursor?: number; filters?: { video_ids: string[] } };
        if (url.pathname === '/v2/video/list/') {
          const start = req.cursor ?? 0;
          const page = this.tiktokVideos.slice(start, start + 20);
          return json({ data: { videos: page, cursor: start + page.length, has_more: start + page.length < this.tiktokVideos.length }, error: { code: 'ok' } });
        }
        if (url.pathname === '/v2/video/query/') {
          return json({ data: { videos: this.tiktokVideos.filter((v) => req.filters!.video_ids.includes(v.id)) }, error: { code: 'ok' } });
        }
        break;
      }
      case 'api.instagram.com':
        return form().get('code') === 'good-code'
          ? json({ data: [{ access_token: 'ig-short', user_id: 1784, permissions: 'instagram_business_basic' }] })
          : json({ error_type: 'OAuthException', error_message: 'Invalid code' }, 400);
      case 'graph.instagram.com': {
        if (url.pathname === '/access_token' || url.pathname === '/refresh_access_token') {
          return json({ access_token: `ig-long-${++this.tokenCounter}`, token_type: 'bearer', expires_in: 5184000 });
        }
        if (!url.searchParams.get('access_token')?.startsWith('ig-long-')) return json({ error: { code: 190, message: 'Invalid OAuth access token' } }, 400);
        const path = url.pathname.split('/').slice(2).join('/');
        if (path === 'me') return json({ user_id: '1784', username: 'brand_ig' });
        if (path === 'me/media') return json({ data: this.igMedia, paging: { cursors: { after: 'x' } } });
        const media = this.igMedia.find((m) => m.id === path);
        return media ? json(media) : json({ error: { code: 100, message: 'does not exist' } }, 400);
      }
      case 'scontent.cdninstagram.com':
        return new Response(new Uint8Array(4096), { headers: { 'content-length': '4096', 'content-type': 'video/mp4' } });
      case 'www.google-analytics.com':
        return json({ validationMessages: this.integrationsFail ? [{ description: 'Measurement ID not found' }] : [] });
      case 'api.mixpanel.com':
      case 'api-eu.mixpanel.com':
      case 'api-in.mixpanel.com':
        return json(this.integrationsFail ? { status: 0, error: 'token, missing or empty' } : { status: 1 });
      case 'in1.api.clevertap.com':
      case 'eu1.api.clevertap.com':
        return json(this.integrationsFail ? { status: 'fail', error: 'Invalid passcode' } : { status: 'success', processed: 1, unprocessed: [] });
      case 'api.anthropic.com': {
        const refusal = this.aiOutput === 'refusal';
        return json({
          id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
          content: refusal ? [] : [{ type: 'text', text: JSON.stringify(this.aiOutput) }],
          stop_reason: refusal ? 'refusal' : 'end_turn', stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      }
      case 'graph.facebook.com': {
        if (url.pathname.endsWith('/events')) {
          return this.integrationsFail ? json({ error: { message: 'Invalid OAuth access token' } }, 400) : json({ events_received: 1, fbtrace_id: 'x' });
        }
        const shortcode = /\/reel\/([^/]+)/.exec(url.searchParams.get('url') ?? '')?.[1] ?? '';
        const v = this.igOembed[shortcode];
        return v ? json(v) : json({ error: { message: 'not found' } }, 400);
      }
      case 'video.bunnycdn.com': {
        const guid = url.pathname.split('/')[4];
        if (method === 'POST' && url.pathname.endsWith('/videos')) {
          const g = `guid-${++this.guidCounter}`;
          this.bunnyVideos[g] = { status: 0, storageSize: 0, length: 0, width: 0, height: 0 };
          return json({ guid: g, title: JSON.parse(body!).title });
        }
        if (!guid || !this.bunnyVideos[guid]) return json({ message: 'not found' }, 404);
        if (method === 'PUT') {
          this.bunnyUploads[guid] = Number(/\d+/.exec(body ?? '')?.[0] ?? 0);
          this.bunnyVideos[guid] = { ...this.bunnyVideos[guid], status: 1, storageSize: this.bunnyUploads[guid]! };
          return json({ success: true });
        }
        if (method === 'DELETE') {
          delete this.bunnyVideos[guid];
          return json({ success: true });
        }
        return json({ guid, title: 't', thumbnailFileName: 'thumbnail.jpg', ...this.bunnyVideos[guid] });
      }
    }
    return new Response('unexpected request', { status: 599 });
  };

  callsTo(host: string) {
    return this.calls.filter((c) => new URL(c.url).hostname === host);
  }
}
