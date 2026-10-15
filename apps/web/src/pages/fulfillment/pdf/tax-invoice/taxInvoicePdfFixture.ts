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

/** Synthetic ISS-032 data only: no production identity, records or finalization. */
export function iss032TaxInvoiceFixture(styleCount = 1, sizeCount = 6): TaxInvoiceView {
  const invoice = issuedTaxInvoiceFixture();
  const line = invoice.lines[0]!;
  const issued = invoice.documentSnapshot!.lines[0]!;
  invoice.invoiceNumber = 'SYNTHETIC/ISS032/0001';
  invoice.finalizedAt = '2026-10-16T06:00:00.000Z';
  invoice.financialYear = { id: 'synthetic-fy', code: '2026-27' };
  invoice.ervePackingList.ervePackingListNumber = 'SYNTHETIC/EIPL/0001';
  invoice.gstTreatment = 'INTER';
  invoice.lines = [];
  invoice.documentSnapshot!.lines = [];
  for (let styleIndex = 0; styleIndex < styleCount; styleIndex++) {
    const style = {
      id: `iss032-style-${styleIndex}`,
      styleNumber: styleIndex === 0 ? 'SS26-14026001' : `SYNTHETIC-STYLE-${styleIndex}`,
      styleName: 'Synthetic cotton printed T-shirt',
      description:
        'Soft cotton jersey with a colourful printed design and comfortable regular fit.',
      colour: 'Deep ocean blue with coral print',
    };
    for (let sizeIndex = 0; sizeIndex < sizeCount; sizeIndex++) {
      const id = `iss032-line-${styleIndex}-${sizeIndex}`;
      const size = {
        id: `iss032-size-${sizeIndex}`,
        code: `AGE_${sizeIndex + 9}`,
        label: sizeCount === 6 ? `${sizeIndex + 9} Years` : `Synthetic size ${sizeIndex + 1} Years`,
        sortOrder: sizeIndex,
      };
      invoice.lines.push({
        ...line,
        id,
        style,
        size,
        quantity: 10,
        styleMrp: '999.00',
        calculatedUnitRate: '451.07',
        finalUnitRate: '451.07',
        taxableValue: '4510.70',
        gstPercent: '5',
        cgstAmount: '0',
        sgstAmount: '0',
        igstAmount: '225.535',
        hsn: { code: '61091000', description: null },
      });
      invoice.documentSnapshot!.lines.push({ ...issued, lineId: id, quantity: 10, style, size });
    }
  }
  // Exact synthetic totals; these calculations construct test data, never issued data.
  const count = BigInt(styleCount * sizeCount);
  const fixed = (value: bigint, scale: number) => {
    const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
    return `${value < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  };
  const taxableMills = 4510700n * count;
  const igstMills = 225535n * count;
  const grandMills = taxableMills + igstMills;
  const payableMills = ((grandMills + 500n) / 1000n) * 1000n;
  invoice.subtotal = fixed(taxableMills / 10n, 2);
  invoice.totalCgst = '0.00';
  invoice.totalSgst = '0.00';
  invoice.totalIgst = fixed(igstMills / 10n, 2);
  invoice.totalGst = invoice.totalIgst;
  invoice.grandTotal = fixed(grandMills / 10n, 2);
  invoice.payableTotal = fixed(payableMills / 10n, 2);
  invoice.roundOffAdjustment = fixed((payableMills - grandMills) / 10n, 2);
  invoice.hsnSummary = [
    {
      hsnCode: '61091000',
      gstPercent: '5',
      taxableValue: invoice.subtotal,
      cgstAmount: '0.00',
      sgstAmount: '0.00',
      igstAmount: invoice.totalIgst,
    },
  ];
  return invoice;
}

export function iss032VisualFixtures(): Array<{ name: string; invoice: TaxInvoiceView }> {
  const reference = iss032TaxInvoiceFixture();
  const longDescription = iss032TaxInvoiceFixture();
  for (const line of longDescription.documentSnapshot!.lines) {
    line.style = {
      ...line.style,
      description:
        'Long synthetic description with complete words and readable detail. '.repeat(150) +
        'DESCRIPTION END MARKER',
    };
  }
  const longSizes = iss032TaxInvoiceFixture(1, 360);
  const cancelled = iss032TaxInvoiceFixture(14);
  cancelled.status = 'CANCELLED';
  cancelled.cancelledAt = '2026-10-16T07:00:00.000Z';
  cancelled.cancellationReason = 'Synthetic visual verification only';
  const longCode = iss032TaxInvoiceFixture();
  for (const line of longCode.documentSnapshot!.lines) {
    line.style = {
      ...line.style,
      styleNumber: 'SYNTHETIC-SS26-14026001-LONG-IDENTIFIER-032',
      styleName: 'Long synthetic Style name with complete readable words. '.repeat(8),
      colour: 'Deep ocean blue with coral and silver printed accents. '.repeat(8),
    };
  }
  const boundary = iss032TaxInvoiceFixture(2);
  for (const line of boundary.documentSnapshot!.lines) {
    if (line.style.id === 'iss032-style-0')
      line.style = {
        ...line.style,
        description: 'Synthetic boundary description with preserved details. '.repeat(100),
      };
  }
  return [
    { name: 'reference', invoice: reference },
    { name: 'missing-image', invoice: structuredClone(reference) },
    { name: 'long-description', invoice: longDescription },
    { name: 'long-size-list', invoice: longSizes },
    { name: 'multi-page', invoice: iss032TaxInvoiceFixture(14) },
    { name: 'cancelled', invoice: cancelled },
    { name: 'long-code', invoice: longCode },
    { name: 'boundary', invoice: boundary },
  ];
}
