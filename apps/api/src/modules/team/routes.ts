import { updateRoleSchema, type TeamMember } from '@instafeed/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { AppError, validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';

const paramsSchema = z.object({ userId: z.string().min(1).max(64) });

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
