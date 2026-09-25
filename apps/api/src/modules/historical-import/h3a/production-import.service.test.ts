// H3A coverage: forward-only plan/execute/verify of a sealed bundle, with a
// SYNTHETIC two-record bundle and target profile (no real source data),
// against the disposable test database.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../../db/prisma.js';
import { createTestFinancialYear, createTestUserAndToken, resetDatabase } from '../../../test/helpers.js';
import { computeStageStructureFingerprint } from '../process-flow-pin.js';
import { H3A_BUNDLE_FORMAT, H3A_MIGRATION_VERSION, type BundleFileRef, type H3aBundle, type LoadedBundle } from './bundle.js';
import type { TargetProfile } from './target-profiles.js';
import {
  compareSnapshots,
  executeH3aImport,
  H3aImportError,
  planH3aImport,
  runReadOnly,
  verifyH3aImport,
  type DatabaseSnapshot,
} from './production-import.service.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function fixture() {
  const adminEmail = `admin-${createId().toLowerCase()}@test.local`;
  await createTestUserAndToken({ email: adminEmail, password: 'pass', roles: ['ADMIN'] });
  const fy = await createTestFinancialYear();
  const sizeA = await prisma.size.create({ data: { id: createId(), code: `T3-${createId()}`, label: '3', sizeType: 'AGE', sortOrder: 3 } });
  const sizeB = await prisma.size.create({ data: { id: createId(), code: `T4-${createId()}`, label: '4', sizeType: 'AGE', sortOrder: 4 } });
  const flowCode = `SYN-FLOW-${createId()}`;
  await prisma.processFlow.create({ data: { id: createId(), code: flowCode, name: 'Synthetic flow', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } } });

  const dir = await mkdtemp(join(tmpdir(), 'h3a-bundle-'));
  dirs.push(dir);
  const put = async (path: string, buffer: Buffer): Promise<BundleFileRef> => {
    await mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(dir, ...path.split('/')), buffer);
    return { path, sha256: sha(buffer), sizeBytes: buffer.length };
  };
  const seasonCode = `S${createId().slice(-6)}`;
  const styles: H3aBundle['styles'] = [];
  const jobOrders: H3aBundle['jobOrders'] = [];
  for (let i = 0; i < 2; i++) {
    const ref = `EIT${i}`;
    const lmix = `LMIX9900${i}`;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR', 'latin1'), Buffer.alloc(17, i + 1)]);
    const pdf = Buffer.from(`%PDF-1.4\n% synthetic ${ref}\n%%EOF\n`, 'latin1');
    styles.push({
      season: seasonCode, lmix, legacyReferenceNumbers: [ref], styleNumber: `${seasonCode}-9900${i}`, styleName: `Synthetic ${i}`, description: `Desc ${i}`,
      colour: 'NAVY', categoryDescription: 'Girls Tee', categoryRaw: 'Girls Tee', categoryNormalizationApplied: false, hsnCode: '61091000', hsnDescription: i === 0 ? 'Girls T-Shirt' : null,
      hsnDescriptionClassification: i === 0 ? 'HSN_WITH_SOURCE_DESCRIPTION' : 'HSN_CODE_ONLY', hsnCodeSourceSuspect: false, ipName: 'IP', licensor: 'LIC',
      finalMrp: '999.00', factory: 'Syn Factory', exFactoryPrice: '336.00', sourceSizeCodes: ['3', '4'],
      image: { ...(await put(`images/${seasonCode}/${ref}.png`, png)), fileName: `${ref}.png` }, sourceChecksumSha256: sha(pdf),
    });
    jobOrders.push({
      legacyReferenceNumber: ref, season: seasonCode, lmix, factory: 'Syn Factory', sourceFactoryName: 'SYN FACTORY PVT LTD', historicalBusinessDate: '2025-08-15',
      requiredDeliveryDate: '2025-09-30', unitPrice: '336', sizes: [{ sourceSizeCode: '3', quantity: 100 + i }, { sourceSizeCode: '4', quantity: 200 + i }],
      disclaimerText: 'Synthetic disclaimer', styleDescription: `Desc ${i}`, styleName: `Synthetic ${i}`, sourceSnapshot: { synthetic: true, ref }, migrationNotes: `H3A synthetic ${ref}`,
      sourcePdf: { ...(await put(`pdf/${sha(pdf)}.pdf`, pdf)), fileName: `PO Sheet - ${ref}.pdf` },
    });
  }
  const bundle: H3aBundle = {
    format: H3A_BUNDLE_FORMAT, migrationVersion: H3A_MIGRATION_VERSION, batchLabel: `SYN-${createId()}`, builtAt: new Date().toISOString(), builtFromCommit: null,
    provenance: {
      description: 'synthetic', sourceArchives: ['synthetic'], sourceManifestAggregateSha256: 'a'.repeat(64), parserVersion: '1.0.0', sourceOverridesSha256: 'b'.repeat(64),
      approvedProcessFlow: { processFlowCode: flowCode, versionNumber: 1, fingerprint: 'f'.repeat(64), stageStructureFingerprint: computeStageStructureFingerprint([]), stages: [] },
    },
    seasons: [{ code: seasonCode, name: 'Synthetic Season', financialYearCode: fy.code }],
    styles,
    jobOrders,
  };
  const loaded: LoadedBundle = { bundle, bundleDir: dir, bundleSha256: 'c'.repeat(64), checks: [] };
  const profile: TargetProfile = {
    name: 'production',
    decision: 'test',
    factories: { 'Syn Factory': { code: `SYNF-${createId()}`, name: `Syn Factory ${createId()}`, createIfMissing: true } },
    sizeCodeBySource: { '3': sizeA.code, '4': sizeB.code },
    processFlow: { processFlowCode: flowCode, versionNumber: 1, acceptedStageDeviations: [] },
  };
  return { loaded, profile, adminEmail };
}

describe('H3A historical import', () => {
  it('plans MISSING_CREATE inside a READ ONLY transaction without writing anything', async () => {
    const f = await fixture();
    const auditBefore = await prisma.auditLog.count();
    const plan = await runReadOnly((tx) => planH3aImport(tx, f.loaded, f.profile, { adminEmail: f.adminEmail }));
    expect(plan.gateOk).toBe(true);
    expect(plan.counts.factories).toEqual({ MISSING_CREATE: 1 });
    expect(plan.counts.seasons).toEqual({ MISSING_CREATE: 1 });
    expect(plan.counts.styles).toEqual({ MISSING_CREATE: 2 });
    expect(plan.counts.jobOrders).toEqual({ MISSING_CREATE: 2 });
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(await prisma.style.count({ where: { lmixNumber: { startsWith: 'LMIX9900' } } })).toBe(0);
  });

  it('refuses writes inside runReadOnly at the database level', async () => {
    await expect(runReadOnly((tx) => tx.factory.create({ data: { id: createId(), code: `RO-${createId()}`, name: `RO ${createId()}` } }))).rejects.toThrow();
  });

  it('imports once, verifies EXACT, and an identical re-run is a zero-write NO_CHANGE', async () => {
    const f = await fixture();
    const first = await executeH3aImport(f.loaded, f.profile, { adminEmail: f.adminEmail, applicationCommit: 'test' });
    expect(first.outcome).toBe('IMPORTED');
    expect(first.created).toMatchObject({ styles: 2, styleSizes: 4, styleFactoryMappings: 2 });
    expect(first.after.noOp).toBe(true);

    const jobOrders = await prisma.jobOrder.findMany({ where: { legacyReferenceNumber: { in: ['EIT0', 'EIT1'] } } });
    expect(jobOrders.map((j) => [j.recordOrigin, j.status])).toEqual([['HISTORICAL_IMPORT', 'PRODUCTION_COMPLETE'], ['HISTORICAL_IMPORT', 'PRODUCTION_COMPLETE']]);
    const verification = await runReadOnly((tx) => verifyH3aImport(tx, f.loaded, f.profile, { adminEmail: f.adminEmail }));
    expect(verification.records.every((r) => r.result === 'EXACT_MATCH')).toBe(true);
    expect(Object.values(verification.batch.falseHistory).every((n) => n === 0)).toBe(true);

    const auditBefore = await prisma.auditLog.count();
    const stylesBefore = await prisma.style.findMany({ where: { lmixNumber: { startsWith: 'LMIX9900' } }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } });
    const sequencesBefore = await prisma.documentSequence.findMany({ orderBy: { id: 'asc' } });
    const second = await executeH3aImport(f.loaded, f.profile, { adminEmail: f.adminEmail, applicationCommit: 'test' });
    expect(second.outcome).toBe('NO_CHANGE');
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(await prisma.style.findMany({ where: { lmixNumber: { startsWith: 'LMIX9900' } }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })).toEqual(stylesBefore);
    expect(await prisma.documentSequence.findMany({ orderBy: { id: 'asc' } })).toEqual(sequencesBefore);
    expect(await prisma.jobOrder.count({ where: { legacyReferenceNumber: { in: ['EIT0', 'EIT1'] } } })).toBe(2);
  });

  it('backfills a null approved field on an existing Style and STOPS on a conflicting populated one', async () => {
    const f = await fixture();
    await executeH3aImport(f.loaded, f.profile, { adminEmail: f.adminEmail, applicationCommit: 'test' });
    const style = await prisma.style.findFirstOrThrow({ where: { lmixNumber: 'LMIX99000' } });

    await prisma.style.update({ where: { id: style.id }, data: { categoryDescription: null } });
    const backfilled = await executeH3aImport(f.loaded, f.profile, { adminEmail: f.adminEmail, applicationCommit: 'test' });
    expect(backfilled.created.styleBackfills).toBe(1);
    expect((await prisma.style.findUniqueOrThrow({ where: { id: style.id } })).categoryDescription).toBe('Girls Tee');

    await prisma.style.update({ where: { id: style.id }, data: { hsnDescription: 'Something else' } });
    const auditBefore = await prisma.auditLog.count();
    await expect(executeH3aImport(f.loaded, f.profile, { adminEmail: f.adminEmail, applicationCommit: 'test' })).rejects.toBeInstanceOf(H3aImportError);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect((await prisma.style.findUniqueOrThrow({ where: { id: style.id } })).hsnDescription).toBe('Something else');
  });

  it('never creates a factory the profile does not approve for creation', async () => {
    const f = await fixture();
    f.profile.factories['Syn Factory']!.createIfMissing = false;
    const plan = await runReadOnly((tx) => planH3aImport(tx, f.loaded, f.profile, { adminEmail: f.adminEmail }));
    expect(plan.gateOk).toBe(false);
    await expect(executeH3aImport(f.loaded, f.profile, { adminEmail: f.adminEmail, applicationCommit: 'test' })).rejects.toBeInstanceOf(H3aImportError);
    expect(await prisma.factory.count({ where: { code: f.profile.factories['Syn Factory']!.code } })).toBe(0);
  });
});

describe('compareSnapshots', () => {
  const snap = (tables: DatabaseSnapshot['tables'], rows: DatabaseSnapshot['rows'], seq: number): DatabaseSnapshot => ({
    capturedAt: '', database: 'db', tables, rows, sequences: [], allSequences: [{ documentType: 'JOB_ORDER', financialYear: '2026-27', lastAllocatedSerial: seq }],
  });

  it('accepts pure inserts into expected tables', () => {
    const before = snap({ styles: { rows: 1, contentHash: 'x' }, users: { rows: 1, contentHash: 'u' } }, { styles: { a: '1' } }, 1);
    const after = snap({ styles: { rows: 2, contentHash: 'y' }, users: { rows: 1, contentHash: 'u' } }, { styles: { a: '1', b: '2' } }, 1);
    expect(compareSnapshots(before, after, () => false)).toMatchObject({ ok: true, insertOnlyTables: { styles: { added: 1 } } });
  });

  it('flags modified or deleted pre-existing rows, unexpected table changes and sequence movement', () => {
    const before = snap({ styles: { rows: 2, contentHash: 'x' }, sale_orders: { rows: 0, contentHash: 's' } }, { styles: { a: '1', b: '2' } }, 1);
    const after = snap({ styles: { rows: 1, contentHash: 'y' }, sale_orders: { rows: 1, contentHash: 't' } }, { styles: { a: 'changed' } }, 0);
    const result = compareSnapshots(before, after, () => false);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        'styles row a was modified',
        'styles row b was deleted',
        expect.stringContaining('sale_orders changed'),
        expect.stringContaining('rewound'),
      ]),
    );
  });
});
