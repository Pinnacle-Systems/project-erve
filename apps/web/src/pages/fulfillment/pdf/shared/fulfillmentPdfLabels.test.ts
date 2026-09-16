import { describe, expect, it } from 'vitest';
import { FACTORY_DISPATCH_STATUS_LABELS, PACKING_AUDIT_STATE_LABELS } from './fulfillmentPdfLabels.js';

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
});
