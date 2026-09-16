import { describe, expect, it } from 'vitest';
import {
  ERVE_DISPATCH_STATUS_LABELS,
  ERVE_PACKING_LIST_STATUS_LABELS,
  FACTORY_DISPATCH_STATUS_LABELS,
  INVOICE_HANDOFF_STATUS_LABELS,
  PACKING_AUDIT_STATE_LABELS,
} from './fulfillmentPdfLabels.js';

describe('fulfillmentPdfLabels', () => {
  it('maps every PackingAuditState value without inventing PASS/FAIL', () => {
    expect(PACKING_AUDIT_STATE_LABELS).toEqual({
      NOT_INSPECTED: 'Not Inspected',
      INSPECTED: 'Inspected',
      NEEDS_REINSPECTION: 'Needs Reinspection',
    });
    expect(Object.values(PACKING_AUDIT_STATE_LABELS).join(' ')).not.toMatch(/pass|fail/i);
  });

  it('maps every FactoryDispatchStatus value matching the on-screen badge text', () => {
    expect(FACTORY_DISPATCH_STATUS_LABELS).toEqual({
      DRAFT: 'Draft',
      READY_FOR_ERVE: 'Ready for Erve',
    });
  });

  it('maps every ErvePackingListStatus value matching the on-screen badge text', () => {
    expect(ERVE_PACKING_LIST_STATUS_LABELS).toEqual({
      OPEN: 'Open',
      FINALIZED: 'Finalized',
      DISPATCHED: 'Dispatched',
    });
  });

  it('maps every ErveDispatchStatus value matching the on-screen badge text', () => {
    expect(ERVE_DISPATCH_STATUS_LABELS).toEqual({
      DISPATCHED: 'Dispatched',
      DELIVERED: 'Delivered',
    });
  });

  it('maps every InvoiceHandoffStatus value matching the on-screen badge text', () => {
    expect(INVOICE_HANDOFF_STATUS_LABELS).toEqual({
      PENDING_TALLY: 'Pending Tally',
      INVOICED: 'Invoiced',
    });
  });
});
