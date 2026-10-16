/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaxInvoiceReviewView } from '@erve/types';
import { TaxInvoiceTotals } from './TaxInvoiceTotals.js';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function show(overrides: Partial<TaxInvoiceReviewView> = {}) {
  act(() => root.render(<TaxInvoiceTotals invoice={taxInvoiceFixture(overrides)} />));
}

function headers() {
  return Array.from(container.querySelectorAll('thead th')).map((header) =>
    header.textContent?.trim(),
  );
}

describe('ISS-030 contextual Tax Invoice GST presentation', () => {
  it('shows only CGST and SGST for INTRA, including a zero-rated HSN band', () => {
    const base = taxInvoiceFixture();
    show({
      gstTreatment: 'INTRA',
      hsnSummary: [
        ...base.hsnSummary!,
        {
          hsnCode: '00000000',
          gstPercent: '0',
          taxableValue: '100.00',
          cgstAmount: '0',
          sgstAmount: '0',
          igstAmount: '0',
        },
      ],
    });
    expect(headers()).toEqual(['HSN', 'GST', 'Taxable value', 'CGST', 'SGST']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.textContent).toContain('CGST');
    expect(container.textContent).toContain('SGST');
    expect(container.textContent).not.toContain('IGST');
    expect(container.textContent).toContain('Preview payable');
  });

  it('shows only IGST for INTER across mixed HSN bands, irrespective of zero amounts', () => {
    show({
      gstTreatment: 'INTER',
      totalCgst: '0',
      totalSgst: '0',
      totalIgst: '23.33683345',
      hsnSummary: [
        {
          hsnCode: '61091000',
          gstPercent: '5',
          taxableValue: '466.736669',
          cgstAmount: '0',
          sgstAmount: '0',
          igstAmount: '23.33683345',
        },
        {
          hsnCode: '00000000',
          gstPercent: '0',
          taxableValue: '50.00',
          cgstAmount: '0',
          sgstAmount: '0',
          igstAmount: '0',
        },
      ],
    });
    expect(headers()).toEqual(['HSN', 'GST', 'Taxable value', 'IGST']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.textContent).toContain('IGST');
    expect(container.textContent).not.toContain('CGST');
    expect(container.textContent).not.toContain('SGST');
  });

  it('does not infer a computed zero or display tax columns when treatment is unresolved', () => {
    show({
      gstTreatment: null,
      totalCgst: null,
      totalSgst: null,
      totalIgst: null,
      hsnSummary: taxInvoiceFixture().hsnSummary,
    });
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('Tax summary unavailable until GST treatment is resolved.');
    expect(container.textContent).toContain('Tax components');
    expect(container.textContent).toContain('Unavailable until GST treatment is resolved');
    expect(container.textContent).not.toContain('CGST');
    expect(container.textContent).not.toContain('SGST');
    expect(container.textContent).not.toContain('IGST');
  });

  it('retains issued total and round-off presentation with the persisted INTER treatment', () => {
    show({
      status: 'FINALIZED',
      invoiceNumber: 'EI/26-27/0271',
      gstTreatment: 'INTER',
      totalCgst: '0',
      totalSgst: '0',
      totalIgst: '23.33683345',
      review: { state: 'FINALIZED', isPreview: false, calculatedAt: null, blockers: [] },
    });
    expect(headers()).toEqual(['HSN', 'GST', 'Taxable value', 'IGST']);
    expect(container.textContent).toContain('Issued totals');
    expect(container.textContent).toContain('Grand total (before round-off)');
    expect(container.textContent).toContain('Round-off adjustment');
    expect(container.textContent).toContain('₹490.00');
  });
});
