import type {
  ErveDispatchStatus,
  ErvePackingListStatus,
  FactoryDispatchStatus,
  InvoiceHandoffStatus,
  PackingAuditState,
} from '../../types.js';

/**
 * Shared label maps for the Phase 5 fulfillment PDFs, mirroring the exact wording the on-screen
 * badges already use (PackingListPage.tsx's auditStateBadge, PackingAuditQueuePage.tsx, and the
 * "Ready for Erve"/"Draft" status text on both PackingListPage.tsx and FactoryPackingQueuePage.tsx)
 * so a printed document can never drift from the live UI's own terminology. No PASS/FAIL is ever
 * introduced here — PackingAuditState has exactly three derived values, never a pass/fail concept.
 */
export const PACKING_AUDIT_STATE_LABELS: Record<PackingAuditState, string> = {
  NOT_INSPECTED: 'Not Inspected',
  INSPECTED: 'Inspected',
  NEEDS_REINSPECTION: 'Needs Reinspection',
};

export const FACTORY_DISPATCH_STATUS_LABELS: Record<FactoryDispatchStatus, string> = {
  DRAFT: 'Draft',
  READY_FOR_ERVE: 'Ready for Erve',
};

/** Mirrors ErvePackingListDetailPage.tsx/ErvePackingListListPage.tsx's STATUS_LABEL. */
export const ERVE_PACKING_LIST_STATUS_LABELS: Record<ErvePackingListStatus, string> = {
  OPEN: 'Open',
  FINALIZED: 'Finalized',
  DISPATCHED: 'Dispatched',
};

/** Mirrors ErveDispatchDetailPage.tsx's status badge text. */
export const ERVE_DISPATCH_STATUS_LABELS: Record<ErveDispatchStatus, string> = {
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
};

/** Mirrors InvoiceHandoffListPage.tsx/InvoiceHandoffDetailPage.tsx's status badge text. */
export const INVOICE_HANDOFF_STATUS_LABELS: Record<InvoiceHandoffStatus, string> = {
  PENDING_TALLY: 'Pending Tally',
  INVOICED: 'Invoiced',
};
