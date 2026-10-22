import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfStyleSizeMatrix } from './PdfStyleSizeMatrix.js';

it('preserves absent, null, zero and per-row imagery with page-aware headers', async () => {
  const blob = await pdf(
    <PdfDocument orientation="landscape" experimentalPagination>
      <PdfStyleSizeMatrix
        repeatPageHeaders
        keepBoundaryRows
        columns={['ZERO', 'NULL', 'ABSENT'].map((sizeCode) => ({ sizeId: sizeCode, sizeCode }))}
        rows={Array.from({ length: 40 }, (_, n) => ({
          styleId: `row-${n}`,
          styleNumber: `IDENTITY-${n}`,
          values: { ZERO: 0, NULL: null },
          image: {
            dataUri:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          },
        }))}
      />
    </PdfDocument>,
  ).toBlob();
  const task = getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    expect(doc.numPages).toBeGreaterThan(1);
    const identities: string[] = [];
    let images = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = (await page.getTextContent()).items.flatMap((item) =>
        'str' in item && item.str.trim() ? [item] : [],
      );
      const header = items.find((i) => i.str === 'Style')!;
      const zero = items.find((i) => i.str === 'ZERO')!;
      const blank = items.find((i) => i.str === 'NULL')!;
      const absent = items.find((i) => i.str === 'ABSENT')!;
      const rows = items.filter((i) => i.str.startsWith('IDENTITY-'));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(header.transform[5]!).toBeGreaterThan(row.transform[5]!);
        identities.push(row.str);
      }
      // Only the ZERO and row-Total columns render 0; NULL stays blank and ABSENT renders a dash.
      expect(items.filter((i) => i.str === '—')).toHaveLength(rows.length);
      expect(
        items.filter(
          (i) =>
            Math.abs(i.transform[4]! + i.width - blank.transform[4]! - blank.width) < 0.1 &&
            rows.some((row) => Math.abs(row.transform[5]! - i.transform[5]!) < 0.1),
        ),
      ).toHaveLength(0);
      expect(
        items.filter(
          (i) =>
            i.str === '0' &&
            Math.abs(i.transform[4]! + i.width - zero.transform[4]! - zero.width) < 0.1,
        ).length,
      ).toBeGreaterThanOrEqual(rows.length);
      expect(
        items
          .filter((i) => i.str === '—')
          .every(
            (i) => Math.abs(i.transform[4]! + i.width - absent.transform[4]! - absent.width) < 0.1,
          ),
      ).toBe(true);
      const ops = await page.getOperatorList();
      images += ops.fnArray.filter((op) =>
        [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat].includes(
          op,
        ),
      ).length;
    }
    expect(new Set(identities).size).toBe(40);
    expect(identities).toHaveLength(40);
    expect(images).toBe(40);
  } finally {
    await task.destroy();
  }
}, 30000);
