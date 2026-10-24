import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyCorrections,
  businessSourceKey,
  parseBarcodeRows,
  readExplicitSheet,
  resolveCommercialIdentity,
  validateImageOwnership,
  storeCandidates,
  commercialConflicts,
  parseInvoiceLines,
  STYLE_HEADERS,
} from './master-source-normalization.js';
import { buildStylesWorkbook, runSourceNormalization } from './master-source-export.js';
import { extractEmbeddedImagesByRow } from './xlsx-embedded-images.js';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('historical source normalization', () => {
  it('preserves oversized spreadsheet evidence in checksum-linked JSON without Excel cell overflow', () => {
    const evidence = JSON.stringify({ raw: 'x'.repeat(32768) });
    const overflow = new Map<string, string>();
    const bytes = buildStylesWorkbook(
      [{ 'Style Name': '=1+1', 'Source Provenance': evidence }],
      [],
      overflow,
    );
    const sheet = XLSX.read(bytes, { type: 'buffer' }).Sheets.Styles!;
    // Columns are located by header name, not a hardcoded letter, so this
    // test doesn't silently break whenever a column is added/removed from
    // STYLE_HEADERS.
    const styleNameCell = XLSX.utils.encode_cell({ r: 1, c: STYLE_HEADERS.indexOf('Style Name') });
    const sourceProvenanceCell = XLSX.utils.encode_cell({
      r: 1,
      c: STYLE_HEADERS.indexOf('Source Provenance'),
    });
    expect(sheet[styleNameCell]).toMatchObject({ t: 's', v: '=1+1' });
    expect(sheet[styleNameCell].f).toBeUndefined();
    const reference = JSON.parse(sheet[sourceProvenanceCell].v as string);
    expect(reference.report).toBe('reports/oversized-cell-values.json');
    expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(overflow.get(reference.sha256)).toBe(evidence);
  });
  it('requires an explicit named worksheet and preserves blank physical rows and cached cell errors', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['decoy']]), 'Decoy');
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Season', 'Style Number', 'Barcode'],
      [],
      ['AW-25', 39042013, 'ABCDE39042013-3Y'],
    ]);
    sheet.D3 = { t: 'e', v: 7, w: '#DIV/0!' };
    sheet['!ref'] = 'A1:D3';
    XLSX.utils.book_append_sheet(wb, sheet, 'Selected');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const result = readExplicitSheet(bytes, 'Selected');
    expect(result.rows[2]?.rowNumber).toBe(3);
    expect(result.errors).toEqual([{ rowNumber: 3, column: 'D', value: '#DIV/0!' }]);
    expect(() => readExplicitSheet(bytes, 'Absent')).toThrow('Absent');
    expect(parseBarcodeRows(result.rows).records[0]).toMatchObject({
      rowNumber: 3,
      season: 'AW25',
      businessStyle: '39042013',
      size: '3',
      barcode: 'ABCDE39042013-3Y',
    });
  });
  it('uses verified AW25 PO transposition while retaining the commercial business style', () => {
    expect(
      resolveCommercialIdentity('AW25', '39042013', [{ season: 'AW25', lmix: 'LMIX39024013' }]),
    ).toEqual({ lmix: 'LMIX39024013', method: 'AW25_VERIFIED_DIGIT_TRANSPOSITION' });
    expect(
      resolveCommercialIdentity('SS26', '25426010', [{ season: 'SS26', lmix: 'LMIX25426010' }]),
    ).toEqual({ lmix: 'LMIX25426010', method: 'DIRECT_VERIFIED_PO' });
    expect(() =>
      resolveCommercialIdentity('AW25', '39042013', [
        { season: 'AW25', lmix: 'LMIX39024013' },
        { season: 'AW25', lmix: 'LMIX39042013' },
      ]),
    ).toThrow('Ambiguous');
  });
  it('rejects barcode ambiguity instead of shifting positional sizes or inventing sizes', () => {
    const result = parseBarcodeRows([
      { rowNumber: 1, cells: ['Season', 'Style\r\nNumber', 'Barcode'] },
      { rowNumber: 2, cells: ['AW-25', 12345678, 'ABCDE12345678-9Y'] },
      { rowNumber: 4, cells: ['AW-25', 12345678, 'FGHIJ12345678-9Y'] },
      { rowNumber: 5, cells: ['AW-25', 12345678, 'XX'] },
    ]);
    expect(result.exceptions.map((e) => e.code)).toEqual([
      'BARCODE_CONFLICT',
      'BARCODE_SIZE_UNRESOLVED',
    ]);
    expect(result.records).toHaveLength(3);
  });
  it('keeps destination addresses distinct and reports DRESSLAND and count conflicts without merging', () => {
    const rows = [
      { rowNumber: 4, cells: ['G S CLOTHING - STORES'] },
      ...[19, 23, 24].map((rowNumber, i) => ({
        rowNumber,
        cells: [i + 1, 'DRESSLAND', 'City', 'State', `Address ${i}`, 221005, '', '', 'GST'],
      })),
    ];
    const result = storeCandidates(rows);
    expect(new Set(result.records.map((r) => r['Source Key'])).size).toBe(3);
    expect(result.exceptions.some((e) => e.code === 'MULTIPLE_DESTINATIONS')).toBe(true);
    const conflicts = commercialConflicts(
      [
        { rowNumber: 3, cells: [null, 'S.NO', 'DISTRIBUTOR', 'NO.OF STORES'] },
        { rowNumber: 7, cells: [null, 4, 'GS CLOTHING', 25] },
      ],
      [
        { rowNumber: 3, cells: [null, 'S.NO', 'DISTRIBUTOR', 'NO.OF STORES'] },
        { rowNumber: 7, cells: [null, 4, 'GS CLOTHING', 21] },
      ],
      [
        { rowNumber: 3, cells: [null, 'S.NO', 'DISTRIBUTOR', 'NO.OF STORES'] },
        { rowNumber: 6, cells: [null, 3, 'GS CLOTHING', 20] },
      ],
    );
    expect(conflicts[0]).toMatchObject({ code: 'STORE_COUNT_CONFLICT' });
    expect(JSON.parse(conflicts[0]!.rawValues)).toEqual([25, 21, 20]);
    expect(conflicts[0]!.rowNumber).toBe(7);
  });
  it.each([
    ['factory', 'Name'],
    ['distributor', 'Name'],
    ['distributor', 'GSTIN'],
    ['style', 'Style Number'],
    ['style', 'LMIX Number'],
    ['style', 'Season Code'],
    ['style', 'Size Codes'],
    ['style', 'Barcodes'],
    ['style', 'Factory Name Mappings'],
  ])(
    'rejects unsupported %s reference corrections to %s instead of breaking other outputs',
    (kind, field) => {
      const key = businessSourceKey(kind!, ['identity']);
      const location = { sha256: 'a'.repeat(64), worksheet: 'Sheet', rowNumber: 2 };
      expect(() =>
        applyCorrections({ 'Source Key': key, [field!]: 'old' }, location, [
          {
            sourceKey: key,
            sourceSha256: location.sha256,
            worksheet: location.worksheet,
            rowNumber: 2,
            field: field!,
            previousValue: 'old',
            value: 'new',
            status: 'APPROVED',
            reviewedBy: 'Reviewer',
            reason: 'Reviewed change',
          },
        ]),
      ).toThrow('Reference-changing correction');
    },
  );
  it('binds reviewed corrections to exact checksum, worksheet, physical row and previous value, preserving the source key', () => {
    const key = businessSourceKey('store', ['Parent', 'Name', 'Old Address']);
    const row = {
      'Source Key': key,
      Name: 'Name',
      'Purchase Mode': '',
      'Address Line 1': 'Old Address',
    };
    const correction = {
      sourceSha256: 'a'.repeat(64),
      worksheet: 'Store Address',
      rowNumber: 19,
      sourceKey: key,
      field: 'Address Line 1',
      previousValue: 'Old Address',
      value: 'Reviewed address',
      status: 'APPROVED' as const,
      reviewedBy: 'Reviewer',
      reason: 'Verified documentary evidence',
    };
    expect(
      applyCorrections(row, { sha256: 'a'.repeat(64), worksheet: 'Store Address', rowNumber: 19 }, [
        correction,
      ]),
    ).toMatchObject({ 'Source Key': key, 'Address Line 1': 'Reviewed address' });
    expect(() =>
      applyCorrections(row, { sha256: 'b'.repeat(64), worksheet: 'Store Address', rowNumber: 19 }, [
        correction,
      ]),
    ).toThrow('checksum');
    expect(businessSourceKey('distributor', ['  Parent  ', 'GST'])).toBe(
      businessSourceKey('distributor', ['parent', 'gst']),
    );
  });
  it('rejects a correction field that only exists via the prototype chain', () => {
    const key = businessSourceKey('store', ['Parent', 'Name', 'Old Address']);
    const row = { 'Source Key': key, Name: 'Name' };
    const location = { sha256: 'a'.repeat(64), worksheet: 'Store Address', rowNumber: 19 };
    for (const field of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      expect(() =>
        applyCorrections(row, location, [
          {
            sourceSha256: location.sha256,
            worksheet: location.worksheet,
            rowNumber: location.rowNumber,
            sourceKey: key,
            field,
            previousValue: '',
            value: 'polluted',
            status: 'APPROVED' as const,
            reviewedBy: 'Reviewer',
            reason: 'Attempted prototype-chain correction',
          },
        ]),
      ).toThrow('Unsupported correction field');
    }
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });
  it('accepts only checksum verified images with matching PO identity and no extraction collision', () => {
    const source = {
      season: 'AW25',
      lmix: 'LMIX12345678',
      sourceSha256: 'source',
      imageSha256: 'image',
      imageOutcome: 'WRITTEN',
      imageCollision: null,
    };
    expect(
      validateImageOwnership(source, {
        ...source,
        actualImageSha256: 'image',
        actualSourceSha256: 'source',
      }),
    ).toBeNull();
    expect(
      validateImageOwnership(source, {
        ...source,
        lmix: 'LMIX87654321',
        actualImageSha256: 'image',
        actualSourceSha256: 'source',
      }),
    ).toContain('identity');
    expect(
      validateImageOwnership(source, {
        ...source,
        imageCollision: 'collision',
        actualImageSha256: 'image',
        actualSourceSha256: 'source',
      }),
    ).toContain('collision');
  });
  it('extracts invoice MRP separately from sales rates and HSN with physical PDF line provenance', () => {
    expect(
      parseInvoiceLines([
        'Header',
        '1 5826004 Boys Sweat Shirt - 5826004 DESERT DUST 3-12, 4-12, 5 61102000 2,199.00 72 Pcs 1,059.71 76,299.12',
      ]),
    ).toEqual([
      {
        lineNumber: 2,
        businessStyle: '5826004',
        hsn: '61102000',
        mrp: 2199,
        raw: '1 5826004 Boys Sweat Shirt - 5826004 DESERT DUST 3-12, 4-12, 5 61102000 2,199.00 72 Pcs 1,059.71 76,299.12',
      },
    ]);
  });
  it('embeds identical source PNG bytes only at their explicit Styles physical rows', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    const result = extractEmbeddedImagesByRow(
      buildStylesWorkbook(
        [{ 'Style Number': 'S1' }, { 'Style Number': 'S2' }],
        [{ rowNumber: 3, bytes: png }],
      ),
    );
    expect(result.imagesByRow.has(2)).toBe(false);
    expect(result.imagesByRow.get(3)?.[0]?.buffer.equals(png)).toBe(true);
  });
  it.each(['Factory', '=1+1', '+919876543210', '-1+1', '@SUM(1)', '\t=1+1', '  =1+1'])(
    'exports exact literal workbook values and holds formula-risk CSV rows for %j',
    async (factoryName) => {
      const root = await mkdtemp(join(tmpdir(), 'erve-source-fixture-'));
      try {
        const sourceRoot = join(root, 'source');
        const auditRoot = join(root, 'audit');
        const outputRoot = join(root, 'output');
        await mkdir(sourceRoot);
        await mkdir(join(auditRoot, 'corrected-pdf-parse'), { recursive: true });
        const workbook = (file: string, sheets: Record<string, unknown[][]>) => {
          const wb = XLSX.utils.book_new();
          for (const [name, rows] of Object.entries(sheets))
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
          return writeFile(
            join(sourceRoot, file),
            XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
          );
        };
        const mrpHeaders = [
          'Season',
          'Heads',
          'Description',
          "IP's",
          'Category',
          'Licensor',
          'Factory',
          'Base code',
          'MRP',
          'Exfactory',
          'Factory',
          'Colour',
          'Season',
        ];
        await workbook('AW26 - Dashboard.xlsx', {
          'MRP & Ex Factory': [
            mrpHeaders,
            [
              'AW-26',
              null,
              'Hoody',
              'IP',
              'Category',
              'Licensor',
              factoryName,
              12345678,
              999,
              100,
              factoryName,
              'Colour',
              'AW-26',
            ],
          ],
        });
        await workbook('Book1.xlsx', {
          Sheet1: [
            ['Season', 'Style Number', 'Barcode'],
            ['AW-26', 12345678, '3123456789'],
          ],
        });
        await workbook('Dispatch Qty and Store details AW26 - as on 12th Oct.xlsx', {
          'Store Address': [],
          'DeepStorewise Details': [],
          'Storewise Details factory': [],
          'Storewise dispatch address': [],
        });
        await writeFile(join(auditRoot, 'corrected-pdf-parse/source-staging.json'), '[]');
        await writeFile(join(auditRoot, 'image-provenance-comparison.json'), '[]');
        const result = await runSourceNormalization({
          sourceRoot,
          auditRoot,
          outputRoot,
          invoiceEvidence: [
            {
              lineNumber: 1,
              businessStyle: '12345678',
              hsn: '61091000',
              mrp: 1099,
              raw: 'source invoice evidence',
            },
          ],
        });
        expect(result.counts.styles).toBe(1);
        const styles = readExplicitSheet(
          await readFile(join(outputRoot, 'generated/styles.xlsx')),
          'Styles',
        );
        expect(styles.rows[1]?.cells[2]).toBe('');
        const manifest = JSON.parse(
          await readFile(join(outputRoot, 'reports/source-manifest.json'), 'utf8'),
        );
        expect(manifest.sources).toHaveLength(3);
        expect(
          manifest.sources.every((s: { sha256: string }) => /^[a-f0-9]{64}$/.test(s.sha256)),
        ).toBe(true);
        expect(result.exceptions.some((e) => e.code === 'MRP_CONFLICT')).toBe(true);
        expect(result.exceptions.some((e) => e.code === 'AW26_IMAGE_PROVENANCE_MISSING')).toBe(
          true,
        );
        await expect(
          readFile(join(outputRoot, 'generated/factories.csv'), 'utf8'),
        ).resolves.toContain('Name');
        const csvRows = XLSX.utils.sheet_to_json(
          XLSX.read(await readFile(join(outputRoot, 'generated/factories.csv')), {
            type: 'buffer',
            raw: true,
          }).Sheets.Sheet1!,
        );
        expect(csvRows).toHaveLength(factoryName === 'Factory' ? 1 : 0);
        const factories = readExplicitSheet(
          await readFile(join(outputRoot, 'generated/factories.xlsx')),
          'Factories',
        );
        expect(factories.rows[1]?.cells[0]).toBe(factoryName.trim());
        expect(result.exceptions.some((e) => e.code === 'CSV_FORMULA_RISK')).toBe(
          factoryName !== 'Factory',
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
