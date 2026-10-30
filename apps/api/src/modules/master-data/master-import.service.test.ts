import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { createId } from '@erve/shared';
import type { MasterImportKind } from '@erve/types';
import { prisma } from '../../db/prisma.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import { createTestUser, resetDatabase } from '../../test/helpers.js';
import { planMasterImport, executeMasterImport } from './master-import.service.js';
import { buildMasterImportTemplate, masterImportWorksheets } from './master-import.parser.js';
import * as audit from '../../audit/audit.service.js';

const csv = (rows: string) => Buffer.from(rows);
async function actor(role: 'ADMIN' | 'MERCHANDISER' | 'QA_USER' = 'ADMIN') {
  const id = await createTestUser({
    email: `${createId()}@import.test`,
    password: 'Disposable-test-password1!',
    roles: [role],
  });
  return toCurrentUser(
    await prisma.user.findUniqueOrThrow({ where: { id }, select: currentUserSelect }),
  );
}
describe('shared business master imports', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });
  it('requires another preview when a skipped existing master would now be created', async () => {
    const user = await actor();
    const existing = await prisma.factory.create({
      data: { id: createId(), code: 'LEGACY', name: 'Factory One' },
    });
    const file = csv('Name\nFactory One\n');
    const plan = await planMasterImport(user, 'factories', file, 'f.csv');
    expect(plan.rows[0]!.outcome).toBe('SKIP_EXISTING');
    await prisma.factory.update({ where: { id: existing.id }, data: { name: 'Renamed Factory' } });
    await expect(
      executeMasterImport(user, 'factories', file, 'f.csv', undefined, plan.confirmationToken),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.factory.count()).toBe(1);
    expect(await prisma.masterImportRun.count()).toBe(0);
    expect(await prisma.masterCodeCounter.count()).toBe(0);
  });
  it('binds a supplied source key when accepting an exact existing master', async () => {
    const user = await actor();
    const existing = await prisma.factory.create({
      data: { id: createId(), code: 'LEGACY', name: 'Factory One' },
    });
    const file = csv('Name,Source Key\nFactory One,source-one\n');
    const plan = await planMasterImport(user, 'factories', file, 'f.csv');
    const result = await executeMasterImport(
      user,
      'factories',
      file,
      'f.csv',
      undefined,
      plan.confirmationToken,
    );
    expect(result.rows[0]!.outcome).toBe('SKIP_EXISTING');
    expect(
      await prisma.masterImportSource.findUnique({
        where: { kind_sourceKey: { kind: 'factories', sourceKey: 'source-one' } },
      }),
    ).toMatchObject({ masterId: existing.id });
    const changed = await planMasterImport(
      user,
      'factories',
      csv('Name,Source Key\nFactory Two,source-one\n'),
      'f.csv',
    );
    expect(changed.rows[0]!.outcome).toBe('NEEDS_REVIEW');
    expect(await prisma.masterCodeCounter.count()).toBe(0);
  });
  it('previews without writes and partially imports independent rows with provenance and server codes', async () => {
    const user = await actor();
    const file = csv(
      'Name,Email,Source Key\nFactory One,one@example.test,factory-one\nFactory Bad,invalid,bad\nFactory Two,two@example.test,factory-two\n',
    );
    const plan = await planMasterImport(user, 'factories', file, 'factories.csv');
    expect(plan.rows.map((r) => r.outcome)).toEqual(['CREATE', 'REJECTED', 'CREATE']);
    expect(await prisma.factory.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.masterImportRun.count()).toBe(0);
    expect(await prisma.masterCodeCounter.count()).toBe(0);
    const result = await executeMasterImport(
      user,
      'factories',
      file,
      'factories.csv',
      undefined,
      plan.confirmationToken,
    );
    expect(result.rows.map((r) => r.outcome)).toEqual(['CREATE', 'REJECTED', 'CREATE']);
    expect(
      (await prisma.factory.findMany({ orderBy: { code: 'asc' } })).map((r) => r.code),
    ).toEqual(['FAC-000001', 'FAC-000002']);
    expect(await prisma.masterImportSource.count()).toBe(2);
    expect(await prisma.masterImportRowResult.count()).toBe(3);
  });
  it('reruns the identical confirmation without duplicate masters, provenance or codes', async () => {
    const user = await actor();
    const file = csv('Name,Source Key\nFactory One,one\n');
    const plan = await planMasterImport(user, 'factories', file, 'f.csv');
    await executeMasterImport(user, 'factories', file, 'f.csv', undefined, plan.confirmationToken);
    const rerun = await executeMasterImport(
      user,
      'factories',
      file,
      'renamed.csv',
      undefined,
      plan.confirmationToken,
    );
    expect(rerun.rows[0]!.outcome).toBe('SKIP_EXISTING');
    expect(await prisma.factory.count()).toBe(1);
    expect(await prisma.masterImportSource.count()).toBe(1);
    expect(
      (await prisma.masterCodeCounter.findUniqueOrThrow({ where: { namespace: 'FAC' } }))
        .lastAllocatedSerial,
    ).toBe(1n);
  });
  it('does not trust source keys to overwrite existing masters or hide conflicting input', async () => {
    const user = await actor();
    const original = csv('Name,City,Source Key\nFactory One,Chennai,one\n');
    const plan = await planMasterImport(user, 'factories', original, 'f.csv');
    await executeMasterImport(
      user,
      'factories',
      original,
      'f.csv',
      undefined,
      plan.confirmationToken,
    );
    const changed = await planMasterImport(
      user,
      'factories',
      csv('Name,City,Source Key\nFactory One,Mumbai,one\nFactory Two,Chennai,one\n'),
      'f.csv',
    );
    expect(changed.rows.map((r) => r.outcome)).toEqual(['NEEDS_REVIEW', 'NEEDS_REVIEW']);
    expect((await prisma.factory.findFirstOrThrow()).city).toBe('Chennai');
  });
  it('holds missing modes, then imports a reviewed correction without assigning a commercial mode silently', async () => {
    const user = await actor();
    const raw = csv('Name,GSTIN,Purchase Mode,Source Key\nDistributor One,22AAAAA0000A1Z5,,one\n');
    const held = await planMasterImport(user, 'distributors', raw, 'd.csv');
    expect(held.rows[0]!.outcome).toBe('NEEDS_REVIEW');
    await executeMasterImport(
      user,
      'distributors',
      raw,
      'd.csv',
      undefined,
      held.confirmationToken,
    );
    expect(await prisma.distributor.count()).toBe(0);
    const corrected = csv(
      'Name,GSTIN,Purchase Mode,Source Key\nDistributor One,22AAAAA0000A1Z5,SALE_RETURN,one\n',
    );
    const reviewed = await planMasterImport(user, 'distributors', corrected, 'd.csv');
    expect(
      (
        await executeMasterImport(
          user,
          'distributors',
          corrected,
          'd.csv',
          undefined,
          reviewed.confirmationToken,
        )
      ).rows[0]!.outcome,
    ).toBe('CREATE');
    expect((await prisma.distributor.findFirstOrThrow()).purchaseMode).toBe('SALE_RETURN');
  });
  it('keeps same-name stores at different addresses separate and resolves parents by mode', async () => {
    const user = await actor();
    const d = await prisma.distributor.create({
      data: {
        id: createId(),
        code: 'LEGACY',
        name: 'Parent',
        gstin: '22AAAAA0000A1Z5',
        purchaseMode: 'OUTRIGHT',
      },
    });
    const file = csv(
      'Distributor Name,Distributor Purchase Mode,Name,Address Line 1,City,State,Postal Code\nParent,OUTRIGHT,Store,1 Road,Chennai,TN,600001\nParent,OUTRIGHT,Store,2 Road,Chennai,TN,600001\n',
    );
    const plan = await planMasterImport(user, 'retail-stores', file, 's.csv');
    const result = await executeMasterImport(
      user,
      'retail-stores',
      file,
      's.csv',
      undefined,
      plan.confirmationToken,
    );
    expect(result.summary.CREATE).toBe(2);
    expect(await prisma.retailStore.count({ where: { distributorId: d.id } })).toBe(2);
  });
  it('serializes concurrent confirmations into one master and an exact skip', async () => {
    const user = await actor();
    const file = csv('Name,Source Key\nFactory One,one\n');
    const plan = await planMasterImport(user, 'factories', file, 'f.csv');
    const results = await Promise.all([
      executeMasterImport(user, 'factories', file, 'f.csv', undefined, plan.confirmationToken),
      executeMasterImport(user, 'factories', file, 'f.csv', undefined, plan.confirmationToken),
    ]);
    expect(results.map((r) => r.rows[0]!.outcome).sort()).toEqual(['CREATE', 'SKIP_EXISTING']);
    expect(await prisma.factory.count()).toBe(1);
    expect(await prisma.masterImportSource.count()).toBe(1);
  });
  it('rolls back a logical record on audit failure and safely retries it', async () => {
    const user = await actor();
    const file = csv('Name\nFactory One\n');
    const plan = await planMasterImport(user, 'factories', file, 'f.csv');
    vi.spyOn(audit, 'recordAuditLog').mockRejectedValueOnce(new Error('injected failure'));
    expect(
      (
        await executeMasterImport(
          user,
          'factories',
          file,
          'f.csv',
          undefined,
          plan.confirmationToken,
        )
      ).rows[0]!.outcome,
    ).toBe('FAILED');
    expect(await prisma.factory.count()).toBe(0);
    expect(await prisma.masterImportSource.count()).toBe(0);
    expect(await prisma.masterCodeCounter.count()).toBe(0);
    vi.restoreAllMocks();
    expect(
      (
        await executeMasterImport(
          user,
          'factories',
          file,
          'f.csv',
          undefined,
          plan.confirmationToken,
        )
      ).summary.CREATE,
    ).toBe(1);
  });
  it('binds confirmation to actor and file, and revalidates active authorization', async () => {
    const user = await actor();
    const other = await actor();
    const file = csv('Name\nFactory One\n');
    const plan = await planMasterImport(user, 'factories', file, 'f.csv');
    await expect(
      executeMasterImport(other, 'factories', file, 'f.csv', undefined, plan.confirmationToken),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      executeMasterImport(
        user,
        'factories',
        csv('Name\nFactory Two\n'),
        'f.csv',
        undefined,
        plan.confirmationToken,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    await expect(
      executeMasterImport(user, 'factories', file, 'f.csv', undefined, plan.confirmationToken),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      planMasterImport(await actor('QA_USER'), 'factories', file, 'f.csv'),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.masterImportRun.count()).toBe(0);
  });
});

// ISS-071 regression: the generated downloadable template's own Instructions
// worksheet documents an "Example Value" per field — this exercises the
// ACTUAL generated template (not a hand-built fixture) end to end, through
// the real plan/execute pipeline, using exactly those documented examples,
// so a stale or invalid example would be caught here.
async function exampleRowFromTemplate(kind: MasterImportKind) {
  const buffer = await buildMasterImportTemplate(kind);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const worksheet = masterImportWorksheets[kind];
  const header = (XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[worksheet]!, { header: 1 })[0] ?? []).map(String);
  const instructionRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Instructions!, { header: 1 });
  const tableHeaderRow = instructionRows.findIndex((row) => row[0] === 'Field Name');
  const examples = new Map(
    instructionRows
      .slice(tableHeaderRow + 1)
      .filter((row) => row[2] === 'Required' || row[2] === 'Optional')
      .map((row) => [String(row[0]), String(row[4] ?? '')]),
  );
  const values = header.map((name) => examples.get(name) ?? '');
  XLSX.utils.sheet_add_aoa(workbook.Sheets[worksheet]!, [values], { origin: 'A2' });
  const filled = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { filled, header, values, worksheet };
}

describe('generated-template round trip against documented examples (ISS-071 regression)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each(['seasons', 'sizes', 'factories', 'distributors'] as const)(
    'creates a %s record straight from the generated template’s own documented example',
    async (kind) => {
      const user = await actor();
      const { filled, header, values, worksheet } = await exampleRowFromTemplate(kind);
      const plan = await planMasterImport(user, kind, filled, `${kind}.xlsx`, worksheet);
      expect(plan.rows).toHaveLength(1);
      expect(plan.rows[0]!.outcome).toBe('CREATE');
      const result = await executeMasterImport(user, kind, filled, `${kind}.xlsx`, worksheet, plan.confirmationToken);
      expect(result.rows[0]!.outcome).toBe('CREATE');
      expect(result.rows[0]!.code).toBeTruthy();
      const nameField = header.includes('Name') ? 'Name' : header.find((h) => h.includes('Code'))!;
      expect(values[header.indexOf(nameField)]).toBeTruthy();
    },
  );

  it('resolves the documented GST Rule Set Code example and assigns it to the created HSN', async () => {
    const user = await actor();
    await prisma.gstRuleSet.create({ data: { id: createId(), code: 'GST-12-STD', name: 'Standard rule set' } });
    const { filled, header, values, worksheet } = await exampleRowFromTemplate('hsns');
    const plan = await planMasterImport(user, 'hsns', filled, 'hsns.xlsx', worksheet);
    expect(plan.rows[0]!.outcome).toBe('CREATE');
    const result = await executeMasterImport(user, 'hsns', filled, 'hsns.xlsx', worksheet, plan.confirmationToken);
    expect(result.rows[0]!.outcome).toBe('CREATE');
    const hsnCode = values[header.indexOf('HSN Code')]!;
    const created = await prisma.hsn.findUniqueOrThrow({ where: { code: hsnCode } });
    expect(created.gstRuleSetId).not.toBeNull();
    const ruleSet = await prisma.gstRuleSet.findUniqueOrThrow({ where: { id: created.gstRuleSetId! } });
    expect(ruleSet.code).toBe('GST-12-STD');
  });

  it('resolves the documented parent Distributor example for the generated Retail Store template', async () => {
    const user = await actor();
    // Pre-create the Distributor exactly as the Distributor template's own
    // documented example describes it, so the Retail Store template's
    // "Distributor Name / GSTIN / Purchase Mode" example resolves to it.
    const distributorExample = await exampleRowFromTemplate('distributors');
    const distributorPlan = await planMasterImport(
      user,
      'distributors',
      distributorExample.filled,
      'distributors.xlsx',
      distributorExample.worksheet,
    );
    await executeMasterImport(
      user,
      'distributors',
      distributorExample.filled,
      'distributors.xlsx',
      distributorExample.worksheet,
      distributorPlan.confirmationToken,
    );

    const { filled, worksheet } = await exampleRowFromTemplate('retail-stores');
    const plan = await planMasterImport(user, 'retail-stores', filled, 'stores.xlsx', worksheet);
    expect(plan.rows[0]!.outcome).toBe('CREATE');
    const result = await executeMasterImport(user, 'retail-stores', filled, 'stores.xlsx', worksheet, plan.confirmationToken);
    expect(result.rows[0]!.outcome).toBe('CREATE');
    const created = await prisma.retailStore.findUniqueOrThrow({ where: { id: result.rows[0]!.masterId! } });
    const parent = await prisma.distributor.findUniqueOrThrow({ where: { id: created.distributorId } });
    expect(parent.name).toBe('Example Distributors Pvt Ltd');
  });

  it('never treats the Instructions worksheet as a selectable or importable data source for any template', async () => {
    for (const kind of Object.keys(masterImportWorksheets) as MasterImportKind[]) {
      const buffer = await buildMasterImportTemplate(kind);
      await expect(
        planMasterImport(await actor(), kind, buffer, `${kind}.xlsx`, 'Instructions'),
      ).rejects.toThrow(/instruction/i);
    }
  });
});
