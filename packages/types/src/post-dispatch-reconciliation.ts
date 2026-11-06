export type ReconciliationReviewAction = 'ACKNOWLEDGE' | 'FOLLOW_UP' | 'FINANCE_REVIEW';

export interface ReconciliationSummary {
  id: string;
  dispatchNumber: string;
  distributorId: string;
  distributorName: string;
  dispatchDate: string;
  dispatchedQuantity: number;
  cartonCount: number;
  qrConfirmed: number;
  qrPending: number;
  receiptId: string | null;
  receivedQuantity: number | null;
  shortageQuantity: number | null;
  ledgerQuantity: number | null;
  ledgerSource: string | null;
  ledgerDisposition: string | null;
  awaitingReceipt: boolean;
  receiptMatchesLedger: boolean;
  receiptDiffers: boolean;
  nothingReceived: boolean;
  hasShortage: boolean;
  downstreamActivity: boolean;
  followUpRequired: boolean;
  snapshotToken: string;
  latestReviewId: string | null;
  latestReviewAction: ReconciliationReviewAction | null;
  pendingReview: boolean;
}

export interface ReconciliationLine {
  saleOrderLineId: string;
  saleOrderNumber: string;
  purchaseMode: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeLabel: string;
  sizeSortOrder: number;
  dispatchedQuantity: number;
  receivedQuantity: number | null;
  ledgerQuantity: number | null;
  difference: number | null;
  differs: boolean;
  shortageQuantity: number | null;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  availableForActualSale: number | null;
  availableForNewReturn: number | null;
}

export interface ReconciliationDetail {
  summary: ReconciliationSummary;
  lines: ReconciliationLine[];
  cartons: Array<{ id: string; cartonNumber: string; confirmedAt: string | null }>;
  receipt: {
    receivedAt: string;
    receivedBy: string;
    remarks: string | null;
    priorSource: string | null;
    priorRemarks: string | null;
  } | null;
  ledger: { recordedBy: string | null; recordedAt: string | null; remarks: string | null };
  reviews: Array<{
    id: string;
    action: ReconciliationReviewAction;
    remarks: string;
    actor: { id: string; name: string };
    createdAt: string;
    snapshotToken: string;
    snapshot: unknown;
  }>;
}

export interface ReconciliationQueue {
  items: ReconciliationSummary[];
  total: number;
  page: number;
  pageSize: number;
}
