import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { extractEmbeddedImagesByRow } from './xlsx-embedded-images.js';

// A valid, minimal 1x1 transparent PNG (real magic bytes + IHDR — this is
// what sniffImage() actually checks, so the fixture must be a real PNG, not
// just arbitrary bytes).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

interface FixtureOptions {
  /** One entry per anchored picture: [spreadsheetRow (1-indexed), image bytes]. Row N anchors at xdr:row N-1. */
  anchors?: Array<{ row0: number; mediaFile: string; rId: string }>;
  /** Media files to include, keyed by filename -> bytes. */
  media?: Record<string, Buffer>;
  /** Omit parts of the chain to exercise "no drawing" / "no rels" paths. */
  includeSheetRels?: boolean;
  includeDrawing?: boolean;
  includeDrawingRels?: boolean;
  /** Replace a media file's bytes with something that isn't a PNG. */
  corruptMedia?: boolean;
  /** Drop the picture's blip (image reference) entirely. */
  dropBlip?: boolean;
  /** Point the blip at an rId with no matching relationship. */
  danglingRid?: boolean;
}

function buildXlsxFixture(options: FixtureOptions = {}): Buffer {
  const {
    anchors = [{ row0: 1, mediaFile: 'image1.png', rId: 'rId1' }],
    media = { 'image1.png': TINY_PNG },
    includeSheetRels = true,
    includeDrawing = true,
    includeDrawingRels = true,
    corruptMedia = false,
    dropBlip = false,
    danglingRid = false,
  } = options;

  const zip = new AdmZip();

  zip.addFile(
    'xl/workbook.xml',
    Buffer.from(
      `<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
  );
  zip.addFile(
    'xl/_rels/workbook.xml.rels',
    Buffer.from(
      `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type=".../worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
  );
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet/>'));

  if (includeSheetRels) {
    zip.addFile(
      'xl/worksheets/_rels/sheet1.xml.rels',
      Buffer.from(
        `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type=".../drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      ),
    );
  }

  if (includeDrawing) {
    const anchorXml = anchors
      .map(
        (a) => `
      <xdr:twoCellAnchor>
        <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:pic>
          ${dropBlip ? '<xdr:blipFill></xdr:blipFill>' : `<xdr:blipFill><a:blip r:embed="${a.rId}"/></xdr:blipFill>`}
        </xdr:pic>
      </xdr:twoCellAnchor>`,
      )
      .join('\n');
    zip.addFile(
      'xl/drawings/drawing1.xml',
      Buffer.from(`<?xml version="1.0"?><xdr:wsDr xmlns:xdr="a" xmlns:a="b">${anchorXml}</xdr:wsDr>`),
    );
  }

  if (includeDrawingRels) {
    const rels = anchors
      .filter(() => !danglingRid)
      .map((a) => `<Relationship Id="${a.rId}" Type=".../image" Target="../media/${a.mediaFile}"/>`)
      .join('');
    zip.addFile('xl/drawings/_rels/drawing1.xml.rels', Buffer.from(`<?xml version="1.0"?><Relationships>${rels}</Relationships>`));
  }

  for (const [fileName, bytes] of Object.entries(media)) {
    zip.addFile(`xl/media/${fileName}`, corruptMedia ? Buffer.from('not a png') : bytes);
  }

  return zip.toBuffer();
}

describe('extractEmbeddedImagesByRow', () => {
  it('resolves a single embedded PNG to its 1-indexed spreadsheet row', () => {
    const buffer = buildXlsxFixture();
    const result = extractEmbeddedImagesByRow(buffer);

    expect(result.ambiguous).toEqual([]);
    expect(result.imagesByRow.size).toBe(1);
    const images = result.imagesByRow.get(2); // xdr:row 1 (0-indexed) -> spreadsheet row 2
    expect(images).toHaveLength(1);
    expect(images![0]!.fileName).toBe('image1.png');
    expect(images![0]!.buffer.equals(TINY_PNG)).toBe(true);
  });

  it('groups multiple images anchored to the same row (e.g. a gallery for one Style)', () => {
    const buffer = buildXlsxFixture({
      anchors: [
        { row0: 1, mediaFile: 'image1.png', rId: 'rId1' },
        { row0: 1, mediaFile: 'image2.png', rId: 'rId2' },
      ],
      media: { 'image1.png': TINY_PNG, 'image2.png': TINY_PNG },
    });
    const result = extractEmbeddedImagesByRow(buffer);

    expect(result.ambiguous).toEqual([]);
    expect(result.imagesByRow.get(2)).toHaveLength(2);
  });

  it('returns an empty result (not an error) for a workbook with no drawing at all', () => {
    const buffer = buildXlsxFixture({ includeSheetRels: false });
    const result = extractEmbeddedImagesByRow(buffer);

    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toEqual([]);
  });

  it('flags a non-PNG embedded image as ambiguous rather than attaching it', () => {
    const buffer = buildXlsxFixture({ corruptMedia: true });
    const result = extractEmbeddedImagesByRow(buffer);

    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: 'NON_PNG_IMAGE' })]);
  });

  it('flags a picture anchor with no image reference rather than guessing', () => {
    const buffer = buildXlsxFixture({ dropBlip: true });
    const result = extractEmbeddedImagesByRow(buffer);

    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: 'NO_IMAGE_REFERENCE' })]);
  });

  it('flags an image reference that does not resolve to any relationship', () => {
    const buffer = buildXlsxFixture({ danglingRid: true });
    const result = extractEmbeddedImagesByRow(buffer);

    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: 'UNRESOLVED_IMAGE_REFERENCE' })]);
  });

  it('returns an empty result for a non-zip / non-xlsx buffer rather than throwing', () => {
    const result = extractEmbeddedImagesByRow(Buffer.from('plain text, not a zip'));
    expect(result.imagesByRow.size).toBe(0);
    expect(result.ambiguous).toEqual([]);
  });
});
