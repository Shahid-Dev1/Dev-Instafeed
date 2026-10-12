/**
 * Grants or revokes internal support-console access. Usage:
 *   pnpm --filter @instafeed/api support:grant <email> [SUPPORT|ADMIN|revoke]
 * The user must already have registered with that email.
 */
import { parseEnv } from '../src/config/env.js';
import { loadRootEnvFile } from '../src/config/load-env-file.js';
import { createDb } from '../src/lib/db.js';

loadRootEnvFile();
const [email, roleArg = 'SUPPORT'] = process.argv.slice(2);
if (!email) {
  console.error('Usage: support:grant <email> [SUPPORT|ADMIN|revoke]');
  process.exit(1);
}
const db = createDb(parseEnv(process.env).DATABASE_URL);
const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
if (!user) {
  console.error(`No registered user with email ${email}`);
  process.exit(1);
}
if (roleArg === 'revoke') await db.platformRole.deleteMany({ where: { userId: user.id } });
else {
  const role = roleArg === 'ADMIN' ? 'ADMIN' : 'SUPPORT';
  await db.platformRole.upsert({ where: { userId: user.id }, create: { userId: user.id, role }, update: { role } });
}
await db.auditLog.create({ data: { storeId: null, actorType: 'SYSTEM', action: roleArg === 'revoke' ? 'support.revoked' : 'support.granted', target: user.id, meta: { role: roleArg } } });
await db.$disconnect();
console.warn(`[support] ${roleArg === 'revoke' ? 'revoked' : `granted ${roleArg}`} for ${email}`);
