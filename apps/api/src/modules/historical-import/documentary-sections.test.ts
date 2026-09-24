import { describe, expect, it } from 'vitest';
import { comparePdfMrp, extractDocumentarySections, requireDocumentarySections } from './documentary-sections.js';
import { linesFromItems } from './pdf-text-layout.js';

describe('three-source comparison policy', () => {
  it.each([
    ['Girls tee', 'Girls tee', 'PDF_MRP_EXACT'],
    ['Girls\n tee', 'Girls tee', 'PDF_MRP_EQUIVALENT'],
    ['Girls tee\n*Any delay penalties', 'Girls tee', 'PDF_HAS_ADDITIONAL_CONTENT'],
    ['Girls tee', 'Girls tee with print', 'MRP_HAS_ADDITIONAL_CONTENT'],
    ['Girls tee', 'GIRLS TEE', 'PDF_MRP_DIFFER'],
    ['Boys regular shirt', 'Boys oversized shirt', 'PDF_MRP_DIFFER'],
  ])('compares %s and %s without editorial normalization', (pdf, mrp, wanted) => {
    expect(comparePdfMrp(pdf, mrp)).toBe(wanted);
  });
  it('requires review when disagreeing text has no demonstrable PDF boundary', () => {
    const sections = extractDocumentarySections({ pageNumber: 1, width: 792, height: 612,
      lines: linesFromItems([{ text: 'Different PDF wording', x: 20, y: 250, width: 100, height: 8 }]),
    });
    expect(comparePdfMrp('Different PDF wording', 'Workbook wording')).toBe('PDF_MRP_DIFFER');
    expect(() => requireDocumentarySections(sections)).toThrow('REVIEW_REQUIRED');
    expect(() => requireDocumentarySections(undefined)).toThrow('REVIEW_REQUIRED');
  });
});
