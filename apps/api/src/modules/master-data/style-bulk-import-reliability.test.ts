import { createHash } from 'node:crypto';
import { createId } from '@erve/shared';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { prisma } from '../../db/prisma.js';
import { createTestSeason, createTestUser, resetDatabase } from '../../test/helpers.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import { getFileStorage } from '../../storage/index.js';
import { executeBulkStyleImport, parseBulkStyleImportSheet, planBulkStyleImport, bulkStyleImportConfirmationToken, verifyBulkStyleImportConfirmation } from './style-bulk-import.service.js';
import { uploadStyleImage, removeStyleImage } from './style-images.service.js';
import * as auditService from '../../audit/audit.service.js';
import sharp from 'sharp';
import { pictureInCellFixture, tinyPng } from '../../cli/picture-in-cell.fixture.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const headers = ['Style Number', 'Style Name', 'Final MRP', 'Season Code', 'Size Codes', 'Barcodes', 'Financial Year', 'Factory Name Mappings'];
function workbook(rows: unknown[][], extraSheet = false) {
  const book = XLSX.utils.book_new();
  if (extraSheet) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Cover']]), 'Cover');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Styles');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
function embeddedWorkbook(rows: unknown[][], images: Array<{ row: number; bytes: Buffer }>, sheet = 2): Buffer {
  const zip = new AdmZip(workbook(rows, sheet === 2));
  const owner = `xl/worksheets/sheet${sheet}.xml`;
  zip.addFile(owner, Buffer.from(zip.getEntry(owner)!.getData().toString().replace('</worksheet>', '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdImages"/></worksheet>')));
  zip.addFile(`xl/worksheets/_rels/sheet${sheet}.xml.rels`, Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImages" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'));
  zip.addFile('xl/drawings/drawing1.xml', Buffer.from(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${images.map((image, i) => `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="100" cy="100"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="Image ${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="img${i}"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`));
  zip.addFile('xl/drawings/_rels/drawing1.xml.rels', Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((_, i) => `<Relationship Id="img${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i}.png"/>`).join('')}</Relationships>`));
  for (const [i, image] of images.entries()) zip.addFile(`xl/media/image${i}.png`, image.bytes);
  const types = zip.getEntry('[Content_Types].xml')!.getData().toString().replace('</Types>', '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  zip.addFile('[Content_Types].xml', Buffer.from(types));
  return zip.toBuffer();
}
async function setup() {
  const season = await createTestSeason({ code: 'AW25' });
  const size = await prisma.size.create({ data: { id: createId(), code: 'S', label: 'S', sizeType: 'ALPHA', sortOrder: 1 } });
  const userId = await createTestUser({ email: 'pr6@test.local', password: 'password123', roles: ['ADMIN'] });
  const actor = toCurrentUser(await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: currentUserSelect }));
  return { season, size, actor };
}
beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

describe('Style import reliability', () => {
  it('reports differing existing gallery content for review without overwriting it', async () => {
    const { actor } = await setup();
    const original = embeddedWorkbook([['ST-GALLERY', 'Tee', 100, 'AW25', 'S', 'BC-GALLERY']], [{ row: 2, bytes: png }]);
    await executeBulkStyleImport(actor, await planBulkStyleImport(original, 'Styles'), 's.xlsx');
    const other = await sharp(png).flatten({ background: '#ff0000' }).png().toBuffer();
    const changed = embeddedWorkbook([['ST-GALLERY', 'Tee', 100, 'AW25', 'S', 'BC-GALLERY']], [{ row: 2, bytes: other }]);
    expect((await planBulkStyleImport(changed, 'Styles')).rows[0]).toMatchObject({ status: 'REJECTED', reason: 'IMAGE_PROVENANCE_MISMATCH' });
    const image = await prisma.styleImage.findFirstOrThrow({ include: { file: true } });
    expect(await getFileStorage().read(image.file.storageKey)).toEqual(png);
  });
  it.each(['png', 'jpeg'] as const)('persists modern %s with exact Style association, normalized bytes and original provenance', async (format) => {
    const { actor } = await setup();
    const source = format === 'jpeg' ? await sharp(tinyPng).jpeg().toBuffer() : tinyPng;
    const zip = new AdmZip(workbook([['ST-MODERN', 'Modern', 100, 'AW25', 'S', 'BC-MODERN']], true));
    const modern = new AdmZip(pictureInCellFixture({ media: source, web: format === 'jpeg' }));
    for (const entry of modern.getEntries()) if (/^xl\/(richData|media)\//.test(entry.entryName) || entry.entryName === 'xl/metadata.xml') zip.addFile(entry.entryName, entry.getData());
    const rels = modern.getEntry('xl/_rels/workbook.xml.rels')!.getData().toString().match(/<Relationship [^>]+\/>/g)!.filter(r => !r.includes('/worksheet'));
    // Replace SheetJS's own metadata relationship with the synthetic rich-image metadata.
    const baseRelationships = zip.getEntry('xl/_rels/workbook.xml.rels')!.getData().toString()
      .replace(/<Relationship\b[^>]*Type="[^"]+\/sheetMetadata"[^>]*\/>/g, '');
    zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(baseRelationships.replace('</Relationships>', rels.join('') + '</Relationships>')));
    zip.addFile('xl/worksheets/sheet2.xml', Buffer.from(zip.getEntry('xl/worksheets/sheet2.xml')!.getData().toString().replace(/(<row r="2"[^>]*>)([\s\S]*?)(<\/row>)/, '$1$2<c r="N2" vm="1" t="e"><v>#VALUE!</v></c>$3')));
    const file = zip.toBuffer();
    const plan = await planBulkStyleImport(file, 'Styles');
    expect(plan.rows[0]).toMatchObject({ status: 'CREATE', imageCount: 1 });
    const done = await executeBulkStyleImport(actor, plan, 'modern.xlsx');
    expect(done.results[0]!.outcome).toBe('COMPLETED');
    const image = await prisma.styleImage.findFirstOrThrow({ include: { file: true, style: true } });
    expect(image.style.styleNumber).toBe('ST-MODERN');
    const stored = await getFileStorage().read(image.file.storageKey);
    expect((await sharp(stored).metadata()).format).toBe('png');
    if (format === 'png') expect(stored).toEqual(source);
    const provenance = await prisma.styleBulkImportRowResult.findFirstOrThrow({ where: { outcome: 'COMPLETED' } });
    expect(JSON.parse(provenance.expectedImageChecksum!).images[0].originalChecksum).toBe(createHash('sha256').update(source).digest('hex'));
    expect((await planBulkStyleImport(file, 'Styles')).rows[0]!.status).toBe('SKIP_EXISTING');
  });
  it('persists genuine repeated picture occurrences and skips a repeat import without collapsing them', async () => {
    const { actor } = await setup();
    const file = embeddedWorkbook([['ST-REPEATED', 'Tee', 100, 'AW25', 'S', 'BC-REPEATED']], [{ row: 2, bytes: png }, { row: 2, bytes: png }]);
    const plan = await planBulkStyleImport(file, 'Styles');
    expect(plan.rows[0]!.imageCount).toBe(2);
    const done = await executeBulkStyleImport(actor, plan, 'styles.xlsx');
    expect(done.results[0]!.outcome).toBe('COMPLETED');
    const images = await prisma.styleImage.findMany({ include: { file: true } });
    expect(images).toHaveLength(2);
    for (const image of images) expect(await getFileStorage().read(image.file.storageKey)).toEqual(png);
    const repeated = await planBulkStyleImport(file, 'Styles');
    expect(repeated.rows[0]!.status).toBe('SKIP_EXISTING');
  });
  it.each(['season', 'lmix', 'during-staging'])('refuses interrupted image recovery after %s identity drift', async (drift) => {
    const { season, size, actor } = await setup();
    const style = await prisma.style.create({ data: { id: createId(), styleNumber: 'ST-DRIFT', styleName: 'Tee', finalMrp: 100, seasonId: season.id } });
    const run = await prisma.styleBulkImportRun.create({ data: { id: createId(), sourceFileName: 'old.xlsx', sourceFileChecksum: 'old', status: 'EXECUTED', actorUserId: actor.id, totalRows: 1 } });
    await prisma.styleBulkImportRowResult.create({ data: { id: createId(), runId: run.id, rowNumber: 2, styleNumber: style.styleNumber, styleId: style.id, outcome: 'IMAGE_PENDING', expectedImageChecksum: createHash('sha256').update(png).digest('hex') } });
    const plan = { sourceFileChecksum: 'old', totalRows: 1, fileLevelImageWarnings: [], rows: [{ rowNumber: 2, styleNumber: style.styleNumber, status: 'RESUME_IMAGE_PENDING' as const, existingStyleId: style.id, imageCount: 1, create: { styleName: 'Tee', finalMrp: 100, seasonId: season.id, lmixNumber: null, sizes: [{ sizeId: size.id, barcode: 'BC-DRIFT' }], factoryMappings: [], images: [{ buffer: png, fileName: 'expected.png', rowNumber: 2 }] } }] };
    if (drift === 'season') {
      const other = await createTestSeason({ code: 'SS26' });
      await prisma.style.update({ where: { id: style.id }, data: { seasonId: other.id } });
    } else if (drift === 'lmix') {
      await prisma.style.update({ where: { id: style.id }, data: { lmixNumber: 'LMIX99999999' } });
    } else {
      const storage = getFileStorage();
      const put = storage.put.bind(storage);
      vi.spyOn(storage, 'put').mockImplementation(async (...args) => {
        await prisma.style.update({ where: { id: style.id }, data: { styleNumber: 'ST-CHANGED' } });
        return put(...args);
      });
    }
    expect((await executeBulkStyleImport(actor, plan, 'old.xlsx')).results[0]).toMatchObject({
      outcome: 'IMAGE_PENDING', detail: expect.stringContaining('identity'),
    });
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(0);
    expect(await prisma.styleBulkImportRowResult.count({ where: { styleId: style.id, outcome: 'COMPLETED' } })).toBe(0);
  });
  it('does not turn an already committed row into failure after a separate projection read fails', async () => {
    const { actor } = await setup();
    const plan = await planBulkStyleImport(embeddedWorkbook([['ST-COMMIT', 'Tee', 100, 'AW25', 'S', 'BC-COMMIT']], [{ row: 2, bytes: png }]), 'Styles');
    vi.spyOn(prisma.style, 'findUnique').mockRejectedValueOnce(new Error('separate postcommit projection read failed'));
    expect((await executeBulkStyleImport(actor, plan, 'styles.xlsx')).results[0]!.outcome).toBe('COMPLETED');
    const image = await prisma.styleImage.findFirstOrThrow({ include: { file: true } });
    expect(await getFileStorage().read(image.file.storageKey)).toEqual(png);
  });
  it('rolls back Style, image metadata and provenance when the Style audit fails', async () => {
    const { actor } = await setup();
    const plan = await planBulkStyleImport(embeddedWorkbook([['ST-AUDIT', 'Tee', 100, 'AW25', 'S', 'BC-AUDIT']], [{ row: 2, bytes: png }]), 'Styles');
    const record = auditService.recordAuditLog;
    vi.spyOn(auditService, 'recordAuditLog').mockImplementation(async (entry, tx) => {
      if (entry.action === 'STYLE_CREATED') throw new Error('injected Style audit failure');
      return record(entry, tx);
    });
    expect((await executeBulkStyleImport(actor, plan, 'styles.xlsx')).results[0]!.outcome).toBe('FAILED');
    expect(await prisma.style.count()).toBe(0);
    expect(await prisma.styleImage.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.styleBulkImportRowResult.count({ where: { outcome: 'COMPLETED' } })).toBe(0);
  });
  it('joins images to the physical row on the exact selected worksheet', async () => {
    const { actor } = await setup();
    const bytes = embeddedWorkbook([[], ['ST-PHYSICAL', 'Tee', 100, 'AW25', 'S', 'BC-PHYSICAL']], [{ row: 3, bytes: png }]);
    const plan = await planBulkStyleImport(bytes, 'Styles');
    expect(plan.rows[0]).toMatchObject({ rowNumber: 3, imageCount: 1, status: 'CREATE' });
    expect(plan.rows[0]!.create!.images[0]!.buffer).toEqual(png);
    expect((await executeBulkStyleImport(actor, plan, 'styles.xlsx')).results[0]!.outcome).toBe('COMPLETED');
    const image = await prisma.styleImage.findFirstOrThrow({ include: { file: true } });
    expect(await getFileStorage().read(image.file.storageKey)).toEqual(png);
  });
  it('resolves FY and factory business names without requiring legacy codes', async () => {
    const { season } = await setup();
    const fy = await prisma.season.findUniqueOrThrow({ where: { id: season.id }, include: { financialYear: true } });
    const factory = await prisma.factory.create({ data: { id: createId(), code: 'LEGACY', name: 'Business Factory' } });
    const plan = await planBulkStyleImport(workbook([['ST-NAME', 'Tee', 100, 'AW25', 'S', 'BC-NAME', fy.financialYear.code, ' business   factory :450']]));
    expect(plan.rows[0]).toMatchObject({ status: 'CREATE', create: { seasonId: season.id, factoryMappings: [{ factoryId: factory.id, exFactoryPrice: 450 }] } });
  });
  it('binds preview confirmation to actor, worksheet, eligibility and expiry', async () => {
    const { actor } = await setup();
    const plan = await planBulkStyleImport(workbook([['ST-CONF', 'Tee', 100, 'AW25', 'S', 'BC-CONF']]));
    const token = bulkStyleImportConfirmationToken(plan, actor.id, 1_000);
    expect(() => verifyBulkStyleImportConfirmation(plan, actor.id, token, 2_000)).not.toThrow();
    expect(() => verifyBulkStyleImportConfirmation(plan, 'other', token, 2_000)).toThrow(/preview/i);
    expect(() => verifyBulkStyleImportConfirmation({ ...plan, worksheet: 'other' }, actor.id, token, 2_000)).toThrow(/preview/i);
    expect(() => verifyBulkStyleImportConfirmation(plan, actor.id, token, 1_000_000)).toThrow(/preview/i);
    expect(() => verifyBulkStyleImportConfirmation({ ...plan, rows: [] }, actor.id, token, 2_000)).toThrow(/preview/i);
  });
  it('records every image, recovers partial attachments, and rejects a changed second image', async () => {
    const { actor } = await setup();
    const images = [{ row: 2, bytes: png }, { row: 2, bytes: Buffer.concat([png, Buffer.from('second')]) }];
    const rows = [['ST-MULTI', 'Tee', 100, 'AW25', 'S', 'BC-MULTI']];
    const bytes = embeddedWorkbook(rows, images);
    const plan = await planBulkStyleImport(bytes, 'Styles');
    await executeBulkStyleImport(actor, plan, 'styles.xlsx');
    const provenance = await prisma.styleBulkImportRowResult.findFirstOrThrow({ where: { styleNumber: 'ST-MULTI' } });
    expect(JSON.parse(provenance.expectedImageChecksum!).images).toHaveLength(2);
    await prisma.styleBulkImportRowResult.update({ where: { id: provenance.id }, data: { outcome: 'IMAGE_PENDING' } });
    const gallery = await prisma.styleImage.findMany({ where: { styleId: provenance.styleId! }, orderBy: { sortOrder: 'asc' } });
    await removeStyleImage(actor, provenance.styleId!, gallery[1]!.id);
    const changed = embeddedWorkbook(rows, [images[0]!, { row: 2, bytes: Buffer.concat([png, Buffer.from('changed-second')]) }]);
    expect((await planBulkStyleImport(changed, 'Styles')).rows[0]).toMatchObject({ status: 'REJECTED', reason: 'IMAGE_PROVENANCE_MISMATCH' });
    const recovery = await planBulkStyleImport(bytes, 'Styles');
    expect(recovery.rows[0]!.status).toBe('RESUME_IMAGE_PENDING');
    const summaries = await Promise.all([executeBulkStyleImport(actor, recovery, 'styles.xlsx'), executeBulkStyleImport(actor, recovery, 'styles.xlsx')]);
    expect(summaries.map((summary) => summary.results[0]!.outcome)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(await prisma.styleImage.count({ where: { styleId: provenance.styleId! } })).toBe(2);
    expect((await planBulkStyleImport(bytes, 'Styles')).rows[0]!.status).toBe('SKIP_EXISTING');
  });
  it('keeps physical row numbers after blank rows and selects the named sheet', () => {
    const buffer = workbook([[], ['ST-ROW', 'Tee', 100, 'AW25', 'S', 'BC-ROW']], true);
    expect(parseBulkStyleImportSheet(buffer, 'Styles')).toMatchObject([{ rowNumber: 3, styleNumber: 'ST-ROW' }]);
  });
  it('rejects an ambiguous season rather than picking the last financial year', async () => {
    await setup();
    const fy = await prisma.financialYear.create({ data: { id: createId(), code: '2024-25', startDate: new Date('2024-04-01'), endDate: new Date('2025-03-31') } });
    await createTestSeason({ code: 'AW25', financialYearId: fy.id });
    const plan = await planBulkStyleImport(workbook([['ST-AMB', 'Tee', 100, 'AW25', 'S', 'BC-AMB']]));
    expect(plan.rows[0]).toMatchObject({ status: 'REJECTED', reason: 'AMBIGUOUS_SEASON' });
  });
  it('previews domain barcode errors before executing, without writing', async () => {
    await setup();
    const plan = await planBulkStyleImport(workbook([['ST-GEN', 'Tee', 100, 'AW25', 'S', '']]));
    expect(plan.rows[0]).toMatchObject({ status: 'REJECTED', reason: 'DOMAIN_VALIDATION_FAILED' });
    expect(await prisma.style.count()).toBe(0);
    expect(await prisma.styleBulkImportRun.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });
  it('rejects duplicate barcodes across file rows during read-only planning', async () => {
    await setup();
    const plan = await planBulkStyleImport(workbook([
      ['ST-A', 'Tee', 100, 'AW25', 'S', 'BC-SAME'], ['ST-B', 'Tee', 100, 'AW25', 'S', 'BC-SAME'],
    ]));
    expect(plan.rows[1]).toMatchObject({ status: 'REJECTED', reason: 'DUPLICATE_BARCODE_IN_FILE' });
  });
  it('requires an active authorized actor before creating even a run', async () => {
    const { actor } = await setup();
    const plan = await planBulkStyleImport(workbook([['ST-A', 'Tee', 100, 'AW25', 'S', 'BC-A']]));
    await prisma.user.update({ where: { id: actor.id }, data: { status: 'INACTIVE' } });
    await expect(executeBulkStyleImport(actor, plan, 'styles.xlsx')).rejects.toThrow(/active|authorized/i);
    expect(await prisma.styleBulkImportRun.count()).toBe(0);
  });
  it('a second staged image failure rolls back the complete logical Style row', async () => {
    const { actor } = await setup();
    const plan = await planBulkStyleImport(workbook([['ST-STAGE', 'Tee', 100, 'AW25', 'S', 'BC-STAGE']]));
    const images = [{ buffer: png, fileName: 'one.png', rowNumber: 2 }, { buffer: Buffer.concat([png, Buffer.from('second')]), fileName: 'two.png', rowNumber: 2 }];
    plan.rows[0]!.create!.images = images;
    const storage = getFileStorage();
    const put = storage.put.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'put').mockImplementation(async (key, bytes) => {
      if (++calls === 2) throw new Error('injected second image failure');
      return put(key, bytes);
    });
    const summary = await executeBulkStyleImport(actor, plan, 'styles.xlsx');
    expect(summary.results[0]!.outcome).toBe('FAILED');
    expect(await prisma.style.count()).toBe(0);
    expect(await prisma.styleImage.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
    vi.restoreAllMocks();
    expect((await executeBulkStyleImport(actor, plan, 'styles.xlsx')).results[0]!.outcome).toBe('COMPLETED');
    expect(await prisma.styleImage.count()).toBe(2);
  });
  it('a legacy recovery never treats an unrelated existing image as completion', async () => {
    const { season, size, actor } = await setup();
    const style = await prisma.style.create({ data: { id: createId(), styleNumber: 'ST-REC', styleName: 'Tee', finalMrp: 100, seasonId: season.id } });
    await uploadStyleImage(actor, style.id, { buffer: Buffer.concat([png, Buffer.from('unrelated')]), originalName: 'unrelated.png' });
    const run = await prisma.styleBulkImportRun.create({ data: { id: createId(), sourceFileName: 'old.xlsx', sourceFileChecksum: 'old', status: 'EXECUTED', actorUserId: actor.id, totalRows: 1 } });
    await prisma.styleBulkImportRowResult.create({ data: { id: createId(), runId: run.id, rowNumber: 2, styleNumber: style.styleNumber, styleId: style.id, outcome: 'IMAGE_PENDING', expectedImageChecksum: createHash('sha256').update(png).digest('hex') } });
    const plan = { sourceFileChecksum: 'old', totalRows: 1, fileLevelImageWarnings: [], rows: [{ rowNumber: 2, styleNumber: style.styleNumber, status: 'RESUME_IMAGE_PENDING' as const, existingStyleId: style.id, imageCount: 1, create: { styleName: 'Tee', finalMrp: 100, seasonId: season.id, lmixNumber: null, sizes: [{ sizeId: size.id, barcode: 'BC-REC' }], factoryMappings: [], images: [{ buffer: png, fileName: 'expected.png', rowNumber: 2 }] } }] };
    expect((await executeBulkStyleImport(actor, plan, 'old.xlsx')).results[0]!.outcome).toBe('COMPLETED');
    expect(await prisma.styleImage.count({ where: { styleId: style.id } })).toBe(2);
  });
  it('stores a newly imported Style image under its own styleId, never under the staging path', async () => {
    const { actor } = await setup();
    const plan = await planBulkStyleImport(embeddedWorkbook([['ST-PATH', 'Tee', 100, 'AW25', 'S', 'BC-PATH']], [{ row: 2, bytes: png }]), 'Styles');
    const summary = await executeBulkStyleImport(actor, plan, 'styles.xlsx');
    expect(summary.results[0]!.outcome).toBe('COMPLETED');
    const image = await prisma.styleImage.findFirstOrThrow({
      where: { styleId: summary.results[0]!.styleId! },
      include: { file: true },
    });
    expect(image.file.storageKey).toBe(`style-images/${summary.results[0]!.styleId}/${image.fileId}.png`);
    expect(await getFileStorage().exists(`style-images/staged/${image.fileId}.png`)).toBe(false);
    expect(await getFileStorage().read(image.file.storageKey)).toEqual(png);
  });
});
