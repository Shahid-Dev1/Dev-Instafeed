import { afterAll, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed.js';
import { createDb } from '../src/lib/db.js';
import { testEnv } from './env.js';

const db = createDb(testEnv().DATABASE_URL);
afterAll(() => db.$disconnect());

describe('database and seed', () => {
  it('connects to PostgreSQL', async () => {
    const rows = await db.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
    expect(rows[0]?.one).toBe(1);
  });

  it('seeds plans and flags idempotently without overriding flag changes', async () => {
    await seed(db);
    await db.featureFlag.updateMany({ where: { key: 'ai_assistant', storeId: null }, data: { enabled: true } });
    await seed(db);

    expect(await db.plan.count()).toBe(4);
    expect(await db.featureFlag.count({ where: { storeId: null } })).toBe(2);
    const ai = await db.featureFlag.findFirst({ where: { key: 'ai_assistant', storeId: null } });
    expect(ai?.enabled).toBe(true);
    await db.featureFlag.updateMany({ where: { key: 'ai_assistant' }, data: { enabled: false } });
  });
});
