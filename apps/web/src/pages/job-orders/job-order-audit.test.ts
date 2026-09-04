import { describe, expect, it } from 'vitest';
import { formatJobOrderAuditTitle } from './job-order-audit.js';

describe('formatJobOrderAuditTitle', () => {
  it('includes the stage name for a stage-completed entry', () => {
    expect(
      formatJobOrderAuditTitle('JOB_ORDER_STAGE_COMPLETED', { stageName: 'Cutting' }),
    ).toBe('Production stage completed — Cutting');
  });

  it('includes the stage name for a stage-started entry, matching the completed convention', () => {
    expect(formatJobOrderAuditTitle('JOB_ORDER_STAGE_STARTED', { stageName: 'Cutting' })).toBe(
      'Production stage started — Cutting',
    );
  });

  it('falls back to a generic title when stage-started metadata carries no stage name', () => {
    expect(formatJobOrderAuditTitle('JOB_ORDER_STAGE_STARTED', {})).toBe('Job order stage started');
    expect(formatJobOrderAuditTitle('JOB_ORDER_STAGE_STARTED', null)).toBe(
      'Job order stage started',
    );
  });
});
