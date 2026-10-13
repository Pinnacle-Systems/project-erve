import { readFile } from 'node:fs/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma, type Prisma } from '../../db/prisma.js';

afterAll(() => prisma.$disconnect());

// Execute the actual migration in a private transactional schema, so the
// collision fixture does not require disabling the live test DB constraint.
async function replayMigration(
  rows: string,
  verify?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const migrations = await Promise.all([
    readFile(
      new URL(
        '../../../prisma/migrations/20261013000000_master_identity/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../../prisma/migrations/20261013000100_master_code_counter/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  const schema = `identity_test_${createId().toLowerCase()}`;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
      await tx.$executeRawUnsafe(
        'CREATE TABLE distributors (id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, purchase_mode TEXT)',
      );
      await tx.$executeRawUnsafe('CREATE TABLE factories (id TEXT PRIMARY KEY, code TEXT UNIQUE)');
      await tx.$executeRawUnsafe(
        'CREATE TABLE retail_stores (id TEXT PRIMARY KEY, distributor_id TEXT, code TEXT, UNIQUE(distributor_id, code))',
      );
      await tx.$executeRawUnsafe(rows);
      for (const statement of migrations.flatMap((migration) =>
        migration.split('-- statement-breakpoint'),
      )) {
        // The caller already owns the transaction, including schema teardown.
        if (statement.trim() && !/^\s*(BEGIN|COMMIT);\s*$/.test(statement))
          await tx.$executeRawUnsafe(statement);
      }
      if (verify) await verify(tx);
    });
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
}

describe('master identity migration', () => {
  it('treats tabs and line breaks at name edges as whitespace during collision preflight', async () => {
    await expect(replayMigration("INSERT INTO distributors VALUES ('duplicate-a','OLD-A', E'\\tAcme\\nTraders\\t','OUTRIGHT'), ('duplicate-b','OLD-B','acme traders','OUTRIGHT')"))
      .rejects.toThrow(/duplicate-a.*duplicate-b/s);
  });
  it('fails before mutation and reports every colliding Distributor id and mode', async () => {
    await expect(
      replayMigration(
        "INSERT INTO distributors VALUES ('duplicate-a','OLD-A',' Acme   Traders ','OUTRIGHT'), ('duplicate-b','OLD-B','acme traders','OUTRIGHT'), ('other-a','OLD-C','Other','SALE_RETURN'), ('other-b','OLD-D',' other ','SALE_RETURN')",
      ),
    ).rejects.toThrow(/duplicate-a.*duplicate-b.*other-a.*other-b/s);
  });

  it('preserves existing codes, allows names across modes, and seeds independent high-water counters', async () => {
    await replayMigration(
      "INSERT INTO distributors VALUES ('mode-a','DST-000023','Acme Traders','OUTRIGHT'), ('mode-b','DST-000005',' ACME   traders ','SALE_RETURN')",
      async (tx) => {
        const records = await tx.$queryRawUnsafe<Array<{ code: string }>>(
          'SELECT code FROM distributors ORDER BY id',
        );
        expect(records.map((record) => record.code)).toEqual(['DST-000023', 'DST-000005']);
        const counters = await tx.$queryRawUnsafe<
          Array<{ namespace: string; last_allocated_serial: bigint }>
        >('SELECT namespace, last_allocated_serial FROM master_code_counters ORDER BY namespace');
        expect(counters).toEqual([
          { namespace: 'DST', last_allocated_serial: 23n },
          { namespace: 'FAC', last_allocated_serial: 0n },
          { namespace: 'STR', last_allocated_serial: 0n },
        ]);
        await tx.$executeRawUnsafe(
          "INSERT INTO retail_stores VALUES ('store-a','mode-a','LEGACY'), ('store-b','mode-b','LEGACY')",
        );
        expect(
          await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM retail_stores'),
        ).toEqual([{ count: 2 }]);
      },
    );
  });
});
