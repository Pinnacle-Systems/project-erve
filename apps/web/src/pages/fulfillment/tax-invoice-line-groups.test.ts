import { describe, expect, it } from 'vitest';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';
import { issuedTaxInvoiceFixture } from './pdf/tax-invoice/taxInvoicePdfFixture.js';
import { buildTaxInvoiceLineGroups } from './tax-invoice-line-groups.js';

describe('Tax Invoice presentation groups', () => {
  it('groups six configured sizes with exact amounts and original source identities', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines = [8, 3, 7, 4, 6, 5].map((size) => ({
      ...invoice.lines[0]!,
      id: `line-${size}`,
      quantity: 2,
      taxableValue: '0.123456789012345678',
      size: { id: `size-${size}`, code: `AGE_${size}`, label: String(size), sortOrder: size },
    }));
    const groups = buildTaxInvoiceLineGroups(invoice);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      quantity: 12,
      sizes: '3-2, 4-2, 5-2, 6-2, 7-2, 8-2',
      taxableValue: '0.740740734074074068',
    });
    expect(groups[0]!.sourceLineIds).toHaveLength(6);
    expect(groups[0]!.sourceLines).toEqual(expect.arrayContaining(invoice.lines));
    expect(invoice.lines[0]!.quantity).toBe(2);
    expect(
      buildTaxInvoiceLineGroups({ ...invoice, lines: [...invoice.lines].reverse() })[0]!.id,
    ).toBe(groups[0]!.id);
  });
  it('adds repeated size records once per physical source line', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines.push({ ...invoice.lines[0]!, id: 'line-2', quantity: 3, taxableValue: '0.1' });
    expect(buildTaxInvoiceLineGroups(invoice)[0]).toMatchObject({
      quantity: 10,
      sizes: 'Medium: 10',
      taxableValue: '466.836669',
      sourceLineIds: ['line-1', 'line-2'],
    });
  });
  it.each(['style', 'rate', 'mrp', 'pricing', 'hsn', 'gst'] as const)(
    'separates incompatible %s',
    (field) => {
      const invoice = taxInvoiceFixture();
      const second = structuredClone({ ...invoice.lines[0]!, id: 'line-2' });
      if (field === 'style') second.style.id = 'another-style';
      if (field === 'rate') second.finalUnitRate = '50';
      if (field === 'mrp') second.styleMrp = '200';
      if (field === 'pricing') second.distributorPricingPercentage = '50';
      if (field === 'hsn') second.hsn = { code: '61100000', description: null };
      if (field === 'gst') second.gstPercent = '18';
      invoice.lines.push(second);
      expect(buildTaxInvoiceLineGroups(invoice)).toHaveLength(2);
    },
  );
  it('retains individual override provenance without unnecessarily splitting compatible rates', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines.push({
      ...invoice.lines[0]!,
      id: 'line-2',
      priceListId: 'another-list',
      calculatedUnitRate: '70',
      overrideUnitRate: '66.676667',
      overrideReason: 'Agreed correction',
    });
    const groups = buildTaxInvoiceLineGroups(invoice);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sourceLines[1]!.overrideReason).toBe('Agreed correction');
    invoice.lines[1]!.finalUnitRate = '60';
    expect(buildTaxInvoiceLineGroups(invoice)).toHaveLength(2);
  });
  it('preserves unavailable financial previews without treating them as zero', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines.push({ ...invoice.lines[0]!, id: 'line-2', taxableValue: null });
    expect(buildTaxInvoiceLineGroups(invoice)[0]!.taxableValue).toBeNull();
  });
  it('uses configured alphabetic order rather than lexical order', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines = ['XL', 'M', 'S', 'L'].map((label) => ({
      ...invoice.lines[0]!,
      id: label,
      quantity: 1,
      size: { code: label, label, sortOrder: ['S', 'M', 'L', 'XL'].indexOf(label) },
    }));
    expect(buildTaxInvoiceLineGroups(invoice)[0]!.sizes).toBe('S: 1, M: 1, L: 1, XL: 1');
  });
  it('keeps finalized identity and size order frozen despite current master changes', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.lines[0]!.style.styleNumber = 'LIVE';
    invoice.lines[0]!.size = { code: 'NEW', label: 'LIVE', sortOrder: -100 };
    expect(buildTaxInvoiceLineGroups(invoice)[0]).toMatchObject({
      styleNumber: 'ISSUED-001',
      sizes: 'Medium: 20',
    });
  });
  it('preserves old snapshot sequence regardless of API line order', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.lines.push({ ...invoice.lines[0]!, id: 'line-2' });
    invoice.documentSnapshot!.lines.push({
      ...invoice.documentSnapshot!.lines[0]!,
      lineId: 'line-2',
      size: { id: 'size-2', code: 'L', label: 'Large' },
    });
    invoice.lines.reverse();
    expect(buildTaxInvoiceLineGroups(invoice)[0]!.sizes).toBe('Medium: 20, Large: 20');
  });
  it('never invents legacy issued identity from current masters', () => {
    const invoice = issuedTaxInvoiceFixture({ documentSnapshot: null });
    invoice.lines.push({ ...invoice.lines[0]!, id: 'line-2' });
    const groups = buildTaxInvoiceLineGroups(invoice);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      styleNumber: 'Not recorded',
      sizes: 'Not recorded: 20',
      image: null,
    });
  });
  it('uses the earliest frozen position for duplicate legacy sizes after shuffled API input', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.lines.push(
      { ...invoice.lines[0]!, id: 'line-2' },
      { ...invoice.lines[0]!, id: 'line-3' },
    );
    invoice.documentSnapshot!.lines.push(
      {
        ...invoice.documentSnapshot!.lines[0]!,
        lineId: 'line-2',
        size: { id: 'size-S', code: 'S', label: 'Small' },
      },
      { ...invoice.documentSnapshot!.lines[0]!, lineId: 'line-3' },
    );
    invoice.lines.reverse();
    expect(buildTaxInvoiceLineGroups(invoice)[0]!.sizes).toBe('Medium: 40, Small: 20');
  });
  it('keeps multiple group and source-ID ordering deterministic when inputs are shuffled', () => {
    const invoice = taxInvoiceFixture();
    invoice.lines.push(
      { ...invoice.lines[0]!, id: 'line-2', finalUnitRate: '50' },
      { ...invoice.lines[0]!, id: 'line-3' },
    );
    const result = buildTaxInvoiceLineGroups(invoice).map(({ id, sizes, sourceLineIds }) => ({
      id,
      sizes,
      sourceLineIds,
    }));
    invoice.lines.reverse();
    expect(
      buildTaxInvoiceLineGroups(invoice).map(({ id, sizes, sourceLineIds }) => ({
        id,
        sizes,
        sourceLineIds,
      })),
    ).toEqual(result);
  });
  it('rejects inconsistent snapshots and unsafe physical quantities', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.quantity = 1;
    expect(() => buildTaxInvoiceLineGroups(invoice)).toThrow('Issued presentation');
    const draft = taxInvoiceFixture();
    draft.lines[0]!.quantity = Number.MAX_SAFE_INTEGER;
    draft.lines.push({ ...draft.lines[0]!, id: 'line-2', quantity: 1 });
    expect(() => buildTaxInvoiceLineGroups(draft)).toThrow('quantity');
  });
});
