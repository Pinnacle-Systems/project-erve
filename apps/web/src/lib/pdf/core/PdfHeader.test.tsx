import { Text, View } from '@react-pdf/renderer';
import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfHeader } from './PdfHeader.js';
import { PdfFooter } from './PdfFooter.js';

describe('ISS-018 shared ERVE logo branding in PDFs', () => {
  it.each(['portrait', 'landscape'] as const)(
    'embeds the original ERVE artwork and readable document identity in %s PDFs',
    async (orientation) => {
      const blob = await pdf(
        <PdfDocument orientation={orientation}>
          <PdfHeader title="FACTORY INVOICE" subtitle="EIFI/26-27/0001" />
          <PdfFooter />
        </PdfDocument>,
      ).toBlob();
      const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
      try {
        const document = await task.promise;
        expect(document.numPages).toBe(1);
        const page = await document.getPage(1);
        const text = (await page.getTextContent()).items
          .map((item) => ('str' in item ? item.str : '')).join(' ');
        expect(text).toContain('FACTORY INVOICE');
        expect(text).toContain('EIFI/26-27/0001');
        const operators = await page.getOperatorList();
        expect(operators.fnArray).toContain(OPS.paintImageXObject);
      } finally {
        await task.destroy();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// ISS-043: the logo was rendering at an effective ~86x11.8pt (its actual
// 1117x153px / ~7.3:1 artwork squeezed into an 86x28pt box designed for a
// ~3:1 assumption). These tests render real PDFs and read the image's own
// paint-time transform matrix (the CTM `react-pdf` emits immediately before
// `paintImageXObject`) rather than only asserting the component's style
// object, so a future regression that reintroduces a mismatched box/ratio
// fails here even if `PdfThumbnail`-style prop-only assertions would not.
// ---------------------------------------------------------------------------

interface RenderedLogo {
  /** Rendered width in PDF points, read from the image's own CTM, not the component's declared style. */
  width: number;
  /** Rendered height in PDF points (CTM matrices commonly carry a negative d for the y-flip; reported as a magnitude). */
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

async function renderLogo(doc: PDFDocumentProxy, pageNumber: number): Promise<RenderedLogo> {
  const page = await doc.getPage(pageNumber);
  const ops = await page.getOperatorList();
  const paintIndex = ops.fnArray.indexOf(OPS.paintImageXObject);
  if (paintIndex === -1) throw new Error(`No image painted on page ${pageNumber}`);
  const paintArgs = ops.argsArray[paintIndex] as [string, number, number];
  let transformIndex = -1;
  for (let i = paintIndex - 1; i >= 0; i -= 1) {
    if (ops.fnArray[i] === OPS.transform) {
      transformIndex = i;
      break;
    }
  }
  if (transformIndex === -1) throw new Error('No transform preceding the painted image was found');
  const matrix = ops.argsArray[transformIndex] as number[];
  return {
    width: Math.abs(matrix[0]!),
    height: Math.abs(matrix[3]!),
    naturalWidth: paintArgs[1],
    naturalHeight: paintArgs[2],
  };
}

async function textItems(doc: PDFDocumentProxy, pageNumber: number) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.flatMap((item) =>
    'str' in item && item.str.trim() !== ''
      ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width! }]
      : [],
  );
}

describe('ISS-043 shared PDF logo sizing', () => {
  it.each([
    ['Job Order title', 'JOB ORDER', 'EIJOH/26-27/0001'],
    ['a short title', 'QA', undefined],
    [
      'a long title',
      'ERVE INDIA CONSOLIDATED PACKING LIST AND DISPATCH CONFIRMATION',
      'EIPL/26-27/0001 — Mumbai Central Distribution Hub',
    ],
  ] as const)('renders the logo at its real aspect ratio without clipping the title, for %s', async (_label, title, subtitle) => {
    const blob = await pdf(
      <PdfDocument orientation="portrait">
        <PdfHeader title={title} subtitle={subtitle} />
      </PdfDocument>,
    ).toBlob();
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
    try {
      const document = await task.promise;
      const logo = await renderLogo(document, 1);

      // Real artwork ratio (naturalWidth/naturalHeight), vs the ratio actually
      // painted on the page — must match within rounding, i.e. never stretched.
      const naturalRatio = logo.naturalWidth / logo.naturalHeight;
      const renderedRatio = logo.width / logo.height;
      expect(renderedRatio).toBeGreaterThan(naturalRatio - 0.15);
      expect(renderedRatio).toBeLessThan(naturalRatio + 0.15);

      // The prior defect rendered an effective ~86x11.8pt logo. Guard against
      // regressing back below that: the logo must now be materially larger,
      // on both axes, than the undersized box ISS-043 reported.
      expect(logo.width).toBeGreaterThan(130);
      expect(logo.height).toBeGreaterThan(18);

      // The title must start to the right of the logo (no horizontal overlap)
      // and never be pushed off the right edge of an A4 page (595.28pt wide).
      const titleItems = (await textItems(document, 1)).filter((item) => title.includes(item.str) || item.str.length > 0);
      expect(titleItems.length).toBeGreaterThan(0);
      for (const item of titleItems) {
        expect(item.x).toBeGreaterThanOrEqual(logo.width + 28 - 0.5);
        expect(item.x + item.width).toBeLessThanOrEqual(595.28 - 20);
      }
    } finally {
      await task.destroy();
    }
  });

  it('repeats the same logo size and position on continuation pages', async () => {
    const fillerLines = Array.from({ length: 70 }, (_, i) => `Production stage detail row ${i + 1} of the Job Order.`);
    const blob = await pdf(
      <PdfDocument orientation="portrait">
        <PdfHeader title="JOB ORDER" subtitle="EIJOH/26-27/0002" />
        <View style={{ marginTop: 60 }}>
          {fillerLines.map((line) => (
            <Text key={line} style={{ fontSize: 10, marginBottom: 10 }}>
              {line}
            </Text>
          ))}
        </View>
        <PdfFooter />
      </PdfDocument>,
    ).toBlob();
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
    try {
      const document = await task.promise;
      expect(document.numPages).toBeGreaterThanOrEqual(2);
      const firstPage = await renderLogo(document, 1);
      const continuationPage = await renderLogo(document, 2);
      expect(continuationPage.width).toBeCloseTo(firstPage.width, 1);
      expect(continuationPage.height).toBeCloseTo(firstPage.height, 1);

      const firstPageTitle = (await textItems(document, 1)).find((item) => item.str.includes('JOB'));
      const continuationTitle = (await textItems(document, 2)).find((item) => item.str.includes('JOB'));
      expect(firstPageTitle).toBeDefined();
      expect(continuationTitle).toBeDefined();
      expect(continuationTitle!.x).toBeCloseTo(firstPageTitle!.x, 1);
      expect(continuationTitle!.y).toBeCloseTo(firstPageTitle!.y, 1);
    } finally {
      await task.destroy();
    }
  });
});
