import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import {
  extractEmbeddedImagesByRow,
  extractNormalizedEmbeddedImagesByRow,
} from './xlsx-embedded-images.js';
import { pictureInCellFixture, tinyPng } from './picture-in-cell.fixture.js';

describe('Picture-in-Cell images', () => {
  it.each(['part', 'future'] as const)(
    'rejects competing singleton metadata mappings (%s)',
    (kind) => {
      const zip = new AdmZip(pictureInCellFixture());
      const owner = kind === 'part' ? 'xl/_rels/workbook.xml.rels' : 'xl/metadata.xml';
      const content = zip.getEntry(owner)!.getData().toString();
      zip.addFile(
        owner,
        Buffer.from(
          kind === 'part'
            ? content.replace(
                '</Relationships>',
                '<Relationship Id="competing" Type="x/rdRichValue" Target="richData/other.xml"/></Relationships>',
              )
            : content.replace(
                '</metadata>',
                '<futureMetadata name="XLRICHVALUE"><bk><extLst><ext><rd:rvb i="99"/></ext></extLst></bk></futureMetadata></metadata>',
              ),
        ),
      );
      const result = extractEmbeddedImagesByRow(zip.toBuffer(), 'Styles');
      expect(result.imagesByRow.size).toBe(0);
      expect(result.ambiguous[0]?.detail).toMatch(/ambiguous/);
    },
  );
  it.each([false, true])(
    'resolves structure keys, metadata indirection and packaged media (web=%s)',
    (web) => {
      const buffer = pictureInCellFixture({ web });
      expect(extractEmbeddedImagesByRow(buffer, 'Cover').imagesByRow.size).toBe(0);
      const result = extractEmbeddedImagesByRow(buffer, 'Styles');
      expect(result.ambiguous).toEqual([]);
      expect(result.imagesByRow.get(7)?.[0]).toMatchObject({
        buffer: tinyPng,
        cellReference: 'D7',
      });
    },
  );
  it('deduplicates the same cell/media across modern and anchored representations', () => {
    expect(
      extractEmbeddedImagesByRow(pictureInCellFixture({ mixed: true }), 'Styles').imagesByRow.get(
        7,
      ),
    ).toHaveLength(1);
  });
  it('preserves equal image bytes in distinct physical cells on one Style row', () => {
    expect(
      extractEmbeddedImagesByRow(
        pictureInCellFixture({ cells: ['D7', 'F7', 'D11'] }),
        'Styles',
      ).imagesByRow.get(7),
    ).toHaveLength(2);
  });
  it('rejects duplicate physical cell ownership rather than attaching both references', () => {
    const result = extractEmbeddedImagesByRow(
      pictureInCellFixture({ cells: ['D7', 'D7'] }),
      'Styles',
    );
    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous[0]?.detail).toMatch(/ambiguous/);
  });
  it.each([{ missing: true }, { invalid: true }, { invalidType: true }, { external: true }])(
    'reports invalid mappings/media without guessing: %j',
    (options) => {
      const result = extractEmbeddedImagesByRow(pictureInCellFixture(options), 'Styles');
      expect(result.imagesByRow.size).toBe(0);
      expect(result.ambiguous[0]).toMatchObject({ rowNumber: 7 });
    },
  );
  it('does not mistake valid non-image rich data for missing images on the selected sheet', () => {
    const result = extractEmbeddedImagesByRow(pictureInCellFixture({ nonImage: true }), 'Styles');
    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toEqual([]);
    expect(result.imageMetadataPresent).not.toBe(true);
  });
  it('converts mislabeled JPEG to valid PNG while retaining original checksum and physical mapping', async () => {
    const jpeg = await sharp(tinyPng).jpeg().toBuffer();
    const result = await extractNormalizedEmbeddedImagesByRow(
      pictureInCellFixture({ media: jpeg, web: true }),
      'Styles',
    );
    const image = result.imagesByRow.get(7)![0]!;
    expect((await sharp(image.buffer).metadata()).format).toBe('png');
    expect(image.sourceFormat).toBe('jpg');
    expect(image.originalChecksum).not.toBe(image.normalizedChecksum);
    expect(image.cellReference).toBe('D7');
  });
  it('preserves native PNG bytes without recompression', async () => {
    const result = await extractNormalizedEmbeddedImagesByRow(pictureInCellFixture(), 'Styles');
    expect(result.imagesByRow.get(7)![0]!.buffer).toEqual(tinyPng);
  });
  it('rejects corrupt signature-only content', async () => {
    const result = await extractNormalizedEmbeddedImagesByRow(
      pictureInCellFixture({ media: tinyPng.subarray(0, 24) }),
      'Styles',
    );
    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toHaveLength(1);
  });
});
