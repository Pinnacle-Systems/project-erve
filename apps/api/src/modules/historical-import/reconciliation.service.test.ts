import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import { sourceField, unknownField, type ParsedPurchaseOrderRecord } from './po-pdf-parser.types.js';
import type { ExtractedImageCandidate } from './style-image-extractor.js';
import {
  detectDuplicateLegacyReferences,
  reconcileBatch,
  reconcileFactory,
  reconcileImage,
  reconcileSeason,
  reconcileSizes,
  reconcileStyle,
} from './reconciliation.service.js';
import { createTestFactory, createTestFinancialYear, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function baseParsedRecord(overrides?: Partial<ParsedPurchaseOrderRecord>): ParsedPurchaseOrderRecord {
  return {
    sourceFileName: 'EI25001.pdf',
    sourceRelativePath: 'EI25001.pdf',
    sourceChecksumSha256: 'x'.repeat(64),
    sourceSizeBytes: 1000,
    sourceSeasonFolder: 'AW25',
    parseStatus: 'OK',
    warnings: [],
    legacyReferenceNumber: sourceField('EI25001'),
    documentSeason: sourceField('AW25'),
    seasonFolderMismatch: false,
    factoryName: sourceField('Clifton export Pvt Ltd'),
    licenseStyleLmix: sourceField('LMIX29524002'),
    styleName: sourceField('Girls Hoody'),
    colour: sourceField('Pink'),
    description: sourceField('Girls Long Sleeve Hoody'),
    hsnCode: sourceField('61061000'),
    orderDate: sourceField('2025-08-15'),
    shipmentDate: sourceField('2025-09-30'),
    unitRate: sourceField('336'),
    currency: sourceField('INR'),
    paymentTerms: sourceField('30 days'),
    approvalSampleInstructions: unknownField(),
    aqlInspectionTerms: unknownField(),
    sizeQuantities: [{ sizeCode: '3', quantity: 168 }],
    tableTotalQuantity: sourceField(168),
    headerTotalQuantity: sourceField(168),
    quantitySumMatchesTotal: true,
    ...overrides,
  };
}

const OK_IMAGE: ExtractedImageCandidate = {
  method: 'EMBEDDED_IMAGE',
  pageNumber: 1,
  imageBytes: Buffer.from('fake-png'),
  widthPx: 500,
  heightPx: 480,
  sha256: 'a'.repeat(64),
  notes: [],
};

async function seedMasterData() {
  const financialYear = await createTestFinancialYear();
  const season = await prisma.season.create({ data: { id: createId(), code: 'AW25', name: 'Autumn Winter 25', financialYearId: financialYear.id } });
  const factory = await createTestFactory({ code: 'CLIFTON', name: 'Clifton export Pvt Ltd' });
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: `ST-${createId()}`, styleName: 'Girls Hoody', lmixNumber: 'LMIX29524002', finalMrp: 500, seasonId: season.id },
  });
  const size = await prisma.size.create({ data: { id: createId(), code: '3', label: '3', sizeType: 'AGE', sortOrder: 3 } });
  await prisma.styleSize.create({ data: { id: createId(), styleId: style.id, sizeId: size.id } });
  return { season, factory, style, size };
}

describe('reconcileSeason', () => {
  it('matches by exact code, never auto-creates', async () => {
    const season = await prisma.season.create({ data: { id: createId(), code: 'AW25', name: 'AW25', financialYearId: (await createTestFinancialYear()).id } });
    await expect(reconcileSeason(prisma, 'AW25')).resolves.toMatchObject({ status: 'MATCHED', seasonId: season.id });
    await expect(reconcileSeason(prisma, 'SS26')).resolves.toMatchObject({ status: 'UNMATCHED', seasonId: null });
  });
});

describe('reconcileFactory', () => {
  it('matches only on exact normalized name — never fuzzy', async () => {
    await createTestFactory({ code: 'CLIFTON', name: 'Clifton export Pvt Ltd' });
    await expect(reconcileFactory(prisma, 'Clifton export Pvt Ltd')).resolves.toMatchObject({ status: 'MATCHED' });
    await expect(reconcileFactory(prisma, '  clifton EXPORT pvt ltd  ')).resolves.toMatchObject({ status: 'MATCHED' });
    // A real-world near-miss (seed data often abbreviates) must NOT match.
    await expect(reconcileFactory(prisma, 'Clifton')).resolves.toMatchObject({ status: 'UNMATCHED' });
  });

  it('resolves an APPROVED explicit factory mapping when the exact name does not match (H2A §11)', async () => {
    const factory = await createTestFactory({ code: 'CLIFTON', name: 'Clifton' });
    const mappings = [{ sourceFactoryName: 'Clifton export Pvt Ltd', targetFactoryName: 'Clifton', status: 'APPROVED' as const }];
    await expect(reconcileFactory(prisma, 'Clifton export Pvt Ltd', mappings)).resolves.toMatchObject({ status: 'MATCHED', factoryId: factory.id });
  });

  it('does not resolve via a mapping row that is not APPROVED', async () => {
    await createTestFactory({ code: 'CLIFTON', name: 'Clifton' });
    const mappings = [{ sourceFactoryName: 'Clifton export Pvt Ltd', targetFactoryName: 'Clifton', status: 'REVIEW_REQUIRED' as const }];
    await expect(reconcileFactory(prisma, 'Clifton export Pvt Ltd', mappings)).resolves.toMatchObject({ status: 'UNMATCHED' });
  });

  it('leaves an unknown source name with no mapping row UNMATCHED, never guessed', async () => {
    await createTestFactory({ code: 'CLIFTON', name: 'Clifton' });
    const mappings = [{ sourceFactoryName: 'Clifton export Pvt Ltd', targetFactoryName: 'Clifton', status: 'APPROVED' as const }];
    await expect(reconcileFactory(prisma, 'Some Totally Different Supplier', mappings)).resolves.toMatchObject({ status: 'UNMATCHED' });
  });

  it('an approved mapping still never does a fuzzy/partial match on the source side', async () => {
    await createTestFactory({ code: 'CLIFTON', name: 'Clifton' });
    const mappings = [{ sourceFactoryName: 'Clifton export Pvt Ltd', targetFactoryName: 'Clifton', status: 'APPROVED' as const }];
    // A near-miss of the MAPPING's source string (not the target) must not resolve either.
    await expect(reconcileFactory(prisma, 'Clifton export Pvt', mappings)).resolves.toMatchObject({ status: 'UNMATCHED' });
  });
});

describe('reconcileStyle', () => {
  it('requires both a resolved Season and a matching LMIX — never matches on LMIX alone', async () => {
    const { season, style } = await seedMasterData();
    await expect(reconcileStyle(prisma, { lmix: 'LMIX29524002', seasonId: season.id })).resolves.toMatchObject({ status: 'MATCHED', styleId: style.id });
    await expect(reconcileStyle(prisma, { lmix: 'LMIX29524002', seasonId: null })).resolves.toMatchObject({ status: 'UNMATCHED', styleId: null });
    await expect(reconcileStyle(prisma, { lmix: null, seasonId: season.id })).resolves.toMatchObject({ status: 'UNMATCHED', styleId: null });
  });
});

describe('reconcileSizes', () => {
  it('requires the Size to exist AND be a valid StyleSize for the resolved Style', async () => {
    const { style, size } = await seedMasterData();
    const matched = await reconcileSizes(prisma, style.id, [{ sizeCode: size.code, quantity: 168 }]);
    expect(matched[0]).toMatchObject({ status: 'MATCHED', sizeId: size.id });

    const unknownSize = await reconcileSizes(prisma, style.id, [{ sizeCode: 'NOPE', quantity: 10 }]);
    expect(unknownSize[0]).toMatchObject({ status: 'UNMATCHED' });

    const otherSize = await prisma.size.create({ data: { id: createId(), code: 'OTHER', label: 'Other', sizeType: 'AGE', sortOrder: 9 } });
    const notStyleSize = await reconcileSizes(prisma, style.id, [{ sizeCode: otherSize.code, quantity: 10 }]);
    expect(notStyleSize[0]).toMatchObject({ status: 'UNMATCHED', reason: expect.stringContaining('not a valid StyleSize') });
  });
});

describe('reconcileImage', () => {
  it('classifies UPLOAD when the Style has no existing image', async () => {
    const { style } = await seedMasterData();
    await expect(reconcileImage(prisma, OK_IMAGE, style.id)).resolves.toMatchObject({ disposition: 'UPLOAD' });
  });

  it('classifies SKIP_ALREADY_PRESENT only on an exact hash match', async () => {
    const { style } = await seedMasterData();
    const file = await prisma.file.create({ data: { id: createId(), fileName: 'x.png', mimeType: 'image/png', sizeBytes: 10, storageKey: `k-${createId()}`, checksumSha256: OK_IMAGE.sha256 } });
    await prisma.styleImage.create({ data: { id: createId(), styleId: style.id, fileId: file.id } });
    await expect(reconcileImage(prisma, OK_IMAGE, style.id)).resolves.toMatchObject({ disposition: 'SKIP_ALREADY_PRESENT', existingFileId: file.id });
  });

  it('classifies REVIEW_CONFLICT (never auto-replaces) on any hash mismatch — a re-encoded image is not treated as confidently different', async () => {
    const { style } = await seedMasterData();
    const file = await prisma.file.create({ data: { id: createId(), fileName: 'x.png', mimeType: 'image/png', sizeBytes: 10, storageKey: `k-${createId()}`, checksumSha256: 'b'.repeat(64) } });
    await prisma.styleImage.create({ data: { id: createId(), styleId: style.id, fileId: file.id } });
    await expect(reconcileImage(prisma, OK_IMAGE, style.id)).resolves.toMatchObject({ disposition: 'REVIEW_CONFLICT' });
  });

  it('classifies MANUAL_REVIEW when the Style is unresolved or the candidate itself is MANUAL_REVIEW', async () => {
    await expect(reconcileImage(prisma, OK_IMAGE, null)).resolves.toMatchObject({ disposition: 'MANUAL_REVIEW' });
    const { style } = await seedMasterData();
    const noImage: ExtractedImageCandidate = { ...OK_IMAGE, method: 'MANUAL_REVIEW', imageBytes: null, sha256: null };
    await expect(reconcileImage(prisma, noImage, style.id)).resolves.toMatchObject({ disposition: 'MANUAL_REVIEW' });
  });
});

describe('detectDuplicateLegacyReferences', () => {
  it('flags within-batch repeats as REPEATED_LEGACY_REFERENCE, not DUPLICATE', async () => {
    const results = await detectDuplicateLegacyReferences(prisma, ['EI25001', 'EI25002', 'EI25001']);
    expect(results[0]).toMatchObject({ duplicate: true });
    expect(results[0]!.reason).toContain('REPEATED_LEGACY_REFERENCE');
    expect(results[1]).toMatchObject({ duplicate: false });
    expect(results[2]).toMatchObject({ duplicate: true });
  });

  it('flags a reference already present on an existing imported Job Order', async () => {
    const admin = await createTestUserAndToken({ email: `admin-${createId()}@test.local`, password: 'pass', roles: ['ADMIN'] });
    const factory = await createTestFactory();
    const financialYear = await createTestFinancialYear();
    const flow = await prisma.processFlow.create({ data: { id: createId(), code: `F-${createId()}`, name: 'F', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } }, include: { versions: true } });
    await prisma.jobOrder.create({
      data: {
        id: createId(),
        jobOrderNumber: `EIJOH-${createId()}`,
        factoryId: factory.id,
        processFlowVersionId: flow.versions[0]!.id,
        unitPrice: 100,
        status: 'PRODUCTION_COMPLETE',
        recordOrigin: 'HISTORICAL_IMPORT',
        createdBy: admin.userId,
        financialYearId: financialYear.id,
        jobOrderSerial: null,
        legacyReferenceNumber: 'EI25001',
      },
    });
    const results = await detectDuplicateLegacyReferences(prisma, ['EI25001']);
    expect(results[0]).toMatchObject({ duplicate: true });
    expect(results[0]!.reason).toContain('already exists');
  });
});

describe('reconcileBatch', () => {
  it('classifies a fully-resolvable record READY even when its image needs MANUAL_REVIEW (image never blocks)', async () => {
    await seedMasterData();
    const record = baseParsedRecord();
    const manualReviewImage: ExtractedImageCandidate = { ...OK_IMAGE, method: 'MANUAL_REVIEW', imageBytes: null, sha256: null };
    const [reconciled] = await reconcileBatch(prisma, [{ parsed: record, image: manualReviewImage }]);
    expect(reconciled!.classification).toBe('READY');
    expect(reconciled!.image.disposition).toBe('MANUAL_REVIEW');
  });

  it('classifies BLOCKED when Style cannot be resolved (no master data seeded)', async () => {
    const record = baseParsedRecord();
    const [reconciled] = await reconcileBatch(prisma, [{ parsed: record, image: OK_IMAGE }]);
    expect(reconciled!.classification).toBe('BLOCKED');
    expect(reconciled!.blockedReasons.some((r) => r.includes('Style'))).toBe(true);
  });

  it('classifies REVIEW_REQUIRED for a PARTIAL parse or a quantity mismatch even when master data resolves', async () => {
    await seedMasterData();
    const partial = baseParsedRecord({ parseStatus: 'PARTIAL' });
    const [reconciledPartial] = await reconcileBatch(prisma, [{ parsed: partial, image: OK_IMAGE }]);
    expect(reconciledPartial!.classification).toBe('REVIEW_REQUIRED');

    const mismatched = baseParsedRecord({ quantitySumMatchesTotal: false });
    const [reconciledMismatch] = await reconcileBatch(prisma, [{ parsed: mismatched, image: OK_IMAGE }]);
    expect(reconciledMismatch!.classification).toBe('REVIEW_REQUIRED');
  });

  it('classifies REVIEW_REQUIRED for a repeated legacy reference within the batch, not DUPLICATE, even when otherwise READY', async () => {
    await seedMasterData();
    const recordA = baseParsedRecord();
    const recordB = baseParsedRecord({ sourceFileName: 'EI25001-copy.pdf' });
    const reconciled = await reconcileBatch(prisma, [
      { parsed: recordA, image: OK_IMAGE },
      { parsed: recordB, image: OK_IMAGE },
    ]);
    expect(reconciled[0]!.classification).toBe('REVIEW_REQUIRED');
    expect(reconciled[0]!.duplicateLegacyReference).toBe(true);
    expect(reconciled[1]!.classification).toBe('REVIEW_REQUIRED');
  });
});
