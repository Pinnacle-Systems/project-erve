import { buildTaxInvoiceLineGroups, sumInvoiceAmounts } from '../../tax-invoice-line-groups.js';
import type { TaxInvoiceAddress, TaxInvoiceView } from '@erve/types';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { exactInvoiceAmount, formatInvoiceDate, formatInvoiceMoney } from '../../tax-invoice-ui.js';

/** Lexical formatting only; monetary values never pass through floating point. */
function decimal(value: string): string {
  const text = exactInvoiceAmount(value);
  if (text === null) throw new Error('Invalid frozen monetary value');
  return text;
}
export function taxInvoicePdfMoney(value: string | null, currency = true): string {
  if (value === null) return 'Unavailable';
  const text = formatInvoiceMoney(value)
    .replace('₹', currency ? 'INR ' : '')
    .replace('−', '-');
  if (text === 'Unavailable') throw new Error('Invalid frozen monetary value');
  return text;
}

const units = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function integerWords(value: bigint): string {
  for (const [scale, label] of [
    [10000000n, 'Crore'],
    [100000n, 'Lakh'],
    [1000n, 'Thousand'],
    [100n, 'Hundred'],
  ] as const) {
    if (value >= scale)
      return `${integerWords(value / scale)} ${label}${value % scale ? ` ${integerWords(value % scale)}` : ''}`;
  }
  const small = Number(value); // bounded to 0..99, never a monetary aggregate
  return small < 20
    ? units[small]!
    : `${tens[Math.floor(small / 10)]}${small % 10 ? ` ${units[small % 10]}` : ''}`;
}
export function invoiceAmountInWords(amount: string): string {
  const [whole, fraction] = decimal(amount).split('.');
  if (whole!.startsWith('-') || /[1-9]/.test(fraction!.slice(2))) {
    throw new Error('Issued payable must be a non-negative, backend-finalized two-decimal amount');
  }
  const paise = BigInt(fraction!.slice(0, 2));
  return `INR ${integerWords(BigInt(whole!))}${paise ? ` and ${integerWords(paise)} Paise` : ''} Only.`;
}

export interface TaxInvoicePdfGroup {
  id: string;
  sourceLineIds: string[];
  styleNumber: string;
  styleName: string;
  description: string | null;
  colour: string;
  sizes: string;
  quantity: number;
  hsnCode: string;
  gstPercent: string;
  mrp: string;
  rate: string;
  taxable: string;
  imageId: string | null;
  image: PdfImageSource;
}
export interface TaxInvoicePdfViewModel {
  gstTreatment: TaxInvoiceView['gstTreatment'];
  invoiceNumber: string;
  invoiceDate: string;
  financialYear: string | null;
  placeOfSupply: string;
  legacyPresentation: boolean;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;
  references: {
    dispatchOrders: string[];
    historicalEiso: string | null;
    eipl: string;
    erveDispatch: string | null;
    lrNumber: string | null;
    transporter: string | null;
    vehicleNumber: string | null;
    replacesInvoiceNumber: string | null;
  };
  sellerName: string;
  sellerAddress: string;
  sellerGstin: string;
  billToName: string;
  billToAddress: string;
  billToGstin: string;
  shipToName: string;
  shipToAddress: string;
  bankDetails: string;
  groups: TaxInvoicePdfGroup[];
  totalQuantity: number;
  totals: {
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    gst: string;
    grandTotal: string;
    roundOffAdjustment: string | null;
    payable: string;
    totalLabel: string;
    amountWords: string;
    roundingPolicy: string | null;
  };
  hsnSummary: Array<{
    id: string;
    hsnCode: string;
    gstPercent: string;
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    totalGst: string;
  }> | null;
  eInvoiceDeclaration: string;
}
function address(value: TaxInvoiceAddress): string {
  return (
    [
      value.addressLine1,
      value.addressLine2,
      value.city,
      value.state,
      value.postalCode,
      value.country,
    ]
      .filter(Boolean)
      .join(', ') || 'Address unavailable'
  );
}

/** Pure finalized-snapshot allowlist. No current master/media lookup or financial recalculation. */
export function buildTaxInvoiceViewModel(
  invoice: TaxInvoiceView,
  images: Map<string, PdfImageSource> = new Map(),
): TaxInvoicePdfViewModel {
  if (
    (invoice.status !== 'FINALIZED' && invoice.status !== 'CANCELLED') ||
    !invoice.invoiceNumber ||
    !invoice.finalizedAt ||
    invoice.grandTotal === null
  ) {
    throw new Error('A finalized or cancelled invoice with issued identity and total is required');
  }
  const snapshot =
    invoice.documentSnapshot?.schemaVersion === 'ERVE_TAX_INVOICE_DOCUMENT_V1'
      ? invoice.documentSnapshot
      : null;
  const rows: TaxInvoicePdfGroup[] = buildTaxInvoiceLineGroups(invoice).map((group) => {
    const line = group.sourceLines[0]!;
    const image = group.image ? images.get(group.image.id) : undefined;
    return {
      id: group.id,
      sourceLineIds: group.sourceLineIds,
      styleNumber: group.styleNumber,
      styleName: group.styleName,
      description: group.description,
      colour: group.colour ?? 'Not recorded',
      sizes: group.sizes,
      quantity: group.quantity,
      hsnCode: line.hsn?.code ?? 'Unavailable',
      gstPercent: line.gstPercent ?? 'Unavailable',
      mrp: taxInvoicePdfMoney(line.styleMrp, false),
      rate: taxInvoicePdfMoney(line.finalUnitRate, false),
      taxable: taxInvoicePdfMoney(group.taxableValue, false),
      imageId: group.image?.id ?? null,
      image: image && 'dataUri' in image ? image : { inconsistent: true },
    };
  });
  const issuedAmount = invoice.payableTotal ?? invoice.grandTotal;
  const adjustment = invoice.roundOffAdjustment;
  const positiveAdjustment =
    adjustment !== null && BigInt(decimal(adjustment).replace('.', '')) > 0n;
  const financialYear = invoice.financialYear?.code ?? null;
  return {
    gstTreatment: invoice.gstTreatment,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: formatInvoiceDate(invoice.finalizedAt),
    financialYear,
    placeOfSupply:
      [invoice.billTo.state, invoice.billTo.stateCode].filter(Boolean).join(' / ') || 'Unavailable',
    legacyPresentation: snapshot === null,
    isCancelled: invoice.status === 'CANCELLED',
    cancelledAt: invoice.cancelledAt ? formatInvoiceDate(invoice.cancelledAt) : null,
    cancellationReason: invoice.cancellationReason ?? null,
    references: {
      dispatchOrders: snapshot?.dispatchOrders.map((order) => order.number) ?? [],
      historicalEiso: snapshot?.historicalBuyerOrderReference?.value ?? null,
      eipl: invoice.ervePackingList.ervePackingListNumber,
      erveDispatch: invoice.erveDispatch?.erveDispatchNumber ?? null,
      lrNumber: snapshot?.transport?.lrNumber ?? null,
      transporter: snapshot?.transport?.transporter ?? null,
      vehicleNumber: snapshot?.transport?.vehicleNumber ?? null,
      replacesInvoiceNumber: invoice.replacesInvoiceNumber ?? null,
    },
    sellerName: invoice.seller.legalName,
    sellerAddress: address(invoice.seller),
    sellerGstin: invoice.seller.gstin,
    billToName: invoice.billTo.name,
    billToAddress: address(invoice.billTo),
    billToGstin: invoice.billTo.gstin,
    shipToName: invoice.shipTo.label ?? 'Consignee name unavailable',
    shipToAddress: address(invoice.shipTo),
    bankDetails: [
      invoice.seller.bankName,
      `Account name: ${invoice.seller.bankAccountName}`,
      `Account: ${invoice.seller.bankAccountNumber}`,
      `IFSC: ${invoice.seller.bankIfsc}`,
      invoice.seller.bankBranchName,
      invoice.seller.bankAddress,
    ]
      .filter(Boolean)
      .join(' | '),
    groups: rows,
    totalQuantity: rows.reduce((quantity, row) => quantity + row.quantity, 0),
    totals: {
      taxable: taxInvoicePdfMoney(invoice.subtotal),
      cgst: taxInvoicePdfMoney(invoice.totalCgst),
      sgst: taxInvoicePdfMoney(invoice.totalSgst),
      igst: taxInvoicePdfMoney(invoice.totalIgst),
      gst: taxInvoicePdfMoney(invoice.totalGst),
      grandTotal: taxInvoicePdfMoney(invoice.grandTotal),
      roundOffAdjustment:
        adjustment === null
          ? null
          : `${positiveAdjustment ? '+' : ''}${taxInvoicePdfMoney(adjustment)}`,
      payable: taxInvoicePdfMoney(issuedAmount),
      totalLabel: invoice.payableTotal === null ? 'Original issued total' : 'Final payable',
      amountWords: invoiceAmountInWords(issuedAmount),
      roundingPolicy: invoice.roundingPolicy,
    },
    hsnSummary:
      invoice.hsnSummary?.map((row, index) => ({
        id: `${row.hsnCode}:${row.gstPercent}:${index}`,
        hsnCode: row.hsnCode,
        gstPercent: `${row.gstPercent}%`,
        taxable: taxInvoicePdfMoney(row.taxableValue, false),
        cgst: taxInvoicePdfMoney(row.cgstAmount, false),
        sgst: taxInvoicePdfMoney(row.sgstAmount, false),
        igst: taxInvoicePdfMoney(row.igstAmount, false),
        totalGst: taxInvoicePdfMoney(
          sumInvoiceAmounts([row.cgstAmount, row.sgstAmount, row.igstAmount]),
          false,
        ),
      })) ?? null,
    eInvoiceDeclaration:
      financialYear === null
        ? 'E-invoice declaration unavailable: issued financial year was not recorded.'
        : invoice.seller.einvoiceApplicable
          ? `E-invoicing is applicable for financial year ${financialYear}; e-invoice references are unavailable.`
          : `E-invoicing is not applicable to this seller for financial year ${financialYear}.`,
  };
}
