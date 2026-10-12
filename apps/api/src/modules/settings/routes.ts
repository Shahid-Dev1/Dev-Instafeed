import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { validate } from '../../lib/errors.js';
import { audit } from '../audit/audit.js';
import { authenticate, requireRole, storeCtx } from '../auth/context.js';

/** Authorized domains are exact https origins (no paths, wildcards or http); stored normalized. */
const originSchema = z
  .string()
  .trim()
  .max(253)
  .transform((s, ctx) => {
    try {
      const u = new URL(s.includes('://') ? s : `https://${s}`);
      if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.username || u.hostname.includes('*') || !u.hostname.includes('.')) throw new Error();
      return u.origin;
    } catch {
      ctx.addIssue({ code: 'custom', message: `"${s}" is not a valid https domain` });
      return z.NEVER;
    }
  });

const storeSettingsSchema = z
  .object({
    defaultPurchaseFlow: z.enum(['POPUP', 'PDP']).optional(),
    authorizedDomains: z.array(originSchema).max(10).transform((d) => [...new Set(d)]).optional(),
  })
  .strict();

export function settingsRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    const read = { preHandler: [authenticate(deps), requireRole('ANALYST')] };
    const admin = { preHandler: [authenticate(deps), requireRole('ADMIN')] };

    app.get('/api/v1/settings/store', read, async (req) => {
      const { storeId } = storeCtx(req);
      const [s, store] = await Promise.all([
        deps.db.storeSettings.findUnique({ where: { storeId } }),
        deps.rawDb.store.findUniqueOrThrow({ where: { id: storeId }, select: { publicKey: true } }),
      ]);
      return {
        defaultPurchaseFlow: s?.defaultPurchaseFlow ?? 'POPUP',
        authorizedDomains: s?.authorizedDomains ?? [],
        headlessEndpoint: `${new URL(deps.env.SHOPIFY_APP_URL).origin}/public/v1/${store.publicKey}/widgets`,
      };
    });

    app.patch('/api/v1/settings/store', admin, async (req) => {
      const ctx = storeCtx(req);
      const input = validate(storeSettingsSchema, req.body);
      const s = await deps.db.storeSettings.upsert({ where: { storeId: ctx.storeId }, create: { storeId: ctx.storeId, ...input }, update: input });
      await audit(deps.rawDb, { storeId: ctx.storeId, actorType: 'USER', actorId: ctx.userId, action: 'settings.store', meta: input, ip: req.ip });
      return { defaultPurchaseFlow: s.defaultPurchaseFlow, authorizedDomains: s.authorizedDomains };
    });
  };
}
