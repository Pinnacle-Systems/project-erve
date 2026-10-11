import type { TaxInvoiceView } from '@erve/types';
import { taxInvoiceFixture } from '../../tax-invoice-test-fixture.js';

export function issuedTaxInvoiceFixture(overrides: Partial<TaxInvoiceView> = {}): TaxInvoiceView {
  const invoice = taxInvoiceFixture({
    status: 'FINALIZED',
    invoiceNumber: 'EI/25-26/0103',
    finalizedAt: '2026-03-30T06:00:00.000Z',
    financialYear: { id: 'fy-1', code: '2025-26' },
    subtotal: '41952.00',
    totalCgst: '1048.80',
    totalSgst: '1048.80',
    totalIgst: '0',
    totalGst: '2097.60',
    grandTotal: '44049.60',
    roundOffAdjustment: '0.40',
    payableTotal: '44050.00',
  });
  invoice.lines[0] = {
    ...invoice.lines[0]!,
    quantity: 20,
    finalUnitRate: '2097.60',
    taxableValue: '41952.00',
    cgstAmount: '1048.80',
    sgstAmount: '1048.80',
    igstAmount: '0',
  };
  invoice.hsnSummary = [
    {
      hsnCode: '61091000',
      gstPercent: '5',
      taxableValue: '41952.00',
      cgstAmount: '1048.80',
      sgstAmount: '1048.80',
      igstAmount: '0',
    },
  ];
  invoice.documentSnapshot = {
    schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1',
    lines: [
      {
        lineId: 'line-1',
        quantity: 20,
        style: {
          id: 'style-1',
          styleNumber: 'ISSUED-001',
          styleName: 'Issued Classic Tee',
          colour: 'Navy',
          description: 'Cotton T-shirt',
        },
        size: { id: 'size-1', code: 'M', label: 'Medium' },
        image: null,
        imageAvailability: 'NO_IMAGE',
      },
    ],
    dispatchOrders: [{ id: 'do-1', number: 'DO/25-26/0001', cartonIds: ['carton-1'] }],
    transport: {
      erveDispatchId: 'dispatch-1',
      lrNumber: 'LR-VERIFIED-001',
      transporter: 'Verified Carrier',
      vehicleNumber: 'MH01TEST',
    },
    historicalBuyerOrderReference: null,
  };
  return { ...invoice, ...overrides };
}

/** Synthetic nine-Style/six-size content case matching the reference's financial example. */
export function nineStyleTaxInvoiceFixture(): TaxInvoiceView {
  const invoice = issuedTaxInvoiceFixture();
  const templateLine = invoice.lines[0]!;
  const templateIssued = invoice.documentSnapshot!.lines[0]!;
  invoice.lines = [];
  invoice.documentSnapshot!.lines = [];
  for (let styleIndex = 0; styleIndex < 9; styleIndex++) {
    const sweatshirt = styleIndex === 5 || styleIndex === 6;
    const styleId = `style-${styleIndex}`;
    const style = {
      id: styleId,
      styleNumber: `TEST-${styleIndex + 1}`,
      styleName: `Synthetic ${sweatshirt ? 'Sweatshirt' : 'T-shirt'} ${styleIndex + 1}`,
    };
    for (let sizeIndex = 0; sizeIndex < 6; sizeIndex++) {
      const id = `line-${styleIndex}-${sizeIndex}`;
      const size = String(sizeIndex + 3);
      const quantity = sweatshirt ? 1 : 2;
      invoice.lines.push({
        ...templateLine,
        id,
        style,
        size: { code: size, label: size },
        quantity,
        ervePackingListCommercialLineId: `commercial-${id}`,
        saleOrderLineId: `source-${id}`,
        styleMrp: sweatshirt ? '1399.00' : '799.00',
        distributorPricingPercentage: '50',
        calculatedUnitRate: sweatshirt ? '699.50' : '399.50',
        finalUnitRate: sweatshirt ? '699.50' : '399.50',
        taxableValue: sweatshirt ? '699.50' : '799.00',
        cgstAmount: sweatshirt ? '17.4875' : '19.975',
        sgstAmount: sweatshirt ? '17.4875' : '19.975',
        hsn: { code: sweatshirt ? '61061000' : '61091000', description: null },
      });
      invoice.documentSnapshot!.lines.push({
        ...templateIssued,
        lineId: id,
        quantity,
        style: { ...style, colour: styleIndex % 2 ? 'Coral' : 'Navy', description: null },
        size: { id: `size-${size}`, code: size, label: size },
      });
    }
  }
  invoice.hsnSummary = [
    {
      hsnCode: '61091000',
      gstPercent: '5',
      taxableValue: '33558.00',
      cgstAmount: '838.95',
      sgstAmount: '838.95',
      igstAmount: '0',
    },
    {
      hsnCode: '61061000',
      gstPercent: '5',
      taxableValue: '8394.00',
      cgstAmount: '209.85',
      sgstAmount: '209.85',
      igstAmount: '0',
    },
  ];
  return invoice;
}
