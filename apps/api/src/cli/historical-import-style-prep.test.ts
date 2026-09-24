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
}

async function writeFixtures(dir: string, opts: FixtureOptions) {
  const workbookPath = join(dir, 'mrp.xlsx');
  const baseCodeDigits = opts.lmix.replace(/^LMIX/i, '');
  const ws = XLSX.utils.aoa_to_sheet([
    EXPECTED_HEADER,
    [
      opts.season.replace(/(\w{2})(\d{2})/, '$1-$2'),
      '#VALUE!',
      'Test Description',
      'Test IP',
      'Test Category',
      'Test Licensor',
      opts.factoryName,
      Number(baseCodeDigits),
      opts.workbookMrp,
      opts.workbookExFactory,
      opts.factoryName,
      'TEST COLOUR',
      opts.season.replace(/(\w{2})(\d{2})/, '$1-$2'),
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MRP & Ex Factory');
  XLSX.writeFile(wb, workbookPath);

  const stagingPath = join(dir, 'source-staging.json');
  const staging = [
    {
      sourceFileName: `PO Sheet - ${opts.legacyRef}.pdf`,
      sourceRelativePath: `PO Sheet - ${opts.legacyRef}.pdf`,
      sourceChecksumSha256: 'a'.repeat(64),
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
          version: 'H2B.1', tableDescription: 'Test Description Detailed', specificationText: '',
          styleDescription: 'Test Description Detailed', approvalText: 'Sample instruction',
          disclaimerText: '*Source clause', jobOrderDisclaimer: 'Sample instruction\n\n*Source clause',
          reviewReasons: [], boundaries: {},
        },
        hsnCode: { value: '61091000', provenance: 'SOURCE_DOCUMENT' },
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
    },
  ];
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
});
