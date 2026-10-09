import { hasRole, type Role } from '@instafeed/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { installFromSessionToken, needsInstall } from '../shopify/install.js';
import { verifySessionToken } from '../shopify/session-token.js';

export const SESSION_COOKIE = 'ifs_session';

export interface RequestContext {
  userId: string;
  via: 'shopify' | 'session';
  /** Present once a store has been resolved and membership verified. */
  storeId: string | null;
  role: Role | null;
}

export interface StoreContext extends RequestContext {
  storeId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext | null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function fromShopifyToken(deps: Deps, token: string): Promise<RequestContext> {
  const claims = verifySessionToken(token, { apiKey: deps.env.SHOPIFY_API_KEY, apiSecret: deps.env.SHOPIFY_API_SECRET });
  let store = await deps.rawDb.store.findUnique({ where: { shopDomain: claims.shop } });
  if (needsInstall(store)) store = await installFromSessionToken(deps, claims.shop, token);

  const storeId = store!.id;
  const user = await deps.rawDb.user.upsert({
    where: { shopifyUserId: `${claims.shop}:${claims.sub}` },
    create: { shopifyUserId: `${claims.shop}:${claims.sub}` },
    update: {},
  });
  let membership = await deps.db.membership.findUnique({ where: { storeId_userId: { storeId, userId: user.id } } });
  if (!membership) {
    // The first staff member to open the app after install becomes the owner; later staff default to Editor.
    const hasOwner = await deps.db.membership.count({ where: { storeId, role: 'OWNER' } });
    // upsert tolerates concurrent first requests from the same user.
    membership = await deps.db.membership.upsert({
      where: { storeId_userId: { storeId, userId: user.id } },
      create: { storeId, userId: user.id, role: hasOwner ? 'EDITOR' : 'OWNER' },
      update: {},
    });
  }
  return { userId: user.id, via: 'shopify', storeId, role: membership.role };
}

async function fromSessionCookie(deps: Deps, req: FastifyRequest, raw: string): Promise<RequestContext> {
  const session = await deps.rawDb.session.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!session || session.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 'Session expired');

  if (MUTATING.has(req.method)) {
    // CSRF defence for cookie auth: mutations must come from our own origins.
    const origin = req.headers.origin;
    const allowed = [new URL(deps.env.WEB_URL).origin, new URL(deps.env.SHOPIFY_APP_URL).origin];
    if (!origin || !allowed.includes(origin)) throw new AppError('FORBIDDEN', 'Cross-origin request rejected');
  }

  const header = req.headers['x-store-id'];
  const storeId = (typeof header === 'string' && header) || session.storeId;
  if (!storeId) return { userId: session.userId, via: 'session', storeId: null, role: null };

  const membership = await deps.db.membership.findUnique({
    where: { storeId_userId: { storeId, userId: session.userId } },
    include: { store: { select: { uninstalledAt: true } } },
  });
  // Same response for "no such store" and "not a member" so store ids cannot be probed.
  if (!membership) throw new AppError('FORBIDDEN', 'No access to this store');
  if (membership.store.uninstalledAt) throw new AppError('FORBIDDEN', 'Store has uninstalled the app');
  return { userId: session.userId, via: 'session', storeId, role: membership.role };
}

/** preHandler: resolves the caller from a Shopify session token (embedded) or a dashboard session cookie. */
export function authenticate(deps: Deps) {
  return async (req: FastifyRequest) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      req.ctx = await fromShopifyToken(deps, auth.slice(7));
      return;
    }
    const cookie = req.cookies?.[SESSION_COOKIE];
    if (cookie) {
      req.ctx = await fromSessionCookie(deps, req, cookie);
      return;
    }
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  };
}

/** preHandler: requires a resolved store and at least `min` role. */
export function requireRole(min: Role) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const ctx = req.ctx;
    if (!ctx) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    if (!ctx.storeId || !ctx.role) throw new AppError('FORBIDDEN', 'Select a store first');
    if (!hasRole(ctx.role, min)) throw new AppError('FORBIDDEN', `Requires ${min} role or higher`);
  };
}

export function storeCtx(req: FastifyRequest): StoreContext {
  const ctx = req.ctx;
  if (!ctx?.storeId || !ctx.role) throw new AppError('FORBIDDEN', 'Select a store first');
  return ctx as StoreContext;
}
