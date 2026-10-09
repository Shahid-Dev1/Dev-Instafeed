import { importProviderVideosSchema, PROVIDERS, type ProviderVideo } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';
import { instagram } from '../videos/providers/instagram.js';
import { tiktok } from '../videos/providers/tiktok.js';
import type { AccountVideo, AccountVideoPage } from '../videos/providers/types.js';
import { importAccountVideos } from '../videos/service.js';
import {
  assertProviderAvailable,
  consumeOAuthState,
  createOAuthState,
  getAccount,
  PROVIDER,
  redirectUri,
  saveAccount,
  withProviderToken,
  type ProviderSlug,
} from './accounts.js';

const providerParams = z.object({ provider: z.enum(PROVIDERS) });
const listQuery = z.object({ cursor: z.string().max(200).optional() });
const callbackQuery = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() });

const PROVIDER_SOURCE = { tiktok: 'TIKTOK_ACCOUNT', instagram: 'INSTAGRAM_ACCOUNT' } as const;

const api = {
  tiktok: { authorizeUrl: tiktok.authorizeUrl, exchangeCode: tiktok.exchangeCode, list: tiktok.listVideos, fetch: tiktok.queryVideos },
  instagram: {
    authorizeUrl: instagram.authorizeUrl,
    exchangeCode: instagram.exchangeCode,
    list: instagram.listReels,
    fetch: async (deps: Deps, token: string, ids: string[]) =>
      (await Promise.all(ids.map((id) => instagram.getMedia(deps, token, id)))).filter((v): v is AccountVideo => v !== null),
  },
} satisfies Record<ProviderSlug, {
  authorizeUrl: (deps: Deps, state: string, redirect: string) => string;
  exchangeCode: (deps: Deps, code: string, redirect: string) => Promise<unknown>;
  list: (deps: Deps, token: string, cursor: string | null) => Promise<AccountVideoPage>;
  fetch: (deps: Deps, token: string, ids: string[]) => Promise<AccountVideo[]>;
}>;

/** Where the merchant lands after authorizing: back inside the embedded app in Shopify admin. */
function adminAppUrl(deps: Deps, shopDomain: string, query: Record<string, string>) {
  const handle = shopDomain.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${handle}/apps/${deps.env.SHOPIFY_API_KEY}/app/videos?${new URLSearchParams(query)}`;
}

export function connectionRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const admin = { preHandler: [authenticate(deps), requireRole('ADMIN')] };
    const editor = { preHandler: [authenticate(deps), requireRole('EDITOR')] };

    app.post('/api/v1/connections/:provider/start', admin, async (req) => {
      const ctx = storeCtx(req);
      const { provider } = validate(providerParams, req.params);
      await assertProviderAvailable(deps, ctx.storeId, provider);
      const state = await createOAuthState(deps, ctx.storeId, ctx.userId, provider);
      return { authorizeUrl: api[provider].authorizeUrl(deps, state, redirectUri(deps, provider)) };
    });

    /** Public: the provider redirects the browser here. Trust comes only from the single-use state. */
    app.get('/oauth/:provider/callback', async (req, reply) => {
      const { provider } = validate(providerParams, req.params);
      const q = validate(callbackQuery, req.query);
      if (!q.state) throw new AppError('VALIDATION_ERROR', 'Missing state');
      const state = await consumeOAuthState(deps, q.state, provider);
      const store = await deps.rawDb.store.findUniqueOrThrow({ where: { id: state.storeId }, select: { shopDomain: true } });
      if (q.error || !q.code) return reply.redirect(adminAppUrl(deps, store.shopDomain, { connectError: provider }));
      try {
        await assertProviderAvailable(deps, state.storeId, provider);
        const tokens = await api[provider].exchangeCode(deps, q.code, redirectUri(deps, provider));
        await saveAccount(deps, state.storeId, state.userId, provider, tokens);
        await audit(deps.rawDb, { storeId: state.storeId, actorType: 'USER', actorId: state.userId, action: 'connection.connected', target: provider, ip: req.ip });
      } catch (err) {
        req.log.warn({ err, provider }, 'provider connection failed');
        return reply.redirect(adminAppUrl(deps, store.shopDomain, { connectError: provider }));
      }
      return reply.redirect(adminAppUrl(deps, store.shopDomain, { connected: provider }));
    });

    app.delete('/api/v1/connections/:provider', admin, async (req) => {
      const ctx = storeCtx(req);
      const { provider } = validate(providerParams, req.params);
      const account = await getAccount(deps, ctx.storeId, provider);
      if (!account) throw new AppError('NOT_FOUND', 'Account is not connected');
      if (provider === 'tiktok') {
        // Best effort: revoke the grant at TikTok; local tokens are deleted regardless.
        await tiktok.revoke(deps, decrypt(account.accessTokenEnc, deps.env.ENCRYPTION_KEY)).catch((err: unknown) => req.log.warn({ err }, 'tiktok revoke failed'));
      }
      await deps.db.providerAccount.delete({ where: { storeId_provider: { storeId: ctx.storeId, provider: PROVIDER[provider] } } });
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'connection.disconnected', target: provider, ip: req.ip });
      return { ok: true };
    });

    app.get('/api/v1/connections/:provider/videos', editor, async (req) => {
      const { storeId } = storeCtx(req);
      const { provider } = validate(providerParams, req.params);
      const { cursor } = validate(listQuery, req.query);
      await assertProviderAvailable(deps, storeId, provider);
      const page = await withProviderToken(deps, storeId, provider, (t) => api[provider].list(deps, t, cursor ?? null));
      const existing = await deps.db.video.findMany({
        where: { storeId, source: PROVIDER_SOURCE[provider], externalId: { in: page.items.map((i) => i.id) } },
        select: { externalId: true },
      });
      const imported = new Set(existing.map((e) => e.externalId));
      const items: ProviderVideo[] = page.items.map((v) => ({
        id: v.id,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        durationSec: v.durationSec,
        importable: v.importable,
        reason: v.reason,
        alreadyImported: imported.has(v.id),
      }));
      return { items, nextCursor: page.nextCursor };
    });

    app.post('/api/v1/connections/:provider/import', editor, async (req) => {
      const ctx = storeCtx(req);
      const { provider } = validate(providerParams, req.params);
      const { ids, rightsConfirmed } = validate(importProviderVideosSchema, req.body);
      if (provider === 'instagram' && !rightsConfirmed) {
        throw new AppError('VALIDATION_ERROR', 'Confirm you own these Reels before importing', [{ path: 'rightsConfirmed', message: 'Required' }]);
      }
      await assertProviderAvailable(deps, ctx.storeId, provider);
      // Re-fetch from the provider: only videos the authorized account actually owns can be imported.
      const videos = await withProviderToken(deps, ctx.storeId, provider, (t) => api[provider].fetch(deps, t, ids));
      const found = new Set(videos.map((v) => v.id));
      const result = await importAccountVideos(deps, ctx, provider, videos);
      return { ...result, skipped: [...result.skipped, ...ids.filter((id) => !found.has(id)).map((id) => ({ id, reason: 'Not found on this account' }))] };
    });
  };
}
