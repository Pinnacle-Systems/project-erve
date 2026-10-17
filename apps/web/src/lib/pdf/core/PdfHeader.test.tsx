import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
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
