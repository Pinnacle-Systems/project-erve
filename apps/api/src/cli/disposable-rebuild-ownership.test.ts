import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { readDisposableDatabaseIdentity } from './disposable-rebuild.js';

describe('durable rebuild ownership in PostgreSQL shared catalogs', () => {
  it('reads the committed database comment used for interrupted-run recovery', async () => {
    const name = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
    if (!/^[a-z0-9_]+_test$/.test(name))
      throw new Error('Ownership test requires an explicit disposable fixture database');
    const [before] = await prisma.$queryRaw<
      Array<{ name: string; owner: string | null }>
    >`SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS owner FROM pg_database WHERE datname = current_database()`;
    if (before?.name !== name) throw new Error('Unexpected fixture endpoint');
    const marker = `ownership-test:${randomUUID()}`;
    try {
      await prisma.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS '${marker}'`);
      expect(await readDisposableDatabaseIdentity()).toMatchObject({ name, owner: marker });
    } finally {
      const previous = before.owner === null ? 'NULL' : `'${before.owner.replaceAll("'", "''")}'`;
      await prisma.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS ${previous}`);
    }
  });
});
