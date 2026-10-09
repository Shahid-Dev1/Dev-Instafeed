import { loginSchema, registerSchema, type Me } from '@instafeed/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, SESSION_COOKIE } from './context.js';

// Verified against when the email is unknown, so response timing does not reveal registered emails.
const DUMMY_HASH = await hashPassword(randomToken());

export function authRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const rateLimit = {
      max: 10,
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (req: FastifyRequest) => `${req.ip}:${String((req.body as { email?: unknown })?.email ?? '').toLowerCase()}`,
    };

    async function startSession(reply: FastifyReply, userId: string) {
      const token = randomToken();
      const ttlMs = deps.env.SESSION_TTL_DAYS * 86_400_000;
      // Pre-select the user's store when they belong to exactly one.
      const memberships = await deps.rawDb.membership.findMany({ where: { userId }, select: { storeId: true }, take: 2 });
      await deps.rawDb.session.create({
        data: {
          tokenHash: sha256(token),
          userId,
          storeId: memberships.length === 1 ? memberships[0]!.storeId : null,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: deps.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ttlMs / 1000,
      });
    }

    app.post('/api/v1/auth/register', { config: { rateLimit } }, async (req, reply) => {
      const input = validate(registerSchema, req.body);
      const exists = await deps.rawDb.user.findUnique({ where: { email: input.email } });
      if (exists) throw new AppError('CONFLICT', 'An account with this email already exists');
      const user = await deps.rawDb.user.create({
        data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) },
      });
      await startSession(reply, user.id);
      await audit(deps.rawDb, { storeId: null, actorType: 'USER', actorId: user.id, action: 'user.registered', ip: req.ip });
      return reply.code(201).send({ ok: true });
    });

    app.post('/api/v1/auth/login', { config: { rateLimit } }, async (req, reply) => {
      const input = validate(loginSchema, req.body);
      const user = await deps.rawDb.user.findUnique({ where: { email: input.email } });
      const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user?.passwordHash || !valid) throw new AppError('UNAUTHENTICATED', 'Invalid email or password');
      await startSession(reply, user.id);
      return { ok: true };
    });

    app.post('/api/v1/auth/logout', async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) await deps.rawDb.session.deleteMany({ where: { tokenHash: sha256(token) } });
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    });

    app.get('/api/v1/me', { preHandler: authenticate(deps) }, async (req): Promise<Me> => {
      const ctx = req.ctx!;
      const user = await deps.rawDb.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      const rows = await deps.rawDb.membership.findMany({
        where: { userId: ctx.userId, store: { uninstalledAt: null } },
        include: { store: { select: { shopDomain: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const memberships = rows.map((m) => ({ storeId: m.storeId, shopDomain: m.store.shopDomain, storeName: m.store.name, role: m.role }));
      return {
        user: { id: user.id, email: user.email, name: user.name },
        memberships,
        current: memberships.find((m) => m.storeId === ctx.storeId) ?? null,
      };
    });
  };
}
