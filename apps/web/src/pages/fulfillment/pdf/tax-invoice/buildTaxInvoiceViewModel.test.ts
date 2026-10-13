import { describe, expect, it } from 'vitest';
import { buildTaxInvoiceViewModel, invoiceAmountInWords } from './buildTaxInvoiceViewModel.js';
import { issuedTaxInvoiceFixture } from './taxInvoicePdfFixture.js';

describe('issued Tax Invoice PDF data', () => {
  it('uses frozen configured size order and printed numeric formatting', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.size = {
      id: 'size-8',
      code: 'AGE_8',
      label: '8',
      sortOrder: 8,
    };
    invoice.lines.push({ ...invoice.lines[0]!, id: 'line-2' });
    invoice.documentSnapshot!.lines.push({
      ...invoice.documentSnapshot!.lines[0]!,
      lineId: 'line-2',
      size: { id: 'size-3', code: 'AGE_3', label: '3', sortOrder: 3 },
    });
    expect(buildTaxInvoiceViewModel(invoice).groups[0]!.sizes).toBe('3-20, 8-20');
  });
  it('presents frozen Bill-To place of supply independently of Ship-To state', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.shipTo.state = 'Tamil Nadu';
    expect(buildTaxInvoiceViewModel(invoice).placeOfSupply).toBe('Maharashtra / 27');
  });
  it('uses frozen financial amounts and payable words without calculating GST or round-off', () => {
    const model = buildTaxInvoiceViewModel(issuedTaxInvoiceFixture());
    expect(model.totals).toMatchObject({
      taxable: 'INR 41,952.00',
      grandTotal: 'INR 44,049.60',
      roundOffAdjustment: '+INR 0.40',
      payable: 'INR 44,050.00',
      amountWords: 'INR Forty Four Thousand Fifty Only.',
    });
    expect(model.groups[0]?.taxable).toBe('41,952.00');
  });

  it('preserves original issued amounts and unavailable legacy round-off/document data', () => {
    const model = buildTaxInvoiceViewModel(
      issuedTaxInvoiceFixture({
        documentSnapshot: null,
        payableTotal: null,
        roundOffAdjustment: null,
        roundingPolicy: null,
      }),
    );
    expect(model.totals.payable).toBe('INR 44,049.60');
    expect(model.totals.roundOffAdjustment).toBeNull();
    expect(model.totals.totalLabel).toBe('Original issued total');
    expect(model.totals.amountWords).toBe(
      'INR Forty Four Thousand Forty Nine and Sixty Paise Only.',
    );
    expect(model.groups[0]?.styleNumber).toBe('Not recorded');
    expect(model.references.dispatchOrders).toEqual([]);
  });

  it('takes Style, colour and size from the issued snapshot despite current master edits', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.lines[0]!.style.styleNumber = 'EDITED-CURRENT';
    invoice.lines[0]!.style.styleName = 'Edited current name';
    invoice.lines[0]!.size.label = 'Edited size';
    expect(buildTaxInvoiceViewModel(invoice).groups[0]).toMatchObject({
      styleNumber: 'ISSUED-001',
      styleName: 'Issued Classic Tee',
      colour: 'Navy',
      sizes: 'Medium: 20',
    });
  });

  it('keeps historical EISO verbatim, multiple verified orders and Erve Dispatch conceptually separate', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.historicalBuyerOrderReference = {
      kind: 'HISTORICAL_EISO',
      value: ' EISO/103/25-26 ',
    };
    invoice.documentSnapshot!.dispatchOrders.push({
      id: 'do-2',
      number: 'DO/25-26/0002',
      cartonIds: ['carton-2'],
    });
    const model = buildTaxInvoiceViewModel(invoice);
    expect(model.references.historicalEiso).toBe(' EISO/103/25-26 ');
    expect(model.references.dispatchOrders).toEqual(['DO/25-26/0001', 'DO/25-26/0002']);
    expect(model.references.erveDispatch).toBe('EIED/26-27/0001');
    expect(model.references.lrNumber).toBe('LR-VERIFIED-001');
  });

  it('never substitutes Erve Dispatch for unavailable current order provenance', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.dispatchOrders = [];
    invoice.documentSnapshot!.transport = null;
    const model = buildTaxInvoiceViewModel(invoice);
    expect(model.references.dispatchOrders).toEqual([]);
    expect(model.references.historicalEiso).toBeNull();
    expect(model.references.lrNumber).toBeNull();
  });

  it('groups compatible sizes while summing only frozen amounts and preserving every source line', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.lines[0]!.quantity = 1;
    invoice.lines[0]!.taxableValue = '10.1';
    invoice.documentSnapshot!.lines[0]!.quantity = 1;
    invoice.lines.push({ ...invoice.lines[0]!, id: 'line-2', quantity: 2, taxableValue: '10.20' });
    invoice.documentSnapshot!.lines.push({
      ...invoice.documentSnapshot!.lines[0]!,
      lineId: 'line-2',
      quantity: 2,
      size: { id: 'size-2', code: 'L', label: 'Large' },
    });
    const model = buildTaxInvoiceViewModel(invoice);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]).toMatchObject({
      quantity: 3,
      taxable: '20.30',
      sourceLineIds: ['line-1', 'line-2'],
      sizes: 'Medium: 1, Large: 2',
    });
    // Global totals stay authoritative even if test line fragments differ.
    expect(model.totals.taxable).toBe('INR 41,952.00');
  });

  it.each(['colour', 'hsn', 'mrp', 'rate', 'gst'] as const)(
    'does not merge unlike %s lines',
    (difference) => {
      const invoice = issuedTaxInvoiceFixture();
      invoice.lines.push(structuredClone({ ...invoice.lines[0]!, id: 'line-2' }));
      invoice.documentSnapshot!.lines.push(
        structuredClone({ ...invoice.documentSnapshot!.lines[0]!, lineId: 'line-2' }),
      );
      const second = invoice.lines[1]!;
      if (difference === 'colour') invoice.documentSnapshot!.lines[1]!.style.colour = 'Coral';
      if (difference === 'hsn') second.hsn = { code: '61100000', description: null };
      if (difference === 'mrp') second.styleMrp = '1000';
      if (difference === 'rate') second.finalUnitRate = '2098';
      if (difference === 'gst') second.gstPercent = '18';
      expect(buildTaxInvoiceViewModel(invoice).groups).toHaveLength(2);
    },
  );

  it('preserves high precision without rounding line or GST components', () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.lines[0]!.taxableValue = '12.499999999999999999';
    invoice.totalCgst = '0.312499999999999999';
    const model = buildTaxInvoiceViewModel(invoice);
    expect(model.groups[0]?.taxable).toBe('12.499999999999999999');
    expect(model.totals.cgst).toBe('INR 0.312499999999999999');
  });

  it('uses the frozen financial year/applicability for the declaration', () => {
    const invoice = issuedTaxInvoiceFixture();
    expect(buildTaxInvoiceViewModel(invoice).eInvoiceDeclaration).toContain('2025-26');
    expect(buildTaxInvoiceViewModel(invoice).eInvoiceDeclaration).toContain('not applicable');
    invoice.seller.einvoiceApplicable = true;
    expect(buildTaxInvoiceViewModel(invoice).eInvoiceDeclaration).not.toContain('not applicable');
    invoice.financialYear = null;
    expect(buildTaxInvoiceViewModel(invoice).eInvoiceDeclaration).toContain('unavailable');
  });

  it('refuses drafts and missing issued identity/financial totals', () => {
    expect(() => buildTaxInvoiceViewModel(issuedTaxInvoiceFixture({ status: 'DRAFT' }))).toThrow();
    expect(() =>
      buildTaxInvoiceViewModel(issuedTaxInvoiceFixture({ invoiceNumber: null })),
    ).toThrow();
    expect(() => buildTaxInvoiceViewModel(issuedTaxInvoiceFixture({ grandTotal: null }))).toThrow();
  });

  it.each([
    ['0.00', 'INR Zero Only.'],
    ['1.01', 'INR One and One Paise Only.'],
    ['10000000.00', 'INR One Crore Only.'],
    [
      '999999999999.99',
      'INR Ninety Nine Thousand Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only.',
    ],
  ])('states %s exactly in words', (amount, expected) => {
    expect(invoiceAmountInWords(amount)).toBe(expected);
  });
});
