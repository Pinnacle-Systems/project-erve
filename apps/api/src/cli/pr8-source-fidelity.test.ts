import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { assertCanonicalStyleMetadata } from './pr8-source-fidelity.js';
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  book,
  XLSX.utils.json_to_sheet([
    {
      'Style Number': 'ST-001',
      'IP Name': 'Source IP',
      Licensor: 'Source Licensor',
      Colour: 'Blue',
      Description: 'Source Description',
      Category: 'Source Category',
    },
  ]),
  'Styles',
);
const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
it('rejects a semantically stable rebuild that dropped canonical descriptive values', () => {
  expect(() =>
    assertCanonicalStyleMetadata(
      {
        business: {
          styles: [{ styleNumber: 'ST-001', ipName: null, licensor: null, colour: null }],
        },
      },
      bytes,
      'Styles',
    ),
  ).toThrow('IP Name');
});
it('proves each loaded Style against the supplied canonical metadata, not merely another rebuild', () => {
  expect(
    assertCanonicalStyleMetadata(
      {
        business: {
          styles: [
            {
              styleNumber: 'ST-001',
              ipName: 'Source IP',
              licensor: 'Source Licensor',
              colour: 'Blue',
              description: 'Source Description',
              categoryDescription: 'Source Category',
            },
          ],
        },
      },
      bytes,
      'Styles',
    ),
  ).toEqual({ status: 'PASS', stylesChecked: 1, valuesChecked: 5 });
});
it('allows only the explicitly identified and labeled additional engineering Style', () => {
  const source = {
    styleNumber: 'ST-001',
    ipName: 'Source IP',
    licensor: 'Source Licensor',
    colour: 'Blue',
    description: 'Source Description',
    categoryDescription: 'Source Category',
  };
  const options = { allowedSyntheticStyleNumbers: ['PR8-SYNTHETIC-001'] };
  expect(
    assertCanonicalStyleMetadata(
      {
        business: {
          styles: [
            source,
            { styleNumber: 'PR8-SYNTHETIC-001', styleName: 'PR8 ENGINEERING ONLY STYLE' },
          ],
        },
      },
      bytes,
      'Styles',
      options,
    ).stylesChecked,
  ).toBe(1);
  expect(() =>
    assertCanonicalStyleMetadata(
      {
        business: {
          styles: [source, { styleNumber: 'PR8-SYNTHETIC-001', styleName: 'Unidentified master' }],
        },
      },
      bytes,
      'Styles',
      options,
    ),
  ).toThrow('source identity');
});
