import { emailSchema, updateRoleSchema, type TeamMember } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';

const paramsSchema = z.object({ userId: z.string().min(1).max(64) });
const inviteSchema = z.object({ email: emailSchema, role: z.enum(['ADMIN', 'EDITOR', 'ANALYST']) }).strict();
const INVITE_TTL_MS = 7 * 86_400_000;

export function teamRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const adminOnly = { preHandler: [authenticate(deps), requireRole('ADMIN')] };

    /** Loads a member of the caller's store; rejects owners and self-modification. */
    async function editableMember(storeId: string, actorId: string, userId: string) {
      const member = await deps.db.membership.findUnique({ where: { storeId_userId: { storeId, userId } } });
      if (!member) throw new AppError('NOT_FOUND', 'Team member not found');
      if (member.role === 'OWNER') throw new AppError('FORBIDDEN', 'The store owner cannot be changed');
      if (userId === actorId) throw new AppError('FORBIDDEN', 'You cannot change your own access');
      return member;
    }

    app.get('/api/v1/team', adminOnly, async (req): Promise<{ members: TeamMember[] }> => {
      const { storeId } = storeCtx(req);
      const rows = await deps.db.membership.findMany({
        where: { storeId },
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return { members: rows.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role })) };
    });

    app.patch('/api/v1/team/:userId', adminOnly, async (req) => {
      const ctx = storeCtx(req);
      const { userId } = validate(paramsSchema, req.params);
      const { role } = validate(updateRoleSchema, req.body);
      const member = await editableMember(ctx.storeId, ctx.userId, userId);
      await deps.db.membership.update({ where: { storeId_userId: { storeId: ctx.storeId, userId } }, data: { role } });
      await audit(deps.rawDb, {
        storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'team.role_changed', target: userId,
        meta: { from: member.role, to: role }, ip: req.ip,
      });
      return { ok: true };
    });

    /**
     * Invites: no email provider is configured, so the API returns a one-time link for the admin to share.
     * Only a SHA-256 of the token is stored; it expires after 7 days and can be used once by the invited email.
     */
    app.post('/api/v1/team/invites', adminOnly, async (req, reply) => {
      const ctx = storeCtx(req);
      const { email, role } = validate(inviteSchema, req.body);
      // Only owners may invite admins.
      if (role === 'ADMIN' && ctx.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Only the owner can invite admins');
      const member = await deps.rawDb.user.findFirst({ where: { email, memberships: { some: { storeId: ctx.storeId } } }, select: { id: true } });
      if (member) throw new AppError('CONFLICT', 'This person is already on the team');
      const token = randomToken();
      await deps.db.invite.deleteMany({ where: { storeId: ctx.storeId, email, acceptedAt: null } });
      const invite = await deps.db.invite.create({
        data: { storeId: ctx.storeId, email, role, tokenHash: sha256(token), invitedById: ctx.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'team.invited', target: email, meta: { role }, ip: req.ip });
      return reply.code(201).send({ id: invite.id, email, role, expiresAt: invite.expiresAt.toISOString(), link: `${new URL(deps.env.SHOPIFY_APP_URL).origin}/invite?token=${token}` });
    });

    app.get('/api/v1/team/invites', adminOnly, async (req) => {
      const { storeId } = storeCtx(req);
      const rows = await deps.db.invite.findMany({ where: { storeId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
      return { invites: rows.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })) };
    });

    app.delete('/api/v1/team/invites/:id', adminOnly, async (req) => {
      const ctx = storeCtx(req);
      const { id } = validate(z.object({ id: z.string().min(1).max(64) }), req.params);
      const res = await deps.db.invite.deleteMany({ where: { storeId: ctx.storeId, id, acceptedAt: null } });
      if (!res.count) throw new AppError('NOT_FOUND', 'Invite not found');
      return { ok: true };
    });

    /** Accepted by a logged-in email user whose address matches the invite. */
    app.post('/api/v1/auth/invites/accept', { preHandler: authenticate(deps) }, async (req) => {
      const { token } = validate(z.object({ token: z.string().min(20).max(100) }), req.body);
      const user = await deps.rawDb.user.findUniqueOrThrow({ where: { id: req.ctx!.userId } });
      const invite = await deps.rawDb.invite.findUnique({ where: { tokenHash: sha256(token) } });
      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new AppError('NOT_FOUND', 'This invite is invalid or has expired');
      if (!user.email || user.email !== invite.email) throw new AppError('FORBIDDEN', `This invite was sent to ${invite.email}. Log in with that email to accept it.`);
      await deps.rawDb.$transaction(async (tx) => {
        const claimed = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
        if (!claimed.count) throw new AppError('CONFLICT', 'This invite was already used');
        await tx.membership.upsert({
          where: { storeId_userId: { storeId: invite.storeId, userId: user.id } },
          create: { storeId: invite.storeId, userId: user.id, role: invite.role },
          update: {},
        });
      });
      await audit(deps.rawDb, { storeId: invite.storeId, actorType: 'USER', actorId: user.id, action: 'team.invite_accepted', target: invite.email });
      return { storeId: invite.storeId };
    });

    app.delete('/api/v1/team/:userId', adminOnly, async (req) => {
      const ctx = storeCtx(req);
      const { userId } = validate(paramsSchema, req.params);
      await editableMember(ctx.storeId, ctx.userId, userId);
      await deps.db.membership.delete({ where: { storeId_userId: { storeId: ctx.storeId, userId } } });
      await deps.rawDb.session.deleteMany({ where: { userId, storeId: ctx.storeId } });
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'team.member_removed', target: userId, ip: req.ip });
      return { ok: true };
    });
  };
}
