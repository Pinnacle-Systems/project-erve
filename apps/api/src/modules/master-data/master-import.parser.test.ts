import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseMasterImportFile, buildMasterImportWorkbook } from './master-import.parser.js';

function book(sheets: Record<string, unknown[][]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
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
