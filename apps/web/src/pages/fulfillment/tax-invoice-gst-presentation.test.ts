import { describe, expect, it } from 'vitest';
import { taxInvoiceGstComponents } from './tax-invoice-gst-presentation.js';

describe('authoritative treatment presentation', () => {
  it.each([
    ['INTER', ['IGST']],
    ['INTRA', ['CGST', 'SGST']],
    [null, []],
  ] as const)('selects %s labels without consulting amounts or addresses', (treatment, labels) => {
    expect(taxInvoiceGstComponents(treatment).map((component) => component.label)).toEqual(labels);
  });
});
