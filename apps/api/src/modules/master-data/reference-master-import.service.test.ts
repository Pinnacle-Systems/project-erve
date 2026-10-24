import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import { createTestUser, resetDatabase } from '../../test/helpers.js';
import { planMasterImport, executeMasterImport } from './master-import.service.js';
import * as audit from '../../audit/audit.service.js';
import * as XLSX from 'xlsx';

async function actor(role: 'ADMIN' | 'MERCHANDISER' | 'ACCOUNTANT' = 'ADMIN') {
  const id = await createTestUser({
    email: `${createId()}@reference.test`,
    password: 'Disposable-test-password1!',
    roles: [role],
  });
  return toCurrentUser(
    await prisma.user.findUniqueOrThrow({ where: { id }, select: currentUserSelect }),
  );
}
const files = {
  seasons: 'Season Code,Season Name,Barcode Serial,Status\nAW26,Winter,,INACTIVE\n',
  sizes: 'Size Code,Size Label,Size Type,Sort Order,Status\nxxs,Small,ALPHA,0,INACTIVE\n',
  hsns: 'HSN Code,Description,Status\n01234567,Text,INACTIVE\n',
};
describe('reference master import persistence', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });
  it.each(['seasons', 'sizes', 'hsns'] as const)(
    'creates %s with audit/provenance then skips exact inactive records',
    async (kind) => {
      const user = await actor();
      const file = Buffer.from(files[kind]);
      const plan = await planMasterImport(user, kind, file, 'm.csv');
      expect(plan.summary.CREATE).toBe(1);
      const done = await executeMasterImport(
        user,
        kind,
        file,
        'm.csv',
        undefined,
        plan.confirmationToken,
      );
      expect(done.summary.CREATE).toBe(1);
      expect(await prisma.masterImportSource.count()).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { action: { in: ['SEASON_CREATED', 'SIZE_CREATED', 'HSN_CREATED'] } },
        }),
      ).toBe(1);
      expect(
        (await executeMasterImport(user, kind, file, 'm.csv', undefined, plan.confirmationToken))
          .summary.SKIP_EXISTING,
      ).toBe(1);
      if (kind === 'seasons')
        expect(await prisma.season.findFirst()).toMatchObject({
          barcodeSerial: null,
          status: 'INACTIVE',
        });
      if (kind === 'sizes')
        expect(await prisma.size.findFirst()).toMatchObject({ code: 'xxs', sortOrder: 0 });
      if (kind === 'hsns')
        expect(await prisma.hsn.findFirst()).toMatchObject({
          code: '01234567',
          gstRuleSetId: null,
        });
    },
  );
  it('allows ACCOUNTANT only for HSN imports', async () => {
    const user = await actor('ACCOUNTANT');
    expect(
      (await planMasterImport(user, 'hsns', Buffer.from(files.hsns), 'h.csv')).summary.CREATE,
    ).toBe(1);
    for (const kind of ['sizes', 'seasons', 'factories', 'distributors', 'retail-stores'] as const)
      await expect(
        planMasterImport(user, kind, Buffer.from('Name\nX'), 'm.csv'),
      ).rejects.toMatchObject({ statusCode: 403 });
  });
  // ISS-SEASON-FY: Season Code is globally unique, case-insensitive.
  it('rejects a duplicate Season Code within one upload and detects a globally held Barcode Serial across different codes', async () => {
    const user = await actor();
    const file = Buffer.from('Season Code,Season Name,Barcode Serial\nAW,Winter,1\n');
    const plan = await planMasterImport(user, 'seasons', file, 's.csv');
    expect(plan.summary.CREATE).toBe(1);
    expect(
      (await executeMasterImport(user, 'seasons', file, 's.csv', undefined, plan.confirmationToken))
        .summary.CREATE,
    ).toBe(1);

    const duplicateCode = await planMasterImport(
      user,
      'seasons',
      Buffer.from('Season Code,Season Name,Barcode Serial\naw,Winter Again,2\n'),
      's.csv',
    );
    expect(duplicateCode.summary.NEEDS_REVIEW).toBe(1);

    const heldSerial = await planMasterImport(
      user,
      'seasons',
      Buffer.from('Season Code,Season Name,Barcode Serial\nSS,Summer,1\n'),
      's.csv',
    );
    expect(heldSerial.summary.NEEDS_REVIEW).toBe(1);
  });
  it('enforces existing case-insensitive global Season Code uniqueness', async () => {
    await prisma.season.create({
      data: { id: createId(), code: 'AW', name: 'Winter' },
    });
    await expect(
      prisma.season.create({
        data: { id: createId(), code: 'aw', name: 'Another' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.season.count()).toBe(1);
    expect(
      await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname = 'seasons_code_ci_key'`,
    ).toHaveLength(1);
  });
  it.each(['seasons', 'sizes', 'hsns'] as const)(
    'supports selected XLSX, empty files, stale/expired confirmation and conflict review for %s',
    async (kind) => {
      const user = await actor();
      const sheet = XLSX.read(Buffer.from(files[kind]), { type: 'buffer', raw: true }).Sheets
        .Sheet1!;
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Cover']]), 'Cover');
      XLSX.utils.book_append_sheet(book, sheet, 'Data');
      const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      await expect(planMasterImport(user, kind, file, 'm.xlsx')).rejects.toThrow(/worksheet/);
      const plan = await planMasterImport(user, kind, file, 'm.xlsx', 'Data');
      expect(plan.summary.CREATE).toBe(1);
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
      await expect(
        executeMasterImport(user, kind, file, 'm.xlsx', 'Data', plan.confirmationToken),
      ).rejects.toMatchObject({ statusCode: 409 });
      clock.mockRestore();
      await expect(
        executeMasterImport(
          user,
          kind,
          Buffer.from(files[kind] + '\n'),
          'm.csv',
          undefined,
          plan.confirmationToken,
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      await executeMasterImport(user, kind, file, 'm.xlsx', 'Data', plan.confirmationToken);
      const changed = files[kind]
        .replace('Winter', 'Changed')
        .replace('Small', 'Changed')
        .replace('Text', 'Changed');
      expect(
        (await planMasterImport(user, kind, Buffer.from(changed), 'm.csv')).summary.NEEDS_REVIEW,
      ).toBe(1);
      expect(
        (
          await planMasterImport(
            user,
            kind,
            Buffer.from(files[kind].split('\n')[0] + '\n'),
            'm.csv',
          )
        ).rows,
      ).toHaveLength(0);
    },
  );
  it('rejects incomplete HSNs and identifies all duplicate literal codes', async () => {
    const user = await actor();
    const plan = await planMasterImport(
      user,
      'hsns',
      Buffer.from('HSN Code\n01234567\n01234567\n1234567\nabcdefgh\n'),
      'h.csv',
    );
    expect(plan.rows.map((r) => r.outcome)).toEqual([
      'NEEDS_REVIEW',
      'NEEDS_REVIEW',
      'REJECTED',
      'REJECTED',
    ]);
  });
  it('holds duplicate Size identities even when one copy has invalid metadata', async () => {
    const user = await actor();
    const plan = await planMasterImport(
      user,
      'sizes',
      Buffer.from(
        'Size Code,Size Label,Size Type,Sort Order\nS,Small,ALPHA,1\nS,Small,INVALID,2\n',
      ),
      's.csv',
    );
    expect(plan.rows[0]!.outcome).toBe('NEEDS_REVIEW');
    expect(plan.summary.CREATE).toBe(0);
  });
  it('rejects invalid values and duplicate serials and identities', async () => {
    const user = await actor();
    const header = 'Season Code,Season Name,Barcode Serial\n';
    const p = await planMasterImport(
      user,
      'seasons',
      Buffer.from(header + 'AW,Winter,1\nAW,Winter,2\nSS,Summer,1\n,Bad,3\n'),
      's.csv',
    );
    expect(p.rows.map((r) => r.outcome)).toEqual([
      'NEEDS_REVIEW',
      'NEEDS_REVIEW',
      'NEEDS_REVIEW',
      'REJECTED',
    ]);
    expect(
      (
        await planMasterImport(
          user,
          'sizes',
          Buffer.from(
            'Size Code,Size Label,Size Type,Sort Order\nS,Small,OTHER,1\nM,Medium,ALPHA,1.5\nL,Large,ALPHA,\n',
          ),
          's.csv',
        )
      ).summary.REJECTED,
    ).toBe(3);
  });
  it.each(['seasons', 'sizes', 'hsns'] as const)(
    'rolls back %s, audit and provenance on a failed atomic audit',
    async (kind) => {
      const user = await actor();
      const file = Buffer.from(files[kind]);
      const plan = await planMasterImport(user, kind, file, 'm.csv');
      vi.spyOn(audit, 'recordAuditLog').mockRejectedValueOnce(new Error('audit unavailable'));
      expect(
        (await executeMasterImport(user, kind, file, 'm.csv', undefined, plan.confirmationToken))
          .summary.FAILED,
      ).toBe(1);
      expect(await prisma.masterImportSource.count()).toBe(0);
      expect(
        await (kind === 'seasons'
          ? prisma.season.count()
          : kind === 'sizes'
            ? prisma.size.count()
            : prisma.hsn.count()),
      ).toBe(0);
    },
  );
  it.each(['seasons', 'sizes', 'hsns'] as const)(
    'serializes concurrent %s creation without duplicate records',
    async (kind) => {
      const user = await actor();
      const file = Buffer.from(files[kind]);
      const plan = await planMasterImport(user, kind, file, 'm.csv');
      const results = await Promise.all(
        [1, 2].map(() =>
          executeMasterImport(user, kind, file, 'm.csv', undefined, plan.confirmationToken),
        ),
      );
      expect(results.map((r) => r.summary.CREATE).reduce((a, b) => a + b)).toBe(1);
      expect(results.map((r) => r.summary.SKIP_EXISTING).reduce((a, b) => a + b)).toBe(1);
      expect(await prisma.masterImportSource.count()).toBe(1);
    },
  );
  it.each(['seasons', 'sizes', 'hsns'] as const)(
    'keeps committed %s provenance and row outcomes after interrupted finalization',
    async (kind) => {
      const user = await actor();
      const file = Buffer.from(files[kind]);
      const plan = await planMasterImport(user, kind, file, 'm.csv');
      vi.spyOn(prisma.masterImportRun, 'update').mockRejectedValueOnce(
        new Error('interrupted summary write'),
      );
      await expect(
        executeMasterImport(user, kind, file, 'm.csv', undefined, plan.confirmationToken),
      ).rejects.toThrow(/interrupted summary/);
      expect(await prisma.masterImportSource.count()).toBe(1);
      expect(await prisma.masterImportRowResult.count({ where: { outcome: 'CREATE' } })).toBe(1);
      expect(await prisma.masterImportRun.findFirst()).toMatchObject({ status: 'INTERRUPTED' });
      expect(
        (await executeMasterImport(user, kind, file, 'm.csv', undefined, plan.confirmationToken))
          .summary.SKIP_EXISTING,
      ).toBe(1);
      expect(await prisma.masterImportSource.count()).toBe(1);
    },
  );
});
