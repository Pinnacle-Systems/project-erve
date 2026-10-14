export interface TaxInvoiceActor {
  id: string;
  name: string;
  email?: string;
}
export interface TaxInvoiceAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
}
export interface TaxInvoiceLineView {
  id: string;
  ervePackingListCommercialLineId: string;
  saleOrderLineId: string;
  style: {
    id: string;
    styleNumber: string;
    styleName: string;
    primaryImage?: TaxInvoiceDraftImage | null;
  };
  hsn: { code: string; description: string | null } | null;
  size: { id?: string; code: string; label: string; sortOrder?: number };
  quantity: number;
  styleMrp: string;
  distributorPricingPercentage: string;
  priceListId: string;
  calculatedUnitRate: string | null;
  overrideUnitRate: string | null;
  overrideReason: string | null;
  overriddenBy: TaxInvoiceActor | null;
  overriddenAt: string | null;
  finalUnitRate: string | null;
  gstPercent: string | null;
  taxableValue: string | null;
  cgstAmount: string | null;
  sgstAmount: string | null;
  igstAmount: string | null;
}
export interface TaxInvoiceHsnSummary {
  hsnCode: string;
  gstPercent: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
}
export interface TaxInvoiceView {
  id: string;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  invoiceNumber: string | null;
  ervePackingList: { id: string; ervePackingListNumber: string; status: string };
  erveDispatch: { id: string; erveDispatchNumber: string; status: string } | null;
  distributor: { id: string; code: string; name: string };
  purchaseMode: 'OUTRIGHT' | 'SALE_RETURN';
  seller: TaxInvoiceAddress & {
    id: string;
    branchCode: string;
    legalName: string;
    tradeName: string | null;
    gstin: string;
    stateCode: string;
    einvoiceApplicable: boolean;
    bankName: string;
    bankAccountName: string;
    bankAccountNumber: string;
    bankIfsc: string;
    bankBranchName: string;
    bankAddress: string | null;
  };
  billTo: TaxInvoiceAddress & { name: string; gstin: string; stateCode: string | null };
  shipTo: TaxInvoiceAddress & { label: string | null };
  gstTreatment: 'INTRA' | 'INTER' | null;
  financialYear: { id: string; code: string } | null;
  lines: TaxInvoiceLineView[];
  subtotal: string | null;
  totalCgst: string | null;
  totalSgst: string | null;
  totalIgst: string | null;
  totalGst: string | null;
  grandTotal: string | null;
  payableTotal: string | null;
  roundOffAdjustment: string | null;
  roundingPolicy: string | null;
  documentSnapshot: TaxInvoiceDocumentSnapshot | null;
  hsnSummary: TaxInvoiceHsnSummary[] | null;
  cancelledAt: string | null;
  cancelledBy: TaxInvoiceActor | null;
  cancellationReason: string | null;
  replacesInvoiceId: string | null;
  replacesInvoiceNumber: string | null;
  replacedByInvoiceId: string | null;
  replacedByInvoiceNumber: string | null;
  createdBy: TaxInvoiceActor;
  createdAt: string;
  updatedAt: string;
  finalizedBy: TaxInvoiceActor | null;
  finalizedAt: string | null;
  version: number;
}
export interface TaxInvoiceReviewView extends TaxInvoiceView {
  review: {
    state: 'READY' | 'BLOCKED' | 'FINALIZED' | 'CANCELLED';
    isPreview: boolean;
    calculatedAt: string | null;
    blockers: Array<{ code: string; message: string }>;
  };
}
export interface CancelTaxInvoiceInput {
  reason: string;
}
export interface CreateTaxInvoiceDraftInput {
  ervePackingListId: string;
  replacesInvoiceId?: string;
}
export interface TaxInvoiceAuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: Pick<TaxInvoiceActor, 'id' | 'name'> | null;
}
export interface TaxInvoiceSource {
  id: string;
  ervePackingListNumber: string;
  status: string;
  finalizedAt: string | null;
  destinationLabel: string | null;
  distributor: { id: string; code: string; name: string } | null;
  commercialSnapshotAvailable: boolean;
}
export interface TaxInvoiceArchivedImage {
  id: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}
/** Current Primary media exposed only in authorized Draft invoice presentation. */
export interface TaxInvoiceDraftImage {
  id: string;
  mimeType: string;
  updatedAt: string;
}

export interface TaxInvoiceDocumentSnapshot {
  schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1';
  lines: Array<{
    lineId: string;
    quantity: number;
    style: {
      id: string;
      styleNumber: string;
      styleName: string;
      description: string | null;
      colour: string | null;
    };
    size: { id: string; code: string; label: string; sortOrder?: number };
    image: TaxInvoiceArchivedImage | null;
    imageAvailability: 'ARCHIVED' | 'NO_IMAGE' | 'SOURCE_UNAVAILABLE';
  }>;
  dispatchOrders: Array<{ id: string; number: string; cartonIds: string[] }>;
  transport: {
    erveDispatchId: string;
    lrNumber: string | null;
    transporter: string | null;
    vehicleNumber: string | null;
  } | null;
  // Current operational relationships never create a historical EISO mapping.
  historicalBuyerOrderReference: { kind: 'HISTORICAL_EISO'; value: string } | null;
}
