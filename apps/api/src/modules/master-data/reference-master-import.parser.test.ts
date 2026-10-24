import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseMasterImportFile } from './master-import.parser.js';

describe('reference master parsing', () => {
  it('maps Season and Size business-assigned columns', () => {
    expect(
      parseMasterImportFile(
        'seasons',
        Buffer.from('Season Code,Season Name,Barcode Serial\nAW26,Winter,\n'),
        's.csv',
      ).rows[0]?.input,
    ).toEqual({ code: 'AW26', name: 'Winter' });
    expect(
      parseMasterImportFile(
        'sizes',
        Buffer.from('Size Code,Size Label,Size Type,Sort Order\nxxs,Small,ALPHA,0\n'),
        's.csv',
      ).rows[0]?.input,
    ).toEqual({ code: 'xxs', label: 'Small', sizeType: 'ALPHA', sortOrder: '0' });
  });
  it('preserves literal leading zeroes in CSV', () => {
    expect(
      parseMasterImportFile('hsns', Buffer.from('HSN Code,Description\n01234567,Text\n'), 'h.csv')
        .rows[0]?.input.code,
    ).toBe('01234567');
  });
  it('rejects padded numeric HSN cells rather than reconstructing digits', () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['HSN Code'], [1234567]]);
    sheet.A2.z = '00000000';
    XLSX.utils.book_append_sheet(book, sheet, 'HSNs');
    const rows = parseMasterImportFile(
      'hsns',
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'h.xlsx',
      'HSNs',
    ).rows;
    expect(rows[0]?.error).toMatch(/numeric.*leading zero/i);
  });
  it('rejects unexpected statutory configuration columns', () => {
    expect(() =>
      parseMasterImportFile(
        'hsns',
        Buffer.from('HSN Code,GST Rule Set\n12345678,DEFAULT\n'),
        'h.csv',
      ),
    ).toThrow(/GST/);
  });
  it.each([
    ['seasons', 'Season Code\nAW26'],
    ['sizes', 'Size Code,Size Label,Size Type\nS,Small,ALPHA'],
    ['hsns', 'Description\nMissing'],
  ] as const)('requires complete headers for %s', (kind, csv) => {
    expect(() => parseMasterImportFile(kind, Buffer.from(csv), 'm.csv')).toThrow(
      /Missing required header/,
    );
  });
});
