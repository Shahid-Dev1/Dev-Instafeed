import type { Prisma } from '../../generated/prisma/client.js';
import type { Db } from '../../lib/db.js';

export interface AuditEntry {
  storeId: string | null;
  actorType: 'USER' | 'SHOPIFY' | 'SYSTEM' | 'SUPPORT';
  actorId?: string | null;
  action: string;
  target?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
}

type AuditWriter = Pick<Db, 'auditLog'>;

export async function audit(db: AuditWriter, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: entry });
}
