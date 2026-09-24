import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import { toCurrentUser, currentUserSelect } from '../auth/current-user.js';
import { createTestFactory, createTestSeason, createTestUser, resetDatabase } from '../test/helpers.js';
import { planStyles, applyStyles, type StylePrepOptions } from './historical-import-style-prep.js';

const EXPECTED_HEADER = ['Season', 'Heads', 'Description', "IP's", 'Category', 'Licensor', 'Factory', 'Base code', 'MRP', 'Exfactory', 'Factory', 'Colour', 'Season'];

interface FixtureOptions {
  season: string;
  lmix: string;
  factoryName: string;
  legacyRef: string;
  sizeCode: string;
  workbookMrp: number;
  workbookExFactory: number;
  historicalSupplierRate: string;
  /** Defaults to a trailing-separator-hyphen value ("Test Category-") so the default fixture exercises normalizeMrpCategory end-to-end, matching the real AW25 workbook shape. */
  workbookCategory?: string;
  /** Defaults to the "*HS 61091000" (space) format already handled before H2B.2; override to exercise the newly-recovered "*HSxxxxx"/"*HS - xxxxx" formats. */
  stagedHsnCode?: string | null;
  /** H2B.1 documentary stanza under the table; defaults to empty (no *HS line, so hsnDescription stays null). */
  specificationText?: string;
  tableDescription?: string;
  tableStyleName?: string;
  sourceChecksumSha256?: string;
}

async function writeFixtures(dir: string, optsOrList: FixtureOptions | FixtureOptions[]) {
  const list = Array.isArray(optsOrList) ? optsOrList : [optsOrList];
  const workbookPath = join(dir, 'mrp.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    EXPECTED_HEADER,
    ...list.map((opts) => [
      opts.season.replace(/(\w{2})(\d{2})/, '$1-$2'),
      '#VALUE!',
      'Test Description',
      'Test IP',
      opts.workbookCategory ?? 'Test Category-',
      'Test Licensor',
      opts.factoryName,
      Number(opts.lmix.replace(/^LMIX/i, '')),
      opts.workbookMrp,
      opts.workbookExFactory,
      opts.factoryName,
      'TEST COLOUR',
      opts.season.replace(/(\w{2})(\d{2})/, '$1-$2'),
    ]),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MRP & Ex Factory');
  XLSX.writeFile(wb, workbookPath);

  const stagingPath = join(dir, 'source-staging.json');
  const staging = list.map((opts) => ({
      sourceFileName: `PO Sheet - ${opts.legacyRef} - ${opts.lmix}.pdf`,
      sourceRelativePath: `PO Sheet - ${opts.legacyRef} - ${opts.lmix}.pdf`,
      sourceChecksumSha256: opts.sourceChecksumSha256 ?? 'a'.repeat(64),
      sourceSizeBytes: 1000,
      sourceSeasonFolder: opts.season,
      parseStatus: 'OK',
      warnings: [],
      fields: {
        legacyReferenceNumber: { value: opts.legacyRef, provenance: 'SOURCE_DOCUMENT' },
        documentSeason: { value: opts.season, provenance: 'SOURCE_DOCUMENT' },
        seasonFolderMismatch: false,
        factoryName: { value: opts.factoryName, provenance: 'SOURCE_DOCUMENT' },
        licenseStyleLmix: { value: opts.lmix, provenance: 'SOURCE_DOCUMENT' },
        styleName: { value: 'Test Style', provenance: 'SOURCE_DOCUMENT' },
        colour: { value: 'Test Colour Detailed', provenance: 'SOURCE_DOCUMENT' },
        description: { value: 'Test Description Detailed', provenance: 'SOURCE_DOCUMENT' },
        documentarySections: {
          version: 'H2B.1', tableDescription: opts.tableDescription ?? 'Test Description Detailed', tableStyleName: opts.tableStyleName ?? 'Test Style',
          specificationText: opts.specificationText ?? '',
          styleDescription: 'Test Description Detailed', approvalText: 'Sample instruction',
          disclaimerText: '*Source clause', jobOrderDisclaimer: 'Sample instruction\n\n*Source clause',
          reviewReasons: [], boundaries: {},
        },
        hsnCode: { value: opts.stagedHsnCode === undefined ? '61091000' : opts.stagedHsnCode, provenance: opts.stagedHsnCode === null ? 'UNKNOWN' : 'SOURCE_DOCUMENT' },
        orderDate: { value: '2026-01-01', provenance: 'SOURCE_DOCUMENT' },
        shipmentDate: { value: '2026-02-01', provenance: 'SOURCE_DOCUMENT' },
        unitRate: { value: opts.historicalSupplierRate, provenance: 'SOURCE_DOCUMENT' },
        currency: { value: 'INR', provenance: 'SOURCE_DOCUMENT' },
        paymentTerms: { value: null, provenance: 'UNKNOWN' },
        approvalSampleInstructions: { value: null, provenance: 'UNKNOWN' },
        aqlInspectionTerms: { value: null, provenance: 'UNKNOWN' },
        sizeQuantities: [{ sizeCode: opts.sizeCode, quantity: 100 }],
        tableTotalQuantity: { value: 100, provenance: 'SOURCE_DOCUMENT' },
        headerTotalQuantity: { value: 100, provenance: 'SOURCE_DOCUMENT' },
        quantitySumMatchesTotal: true,
      },
      imageExtractionMethod: 'MANUAL_REVIEW',
      imageSha256: null,
      imageWidthPx: null,
      imageHeightPx: null,
      imageRelativePath: null,
      imageNotes: [],
  }));
  await writeFile(stagingPath, JSON.stringify(staging), 'utf8');

  const options: StylePrepOptions = { workbookPath, stagingFilePath: stagingPath };
  return options;
}

let tmpDir: string;

beforeEach(async () => {
  await resetDatabase();
  tmpDir = await mkdtemp(join(tmpdir(), 'h2a-style-prep-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createActor() {
  const userId = await createTestUser({ email: `admin-${createId()}@example.test`, password: 'correct-horse-battery', roles: ['ADMIN'] });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: currentUserSelect });
  return toCurrentUser(user);
}

describe('historical-import-style-prep', () => {
  it('creates Style/StyleSize/StyleFactoryMapping on first run, then is idempotent on rerun', async () => {
    const season = await createTestSeason({ code: 'SS26' });
    const factory = await createTestFactory({ name: 'Test Factory' });
    await prisma.size.create({ data: { id: createId(), code: '3', label: '3', sizeType: 'AGE', sortOrder: 3 } });
    const actor = await createActor();

    const options = await writeFixtures(tmpDir, {
      season: 'SS26',
      lmix: 'LMIX99999999',
      factoryName: 'Test Factory',
      legacyRef: 'EI99001',
      sizeCode: '3',
      workbookMrp: 999,
      workbookExFactory: 200,
      historicalSupplierRate: '200',
    });

    const plan1 = await planStyles(options);
    expect(plan1).toHaveLength(1);
    expect(plan1[0]).toMatchObject({ action: 'CREATE', season: 'SS26', lmix: 'LMIX99999999', finalMrp: 999 });

    const result1 = await applyStyles(actor, plan1);
    expect(result1.stylesCreated).toHaveLength(1);
    expect(result1.styleSizesCreated).toBe(1);
    expect(result1.styleFactoryMappingsCreated).toBe(1);
    expect(result1.stylesBlocked).toHaveLength(0);

    const style = await prisma.style.findUniqueOrThrow({ where: { id: result1.stylesCreated[0]! } });
    expect(style.lmixNumber).toBe('LMIX99999999');
    expect(style.seasonId).toBe(season.id);
    expect(Number(style.finalMrp)).toBe(999);
    // H2B.2 Stage A: CREATE now also populates categoryDescription (workbook
    // Category with the trailing separator hyphen stripped) and hsnCode.
    expect(style.categoryDescription).toBe('Test Category');
    expect(style.hsnCode).toBe('61091000');
    expect(plan1[0]).toMatchObject({ categoryRaw: 'Test Category-', categoryNormalized: 'Test Category', categoryNormalizationApplied: true });

    const mapping = await prisma.styleFactoryMapping.findFirstOrThrow({ where: { styleId: style.id, factoryId: factory.id } });
    expect(Number(mapping.exFactoryPrice)).toBe(200);

    // Rerun: must be fully idempotent — no duplicate rows, no new writes.
    const plan2 = await planStyles(options);
    expect(plan2[0]).toMatchObject({ action: 'VERIFY_EXISTING', existingStyleId: style.id });
    expect(plan2[0]!.sizes[0]).toMatchObject({ action: 'VERIFY_EXISTING' });
    expect(plan2[0]!.factory).toMatchObject({ action: 'VERIFY_EXISTING' });

    const result2 = await applyStyles(actor, plan2);
    expect(result2.stylesCreated).toHaveLength(0);
    expect(result2.stylesVerified).toEqual([style.id]);
    expect(result2.styleSizesCreated).toBe(0);
    expect(result2.styleSizesVerified).toBe(1);
    expect(result2.styleFactoryMappingsCreated).toBe(0);
    expect(result2.styleFactoryMappingsVerified).toBe(1);

    const totalStyles = await prisma.style.count({ where: { lmixNumber: 'LMIX99999999' } });
    expect(totalStyles).toBe(1);
    const totalStyleSizes = await prisma.styleSize.count({ where: { styleId: style.id } });
    expect(totalStyleSizes).toBe(1);
    const totalMappings = await prisma.styleFactoryMapping.count({ where: { styleId: style.id } });
    expect(totalMappings).toBe(1);
  });

  it('never creates a JobOrder, ImportBatch, or HistoricalDocument row', async () => {
    await createTestSeason({ code: 'SS26' });
    await createTestFactory({ name: 'Test Factory' });
    await prisma.size.create({ data: { id: createId(), code: '3', label: '3', sizeType: 'AGE', sortOrder: 3 } });
    const actor = await createActor();

    const options = await writeFixtures(tmpDir, {
      season: 'SS26',
      lmix: 'LMIX99999999',
      factoryName: 'Test Factory',
      legacyRef: 'EI99001',
      sizeCode: '3',
      workbookMrp: 999,
      workbookExFactory: 200,
      historicalSupplierRate: '200',
    });

    const plan = await planStyles(options);
    await applyStyles(actor, plan);

    expect(await prisma.jobOrder.count()).toBe(0);
  });

  it('BLOCKS a required identity whose MRP is not RESOLVED, without creating a Style', async () => {
    await createTestSeason({ code: 'SS26' });
    await createTestFactory({ name: 'Test Factory' });
    const actor = await createActor();

    // Ex-factory cost disagrees with the historical PO supplier rate ->
    // REVIEW_REQUIRED in reconcileMrp -> BLOCKED in the style plan.
    const options = await writeFixtures(tmpDir, {
      season: 'SS26',
      lmix: 'LMIX99999999',
      factoryName: 'Test Factory',
      legacyRef: 'EI99001',
      sizeCode: '3',
      workbookMrp: 999,
      workbookExFactory: 200,
      historicalSupplierRate: '999999',
    });

    const plan = await planStyles(options);
    expect(plan[0]!.action).toBe('BLOCKED');

    const result = await applyStyles(actor, plan);
    expect(result.stylesCreated).toHaveLength(0);
    expect(result.stylesBlocked).toHaveLength(1);
    expect(await prisma.style.count()).toBe(0);
  });

  // H2B.2 Stage A: the 91 real Dev Styles were created BEFORE this change and
  // therefore have categoryDescription/hsnCode null on 91/91 and 37/91
  // respectively. These tests simulate that pre-existing state directly
  // (rather than re-deriving it through two full CREATE runs) and verify the
  // canonical VERIFY_EXISTING path backfills the same way applyStyles would
  // have for a truly pre-existing row.
  describe('field reconciliation on an already-existing Style (Dev backfill)', () => {
    async function setUpExistingStyle(overrides?: Partial<FixtureOptions>) {
      await createTestSeason({ code: 'SS26' });
      await createTestFactory({ name: 'Test Factory' });
      await prisma.size.create({ data: { id: createId(), code: '3', label: '3', sizeType: 'AGE', sortOrder: 3 } });
      const actor = await createActor();
      const options = await writeFixtures(tmpDir, {
        season: 'SS26',
        lmix: 'LMIX99999999',
        factoryName: 'Test Factory',
        legacyRef: 'EI99001',
        sizeCode: '3',
        workbookMrp: 999,
        workbookExFactory: 200,
        historicalSupplierRate: '200',
        ...overrides,
      });
      const plan = await planStyles(options);
      const result = await applyStyles(actor, plan);
      const styleId = result.stylesCreated[0]!;
      return { actor, options, styleId };
    }

    it('backfills a currently-null categoryDescription/hsnCode without touching anything else', async () => {
      const { actor, options, styleId } = await setUpExistingStyle();
      // Simulate the pre-H2B.2 state: created without these two fields.
      await prisma.style.update({ where: { id: styleId }, data: { categoryDescription: null, hsnCode: null } });

      const plan = await planStyles(options);
      expect(plan[0]).toMatchObject({ action: 'VERIFY_EXISTING', existingStyleId: styleId });
      const result = await applyStyles(actor, plan);

      expect(result.fieldReconciliation).toHaveLength(1);
      expect(result.fieldReconciliation[0]).toMatchObject({
        categoryOutcome: 'SET',
        proposedCategoryDescription: 'Test Category',
        hsnOutcome: 'SET',
        parsedHsnCode: '61091000',
        hsnChanged: true,
      });

      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style.categoryDescription).toBe('Test Category');
      expect(style.hsnCode).toBe('61091000');
    });

    it('never overwrites an existing non-null value that disagrees with the proposed one', async () => {
      const { actor, options, styleId } = await setUpExistingStyle();
      await prisma.style.update({ where: { id: styleId }, data: { categoryDescription: 'Some Other Category', hsnCode: '99999999' } });

      const plan = await planStyles(options);
      const result = await applyStyles(actor, plan);

      expect(result.fieldReconciliation[0]).toMatchObject({
        categoryOutcome: 'REVIEW_REQUIRED_CONFLICT',
        hsnOutcome: 'REVIEW_REQUIRED_CONFLICT',
        hsnChanged: false,
      });
      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style.categoryDescription).toBe('Some Other Category');
      expect(style.hsnCode).toBe('99999999');
    });

    it('is idempotent — a second reconciliation run makes no further writes once already backfilled', async () => {
      const { actor, options, styleId } = await setUpExistingStyle();
      await prisma.style.update({ where: { id: styleId }, data: { categoryDescription: null, hsnCode: null } });

      const plan1 = await planStyles(options);
      const result1 = await applyStyles(actor, plan1);
      expect(result1.fieldReconciliation[0]!.categoryOutcome).toBe('SET');
      expect(result1.fieldReconciliation[0]!.hsnOutcome).toBe('SET');

      const plan2 = await planStyles(options);
      const result2 = await applyStyles(actor, plan2);
      expect(result2.fieldReconciliation[0]!.categoryOutcome).toBe('ALREADY_SET');
      expect(result2.fieldReconciliation[0]!.hsnOutcome).toBe('ALREADY_SET');

      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style.categoryDescription).toBe('Test Category');
      expect(style.hsnCode).toBe('61091000');
    });

    it('recovers a null hsnCode using an hsnRefreshBySourceChecksum override, bypassing the stale staging cache', async () => {
      // staging.json carries no usable hsnCode for this identity (the
      // pre-H2B.2 parser's real-world equivalent of the 37 null cases) —
      // only the fresh override supplies the corrected value. Keyed by
      // sourceChecksumSha256 ('a'.repeat(64) in the fixture staging record),
      // never by legacyReferenceNumber — see hsn-refresh.ts for why a
      // printed-legacyReference key is unsafe (EI26031/EI26032 collision).
      const { actor, options, styleId } = await setUpExistingStyle({ stagedHsnCode: null });
      await prisma.style.update({ where: { id: styleId }, data: { categoryDescription: null, hsnCode: null } });

      const withOverride: StylePrepOptions = {
        ...options,
        hsnRefreshBySourceChecksum: new Map([['a'.repeat(64), '61046200']]),
      };
      const plan = await planStyles(withOverride);
      expect(plan[0]!.hsnCode).toBe('61046200');
      const result = await applyStyles(actor, plan);
      expect(result.fieldReconciliation[0]).toMatchObject({ hsnOutcome: 'SET', parsedHsnCode: '61046200' });

      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style.hsnCode).toBe('61046200');
    });

    it('does not alter Style.description, styleName, or any other field while backfilling', async () => {
      const { actor, options, styleId } = await setUpExistingStyle();
      const before = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      await prisma.style.update({ where: { id: styleId }, data: { categoryDescription: null, hsnCode: null } });

      const plan = await planStyles(options);
      await applyStyles(actor, plan);

      const after = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(after.description).toBe(before.description);
      expect(after.styleName).toBe(before.styleName);
      expect(after.finalMrp.toString()).toBe(before.finalMrp.toString());
      expect(after.colour).toBe(before.colour);
      expect(after.ipName).toBe(before.ipName);
      expect(after.licensor).toBe(before.licensor);
    });
  });

  // H2B.2 follow-up — Policy C (hsn-description.ts): the source *HS label is
  // written only when the stanza is consistent; code-only and conflicting
  // sources stay null; an existing different value is never overwritten.
  describe('hsnDescription from the source *HS label', () => {
    const boysTee = {
      specificationText: '*ST1: Boys Short Sleeve T-Shirt - Jurrasic World\n*HS 61091000 Boys / T-Shirt',
      tableDescription: 'SandShell Boys Short Sleeve T Shirt',
      tableStyleName: "Boy's T- Shirt",
    };

    async function setUp(overrides?: Partial<FixtureOptions>) {
      await createTestSeason({ code: 'SS26' });
      await createTestFactory({ name: 'Test Factory' });
      await prisma.size.create({ data: { id: createId(), code: '3', label: '3', sizeType: 'AGE', sortOrder: 3 } });
      const actor = await createActor();
      const options = await writeFixtures(tmpDir, {
        season: 'SS26',
        lmix: 'LMIX99999999',
        factoryName: 'Test Factory',
        legacyRef: 'EI99001',
        sizeCode: '3',
        workbookMrp: 999,
        workbookExFactory: 200,
        historicalSupplierRate: '200',
        ...boysTee,
        ...overrides,
      });
      const result = await applyStyles(actor, await planStyles(options));
      return { actor, options, styleId: result.stylesCreated[0]!, created: result };
    }

    it('writes the verbatim source label on CREATE', async () => {
      const { styleId, created } = await setUp();
      expect(created.fieldReconciliation[0]).toMatchObject({ hsnDescriptionOutcome: 'SET', proposedHsnDescription: 'Boys / T-Shirt' });
      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style).toMatchObject({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' });
    });

    it('backfills a null hsnDescription on an existing Style, leaving hsnCode and every other field unchanged', async () => {
      const { actor, options, styleId } = await setUp();
      await prisma.style.update({ where: { id: styleId }, data: { hsnDescription: null } });
      const before = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });

      const result = await applyStyles(actor, await planStyles(options));
      expect(result.fieldReconciliation[0]).toMatchObject({
        hsnOutcome: 'ALREADY_SET',
        hsnChanged: false,
        hsnDescriptionOutcome: 'SET',
        previousHsnDescription: null,
        proposedHsnDescription: 'Boys / T-Shirt',
        sourceChecksumSha256: 'a'.repeat(64),
      });
      expect(result.fieldReconciliation[0]!.hsnDescriptionSource).toMatchObject({ classification: 'HSN_WITH_SOURCE_DESCRIPTION', rawHsLine: '*HS 61091000 Boys / T-Shirt' });

      const after = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(after.hsnDescription).toBe('Boys / T-Shirt');
      expect({ ...after, hsnDescription: null, updatedAt: null }).toEqual({ ...before, hsnDescription: null, updatedAt: null });
    });

    it('is idempotent — a second run finds ALREADY_SET and writes nothing', async () => {
      const { actor, options, styleId } = await setUp();
      await prisma.style.update({ where: { id: styleId }, data: { hsnDescription: null } });
      await applyStyles(actor, await planStyles(options));
      const afterFirst = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });

      const second = await applyStyles(actor, await planStyles(options));
      expect(second.fieldReconciliation[0]).toMatchObject({ hsnDescriptionOutcome: 'ALREADY_SET', hsnOutcome: 'ALREADY_SET' });
      const afterSecond = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
      expect(afterSecond.hsnDescription).toBe('Boys / T-Shirt');
    });

    it('hard-stops without writing anything when an existing different hsnDescription is found', async () => {
      const { actor, options, styleId } = await setUp();
      await prisma.style.update({ where: { id: styleId }, data: { hsnDescription: 'Manually Entered', categoryDescription: null } });

      await expect(applyStyles(actor, await planStyles(options))).rejects.toThrow(/REVIEW_REQUIRED.*existing="Manually Entered" proposed="Boys \/ T-Shirt"/);
      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style.hsnDescription).toBe('Manually Entered');
      // The null categoryDescription would otherwise have been backfilled — proves the stop precedes every write.
      expect(style.categoryDescription).toBeNull();
    });

    it('leaves hsnDescription null for a code-only *HS line', async () => {
      const { styleId, created } = await setUp({
        stagedHsnCode: '61046200',
        specificationText: '*ST1: Girls High Waist Shorts - BARBIE\n*HS - 61046200',
        tableDescription: 'Girls High Waist Shorts',
        tableStyleName: 'Barbie Girls Shorts',
      });
      expect(created.fieldReconciliation[0]).toMatchObject({ hsnDescriptionOutcome: 'NO_SOURCE_VALUE', proposedHsnDescription: null });
      expect(created.fieldReconciliation[0]!.hsnDescriptionSource?.classification).toBe('HSN_CODE_ONLY');
      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style).toMatchObject({ hsnCode: '61046200', hsnDescription: null });
    });

    it('leaves hsnDescription null (review-required) for a gender-conflicting label but keeps the hsnCode', async () => {
      const { styleId, created } = await setUp({
        stagedHsnCode: '61061000',
        specificationText: '*ST1: Girls Sweat Shirt - Paw Patrol\n*HS 61061000Boys / Sweat Shirt',
        tableDescription: 'Prism Pink Girls Sweat Shirt',
        tableStyleName: "Girl's Sweat Shirt",
      });
      expect(created.fieldReconciliation[0]!.hsnDescriptionSource).toMatchObject({ classification: 'REVIEW_REQUIRED', semanticCheck: 'GENDER_CONFLICT' });
      const style = await prisma.style.findUniqueOrThrow({ where: { id: styleId } });
      expect(style).toMatchObject({ hsnCode: '61061000', hsnDescription: null });
    });

    it('resolves each source document by checksum, so two PDFs printing the same legacy reference (EI26031/EI26032) cannot collide', async () => {
      await createTestSeason({ code: 'SS26' });
      await createTestFactory({ name: 'Test Factory' });
      await prisma.size.create({ data: { id: createId(), code: '3', label: '3', sizeType: 'AGE', sortOrder: 3 } });
      const actor = await createActor();
      const shared = { season: 'SS26', factoryName: 'Test Factory', legacyRef: 'EI26031', sizeCode: '3', workbookMrp: 999, workbookExFactory: 200, historicalSupplierRate: '200' };
      const options = await writeFixtures(tmpDir, [
        { ...shared, lmix: 'LMIX29526010', sourceChecksumSha256: 'a'.repeat(64), stagedHsnCode: '61091000', ...boysTee },
        {
          ...shared,
          lmix: 'LMIX25426009',
          sourceChecksumSha256: 'b'.repeat(64),
          stagedHsnCode: '61046200',
          specificationText: '*ST1: Girls Sweat Pant\n*HS 61046200 Girls / Sweat Pant',
          tableDescription: 'Black Girls Sweat Pant',
          tableStyleName: "Girl's Sweat Pant",
        },
      ]);

      const plan = await planStyles(options);
      expect(plan.map((p) => [p.lmix, p.sourceChecksumSha256, p.hsnDescription])).toEqual([
        ['LMIX29526010', 'a'.repeat(64), 'Boys / T-Shirt'],
        ['LMIX25426009', 'b'.repeat(64), 'Girls / Sweat Pant'],
      ]);
      const result = await applyStyles(actor, plan);
      const styles = await prisma.style.findMany({ where: { id: { in: result.stylesCreated } }, select: { lmixNumber: true, hsnCode: true, hsnDescription: true } });
      expect(styles.sort((a, b) => a.lmixNumber!.localeCompare(b.lmixNumber!))).toEqual([
        { lmixNumber: 'LMIX25426009', hsnCode: '61046200', hsnDescription: 'Girls / Sweat Pant' },
        { lmixNumber: 'LMIX29526010', hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' },
      ]);
    });
  });
});
