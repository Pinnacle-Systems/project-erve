import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseMasterImportFile,
  buildMasterImportWorkbook,
  buildMasterImportTemplate,
  listMasterImportWorksheets,
  masterImportHeaders,
  masterImportWorksheets,
} from './master-import.parser.js';

function book(sheets: Record<string, unknown[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
describe('downloadable business master templates (ISS-036)', () => {
  const samples = {
    seasons: { 'Season Code': 'SS', 'Season Name': 'Summer' },
    sizes: { 'Size Code': 'M', 'Size Label': 'Medium', 'Size Type': 'ALPHA', 'Sort Order': '2' },
    hsns: { 'HSN Code': '01234567', Description: 'Knitwear' },
    factories: { Name: 'Factory One' },
    distributors: { Name: 'Distributor One', GSTIN: '22AAAAA0000A1Z5' },
    'retail-stores': {
      Name: 'Retail Store',
      'Address Line 1': '123 Example Road',
      City: 'Chennai',
      State: 'Tamil Nadu',
      'Postal Code': '600001',
    },
  };

  it.each(Object.keys(samples) as Array<keyof typeof samples>)(
    'exports %s with business-only headers and accepts a filled-in copy',
    (kind) => {
      const workbook = XLSX.read(buildMasterImportTemplate(kind), { type: 'buffer' });
      expect(workbook.SheetNames).toEqual([masterImportWorksheets[kind], 'Instructions']);
      expect(listMasterImportWorksheets(buildMasterImportTemplate(kind), 'template.xlsx')).toEqual([
        masterImportWorksheets[kind],
      ]);
      expect(() =>
        parseMasterImportFile(
          kind,
          buildMasterImportTemplate(kind),
          'template.xlsx',
          'Instructions',
        ),
      ).toThrow(/instruction/i);
      expect(
        parseMasterImportFile(
          kind,
          buildMasterImportTemplate(kind),
          'template.xlsx',
          masterImportWorksheets[kind],
        ).rows,
      ).toEqual([]);
      expect(
        XLSX.utils.sheet_to_json(workbook.Sheets.Instructions!, { header: 1 }).length,
      ).toBeGreaterThan(5);
      const sheet = workbook.Sheets[masterImportWorksheets[kind]]!;
      const header = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? []).map(
        String,
      );
      expect(header).toEqual(
        masterImportHeaders[kind].filter(
          (name) => !['Source Key', 'Source Provenance'].includes(name),
        ),
      );
      expect(header).not.toContain('Source Key');
      expect(header).not.toContain('Source Provenance');
      const example = samples[kind] as Record<string, string>;
      XLSX.utils.sheet_add_aoa(sheet, [header.map((name) => example[name] ?? '')], {
        origin: 'A2',
      });
      const filled = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      const parsed = parseMasterImportFile(
        kind,
        filled,
        'filled-template.xlsx',
        masterImportWorksheets[kind],
      );
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.sourceKey).toBeUndefined();
      for (const [headerName, value] of Object.entries(example)) {
        expect(parsed.rows[0]?.raw[headerName]).toBe(value);
      }
    },
  );

  it('rejects renamed instructions and their CSV export instead of treating guidance as records', () => {
    const workbook = XLSX.read(buildMasterImportTemplate('factories'), { type: 'buffer' });
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets.Instructions!);
    expect(() => parseMasterImportFile('factories', Buffer.from(csv), 'instructions.csv')).toThrow(
      /Instruction/,
    );
    workbook.Sheets.Factories = workbook.Sheets.Instructions!;
    expect(() =>
      parseMasterImportFile(
        'factories',
        XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
        'renamed.xlsx',
        'Factories',
      ),
    ).toThrow(/Instruction/);
  });
  it('continues to accept legacy source-key columns without changing provenance parsing', () => {
    const parsed = parseMasterImportFile(
      'factories',
      book({
        Factories: [
          ['Name', 'Source Key', 'Source Provenance'],
          ['Factory One', 'external-factory-01', 'historical upload'],
        ],
      }),
      'legacy.xlsx',
      'Factories',
    );
    expect(parsed.rows[0]?.sourceKey).toBe('external-factory-01');
    expect(parsed.rows[0]?.raw['Source Provenance']).toBe('historical upload');
  });
});

describe('business master import parsing', () => {
  it('retains a physical row containing only a cached Excel error', () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Name'], ['placeholder']]);
    sheet.A2 = { t: 'e', v: 7 };
    XLSX.utils.book_append_sheet(wb, sheet, 'Factories');
    const parsed = parseMasterImportFile(
      'factories',
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      'bad.xlsx',
      'Factories',
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      error: expect.stringContaining('cached'),
    });
  });
  it('preserves untrusted header evidence without prototype-derived field mappings', () => {
    const parsed = parseMasterImportFile(
      'factories',
      Buffer.from('Name,__proto__,constructor,Code\nFactory,value,other,FAC-999999\n'),
      'file.csv',
    );
    expect(parsed.rows[0]!.raw['__proto__']).toBe('value');
    expect(parsed.rows[0]!.input).toEqual({ name: 'Factory' });
  });
  it('selects an explicit sheet, preserves physical rows, and maps canonical contact headers', () => {
    const rows = parseMasterImportFile(
      'factories',
      book({
        Cover: [['wrong']],
        Factories: [
          ['Name', 'Contact Person', 'Phone', 'Email', 'Source Key'],
          [],
          ['Factory One', 'Person', '+919876543210', 'person@example.test', 'source-one'],
        ],
      }),
      'masters.xlsx',
      'Factories',
    );
    expect(rows.rows).toEqual([
      {
        rowNumber: 3,
        raw: {
          Name: 'Factory One',
          'Contact Person': 'Person',
          Phone: '+919876543210',
          Email: 'person@example.test',
          'Source Key': 'source-one',
        },
        input: {
          name: 'Factory One',
          contactName: 'Person',
          contactPhone: '+919876543210',
          contactEmail: 'person@example.test',
        },
        sourceKey: 'source-one',
      },
    ]);
    expect(() =>
      parseMasterImportFile('factories', book({ Factories: [['Name']] }), 'file.xlsx'),
    ).toThrow('worksheet');
  });
  it('accepts CSV without coercing phone numbers, source keys or codes into numbers', () => {
    const parsed = parseMasterImportFile(
      'distributors',
      Buffer.from(
        'Name,GSTIN,Purchase Mode,Phone\r\nDistributor One,22AAAAA0000A1Z5,,0012345678\r\n',
      ),
      'file.csv',
    );
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      input: { name: 'Distributor One', gstin: '22AAAAA0000A1Z5', contactPhone: '0012345678' },
    });
    expect(parsed.rows[0]!.input).not.toHaveProperty('purchaseMode');
  });
  it('rejects missing headers and duplicated semantic headers rather than guessing', () => {
    expect(() =>
      parseMasterImportFile('factories', Buffer.from('Code\nFAC1\n'), 'bad.csv'),
    ).toThrow('Name');
    expect(() =>
      parseMasterImportFile('factories', Buffer.from('Name,Name\nA,B\n'), 'bad.csv'),
    ).toThrow('Duplicate');
  });
  it('rejects a cached Excel error on its physical row', () => {
    const wb = XLSX.read(
      book({
        Factories: [
          ['Name', 'Email'],
          ['Factory', 'mail@example.test'],
        ],
      }),
      { type: 'buffer' },
    );
    wb.Sheets.Factories!.B2 = { t: 'e', v: 7 };
    const parsed = parseMasterImportFile(
      'factories',
      XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      'bad.xlsx',
      'Factories',
    );
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      error: expect.stringContaining('cached'),
    });
  });
  it('exports exceptions as literal text without evaluating formula-like customer values', () => {
    const bytes = buildMasterImportWorkbook(
      ['Name', 'Reason'],
      [['=1+1', '@review']],
      'Exceptions',
    );
    const sheet = XLSX.read(bytes, { type: 'buffer' }).Sheets.Exceptions!;
    expect(sheet.A2).toMatchObject({ t: 's', v: '=1+1' });
    expect(sheet.A2.f).toBeUndefined();
  });
});
