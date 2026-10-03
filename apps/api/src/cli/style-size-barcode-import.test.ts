import * as XLSX from 'xlsx';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import { createTestFinancialYear, resetDatabase } from '../test/helpers.js';
import {
  executeBarcodeImport,
  loadCatalog,
  parseBarcodeSheet,
  parseLegacyBarcodeBook,
  planBarcodeImport,
  summarizeImport,
  type SheetRow,
} from './style-size-barcode-import.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// The three historical barcode regimes: AW25 and SS26 carry their own
// supplied values (no Barcode Serial); AW26 is the first serial-prefixed season.
async function seed() {
  const fy = await createTestFinancialYear();
  const season = async (code: string, serial: number | null) => {
    const id = createId();
    await prisma.season.create({ data: { id, code, name: code, financialYearId: fy.id, barcodeSerial: serial } });
    return id;
  };
  const size = (label: string) =>
    prisma.size.create({ data: { id: createId(), code: `AGE_${label}`, label, sizeType: 'AGE', sortOrder: Number(label) } });
  const [aw25, ss26, aw26] = [await season('AW25', null), await season('SS26', null), await season('AW26', 3)];
  const [s3, s4] = [await size('3'), await size('4')];
  const style = async (
    seasonId: string,
    styleNumber: string,
    lmix: string,
    sizes = [s3, s4],
    barcodes: Array<string | null> = [],
  ) => {
    const id = createId();
    await prisma.style.create({ data: { id, styleNumber, styleName: 'S', lmixNumber: lmix, finalMrp: 1, seasonId } });
    for (const [i, s] of sizes.entries()) {
      await prisma.styleSize.create({ data: { id: createId(), styleId: id, sizeId: s.id, barcode: barcodes[i] ?? null } });
    }
    return id;
  };
  return { aw25, ss26, aw26, s3, s4, style };
}

const row = (overrides: Partial<SheetRow>): SheetRow => ({
  rowNumber: 2,
  styleNumber: '',
  season: '',
  lmix: '',
  size: '3',
  barcode: 'X-1',
  ...overrides,
});
const plan = async (rows: SheetRow[]) => planBarcodeImport(rows, await loadCatalog());

describe('parseBarcodeSheet', () => {
  const book = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('reads headers case-insensitively, keeps barcodes as text, and numbers rows like the sheet', () => {
    const rows = parseBarcodeSheet(
      book([
        ['barcode', 'SIZE', 'Style Number'],
        ['00123456', '3Y', 'ST-1'],
        ['BJGGR26042008-3Y', '4Y', 'ST-2'],
      ]),
    );
    expect(rows).toEqual([
      { rowNumber: 2, styleNumber: 'ST-1', season: '', lmix: '', size: '3Y', barcode: '00123456' },
      { rowNumber: 3, styleNumber: 'ST-2', season: '', lmix: '', size: '4Y', barcode: 'BJGGR26042008-3Y' },
    ]);
  });

  it('accepts Season + LMIX as the Style identifier and rejects sheets that cannot identify rows', () => {
    expect(parseBarcodeSheet(book([['Barcode', 'Size', 'Season', 'LMIX'], ['1', '3', 'SS26', 'LMIX9']]))).toHaveLength(1);
    expect(() => parseBarcodeSheet(book([['Barcode', 'Size'], ['1', '3']]))).toThrow(/Style Number/);
    expect(() => parseBarcodeSheet(book([['Size', 'Style Number'], ['3', 'A']]))).toThrow(/Barcode/);
  });
});

describe('parseLegacyBarcodeBook (Book1 layout, no Size column)', () => {
  const book = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const header = [' Season ', ' Style\r\nNumber ', ' Barcode '];

  it('derives each size from the barcode under the AW25 / SS26 / AW26 regime rules', () => {
    const rows = parseLegacyBarcodeBook(
      book([
        header,
        ['AW-25', '26042008', 'BJGGR26042008-3Y'],
        ['AW-25', '26042008', 'BJGGR26042008-10Y'],
        ['SS-26', '39026006', '390260063'],
        ['SS-26', '39026006', '3902600610'],
        ['AW-26', '5826005', '358260053'], // 7-digit LMIX
        ['AW-26', '35126003', '33512600314'],
      ]),
    );
    expect(rows.map((r) => [r.season, r.lmix, r.size, r.barcode])).toEqual([
      ['AW25', 'LMIX26024008', '3', 'BJGGR26042008-3Y'],
      ['AW25', 'LMIX26024008', '10', 'BJGGR26042008-10Y'],
      ['SS26', 'LMIX39026006', '3', '390260063'],
      ['SS26', 'LMIX39026006', '10', '3902600610'],
      ['AW26', 'LMIX5826005', '3', '358260053'],
      ['AW26', 'LMIX35126003', '14', '33512600314'],
    ]);
  });

  it('never guesses: a barcode that does not fit its season regime gets no size and is rejected by the plan', async () => {
    const rows = parseLegacyBarcodeBook(
      book([
        header,
        ['AW-25', '26042008', 'BJGGR99999999-3Y'], // LMIX in barcode differs from the row's
        ['SS-26', '39026006', '390260063X'],
        ['AW-26', '35126003', '2351260033'], // wrong serial prefix
        ['AW-27', '11111111', '1111111113'], // regime unknown
      ]),
    );
    expect(rows.map((r) => r.size)).toEqual(['', '', '', '']);
    expect(summarizeImport(await plan(rows))).toMatchObject({ wouldSet: 0, rejected: 4 });
  });

  it('feeds the importer: Season + LMIX identifies the Style, the derived size picks the mapping', async () => {
    const s = await seed();
    await s.style(s.ss26, 'SS26-39026006', 'LMIX39026006');
    const rows = parseLegacyBarcodeBook(book([header, ['SS-26', '39026006', '390260063'], ['SS-26', '39026006', '390260064']]));

    const result = await plan(rows);

    expect(result.wouldSet.map((r) => r.barcode)).toEqual(['390260063', '390260064']);
  });

  it('requires the Season, Style Number and Barcode headers', () => {
    expect(() => parseLegacyBarcodeBook(book([['Season', 'Barcode'], ['AW-25', '1']]))).toThrow(/Style Number/);
  });
});

describe('planBarcodeImport', () => {
  it('sets supplied barcodes exactly as written for every regime, with no regeneration', async () => {
    const s = await seed();
    await s.style(s.aw25, 'AW25-1', 'LMIX1111');
    await s.style(s.ss26, 'SS26-1', 'LMIX2222');
    await s.style(s.aw26, 'AW26-1', 'LMIX3333');

    const result = await plan([
      row({ rowNumber: 2, styleNumber: 'AW25-1', size: '3Y', barcode: 'BJGGR26042008-3Y' }), // alphanumeric
      row({ rowNumber: 3, styleNumber: 'SS26-1', size: '3', barcode: '22223' }), // LMIX + size, no prefix
      row({ rowNumber: 4, styleNumber: 'AW26-1', size: 'AGE_4', barcode: '3333334' }), // serial 3 + LMIX + size
    ]);

    expect(summarizeImport(result)).toMatchObject({ wouldSet: 3, rejected: 0 });
    expect(result.wouldSet.map((r) => r.barcode)).toEqual(['BJGGR26042008-3Y', '22223', '3333334']);
  });

  it('identifies a Style by Season + LMIX and rejects ambiguity or absence', async () => {
    const s = await seed();
    await s.style(s.ss26, 'SS26-1', 'LMIX2222');
    await s.style(s.ss26, 'SS26-A', 'LMIX5555');
    await s.style(s.ss26, 'SS26-B', 'LMIX5555');

    const result = await plan([
      row({ rowNumber: 2, season: 'SS26', lmix: 'LMIX2222', barcode: 'A1' }),
      row({ rowNumber: 3, season: 'SS26', lmix: 'LMIX5555', barcode: 'A2' }),
      row({ rowNumber: 4, season: 'SS26', lmix: 'LMIX0000', barcode: 'A3' }),
    ]);

    expect(result.wouldSet).toHaveLength(1);
    expect(result.rejected.AMBIGUOUS_STYLE).toHaveLength(1);
    expect(result.rejected.UNKNOWN_STYLE).toHaveLength(1);
  });

  it('rejects unknown Style, unknown Size, an unmapped size, bad barcodes and malformed rows', async () => {
    const s = await seed();
    await s.style(s.aw26, 'AW26-1', 'LMIX3333', [s.s3]);

    const result = await plan([
      row({ rowNumber: 2, styleNumber: 'NOPE', barcode: 'B1' }),
      row({ rowNumber: 3, styleNumber: 'AW26-1', size: 'XL', barcode: 'B2' }),
      row({ rowNumber: 4, styleNumber: 'AW26-1', size: '4', barcode: 'B3' }),
      row({ rowNumber: 5, styleNumber: 'AW26-1', size: '3', barcode: 'has space' }),
      row({ rowNumber: 6, styleNumber: 'AW26-1', size: '', barcode: 'B5' }),
    ]);

    expect(summarizeImport(result)).toMatchObject({ wouldSet: 0, rejected: 5 });
    expect(result.rejected.UNKNOWN_STYLE).toHaveLength(1);
    expect(result.rejected.UNKNOWN_SIZE).toHaveLength(1);
    expect(result.rejected.MAPPING_NOT_FOUND).toHaveLength(1);
    expect(result.rejected.INVALID_BARCODE).toHaveLength(1);
    expect(result.rejected.MALFORMED_ROW).toHaveLength(1);
  });

  it('detects duplicate barcodes in the file, contradictory rows, and identical repeats', async () => {
    const s = await seed();
    await s.style(s.aw26, 'AW26-1', 'LMIX3333');

    const dup = await plan([
      row({ rowNumber: 2, styleNumber: 'AW26-1', size: '3', barcode: 'DUP' }),
      row({ rowNumber: 3, styleNumber: 'AW26-1', size: '4', barcode: 'DUP' }),
    ]);
    expect(dup.rejected.DUPLICATE_BARCODE_IN_FILE).toHaveLength(2);
    expect(dup.wouldSet).toHaveLength(0);

    const conflicting = await plan([
      row({ rowNumber: 2, styleNumber: 'AW26-1', size: '3', barcode: 'P1' }),
      row({ rowNumber: 3, styleNumber: 'AW26-1', size: '3', barcode: 'P2' }),
    ]);
    expect(conflicting.rejected.CONFLICTING_ROWS).toHaveLength(2);

    const repeat = await plan([
      row({ rowNumber: 2, styleNumber: 'AW26-1', size: '3', barcode: 'P1' }),
      row({ rowNumber: 3, styleNumber: 'AW26-1', size: '3Y', barcode: 'P1' }),
    ]);
    expect(repeat.wouldSet).toHaveLength(1);
    expect(repeat.duplicateRows).toHaveLength(1);
  });

  it('never overwrites a different existing barcode and never steals one held elsewhere', async () => {
    const s = await seed();
    await s.style(s.aw25, 'AW25-1', 'LMIX1111', [s.s3, s.s4], ['KEEP-ME', 'HELD-1']);
    await s.style(s.ss26, 'SS26-1', 'LMIX2222');
    await s.style(s.aw26, 'AW26-1', 'LMIX3333', [s.s3], ['HELD-2']);

    const result = await plan([
      row({ rowNumber: 2, styleNumber: 'AW25-1', size: '3', barcode: 'NEW-VALUE' }), // existing differs
      row({ rowNumber: 3, styleNumber: 'AW25-1', size: '4', barcode: 'HELD-1' }), // already applied
      row({ rowNumber: 4, styleNumber: 'SS26-1', size: '3', barcode: 'HELD-2' }), // held by another
    ]);

    expect(result.rejected.EXISTING_BARCODE_DIFFERS).toHaveLength(1);
    expect(result.alreadyApplied).toHaveLength(1);
    expect(result.rejected.BARCODE_ASSIGNED_ELSEWHERE).toHaveLength(1);
    expect(result.wouldSet).toHaveLength(0);
  });
});

describe('executeBarcodeImport', () => {
  it('planning is read-only; execution writes only planned NULL rows and is idempotent', async () => {
    const s = await seed();
    await s.style(s.aw25, 'AW25-1', 'LMIX1111', [s.s3, s.s4], ['KEEP-ME', null]);
    const snapshot = () => prisma.styleSize.findMany({ select: { id: true, barcode: true }, orderBy: { id: 'asc' } });
    const before = await snapshot();
    const rows = [
      row({ rowNumber: 2, styleNumber: 'AW25-1', size: '3', barcode: 'DIFFERENT' }),
      row({ rowNumber: 3, styleNumber: 'AW25-1', size: '4', barcode: 'BJGGR26042008-4Y' }),
    ];

    const planned = await plan(rows);
    expect(await snapshot()).toEqual(before);

    expect(await executeBarcodeImport(planned, 1)).toEqual({ written: 1, skippedFilled: 0 });
    const written = await prisma.styleSize.findMany({ include: { size: true } });
    expect(Object.fromEntries(written.map((r) => [r.size.label, r.barcode]))).toEqual({
      '3': 'KEEP-ME',
      '4': 'BJGGR26042008-4Y',
    });
    expect((await executeBarcodeImport(await plan(rows))).written).toBe(0);
  });

  it('does not overwrite a row filled between planning and writing', async () => {
    const s = await seed();
    await s.style(s.aw26, 'AW26-1', 'LMIX3333', [s.s3]);
    const planned = await plan([row({ styleNumber: 'AW26-1', size: '3', barcode: 'P1' })]);
    await prisma.styleSize.updateMany({ data: { barcode: 'FILLED-ELSEWHERE' } });

    expect(await executeBarcodeImport(planned)).toEqual({ written: 0, skippedFilled: 1 });
  });
});
