import { describe, expect, it } from 'vitest';
import type { JobOrderStatus } from '@erve/types';
import type { Prisma } from '../../db/prisma.js';
import { buildDelayedJobOrderWhere, isJobOrderDelayed } from './job-order-operational-state.js';

// Parity harness for RPT0 4.4: `buildDelayedJobOrderWhere` must stay
// logically equivalent to `isJobOrderDelayed` so a reporting aggregate
// counts exactly the same Job Orders the existing view already flags as
// delayed. Rather than round-tripping through a real Postgres query (which
// only proves Prisma/Postgres itself understands `in`/`not`/`lt` — not
// that this file's business logic is right), this evaluates the produced
// `where` object in plain JS against the same fixture row `isJobOrderDelayed`
// would receive, using the well-documented meaning of each Prisma filter
// operator this shape actually uses.
function evaluateDelayedWhere(
  where: Prisma.JobOrderWhereInput,
  row: { status: JobOrderStatus; requiredDeliveryDate: Date | null },
): boolean {
  const statusFilter = where.status as { in: readonly JobOrderStatus[] };
  const dateFilter = where.requiredDeliveryDate as { not: null; lt: Date };
  if (!statusFilter.in.includes(row.status)) return false;
  if (row.requiredDeliveryDate === null) return false;
  return row.requiredDeliveryDate.getTime() < dateFilter.lt.getTime();
}

const ALL_STATUSES: JobOrderStatus[] = [
  'DRAFT',
  'SENT_TO_FACTORY',
  'CONFIRMED_BY_FACTORY',
  'IN_PRODUCTION',
  'PRODUCTION_COMPLETE',
  'READY_FOR_QA',
  'QA_IN_PROGRESS',
  'REWORK_REQUIRED',
  'READY_FOR_REINSPECTION',
  'QA_APPROVED',
  'QA_PASSED',
  'PARTIALLY_QA_PASSED',
  'CLOSED',
  'CANCELLED',
];

describe('buildDelayedJobOrderWhere parity with isJobOrderDelayed', () => {
  const businessToday = new Date('2026-09-12T00:00:00.000Z'); // IST calendar date 12 Sep 2026 at IST midnight
  const before = new Date('2026-09-11T00:00:00.000Z');
  const wellBefore = new Date('2026-09-01T00:00:00.000Z');
  const onBoundary = businessToday; // required delivery date === businessToday itself
  const after = new Date('2026-09-13T00:00:00.000Z');
  const where = buildDelayedJobOrderWhere(businessToday);

  it.each(ALL_STATUSES)(
    'agrees with isJobOrderDelayed for status=%s, requiredDeliveryDate=null',
    (status) => {
      const row = { status, requiredDeliveryDate: null };
      expect(evaluateDelayedWhere(where, row)).toBe(
        isJobOrderDelayed({ status, requiredDeliveryDate: null, businessToday }),
      );
    },
  );

  it.each(ALL_STATUSES)(
    'agrees with isJobOrderDelayed for status=%s, requiredDeliveryDate before businessToday',
    (status) => {
      const row = { status, requiredDeliveryDate: before };
      expect(evaluateDelayedWhere(where, row)).toBe(
        isJobOrderDelayed({ status, requiredDeliveryDate: before, businessToday }),
      );
    },
  );

  it.each(ALL_STATUSES)(
    'agrees with isJobOrderDelayed for status=%s, requiredDeliveryDate well before businessToday',
    (status) => {
      const row = { status, requiredDeliveryDate: wellBefore };
      expect(evaluateDelayedWhere(where, row)).toBe(
        isJobOrderDelayed({ status, requiredDeliveryDate: wellBefore, businessToday }),
      );
    },
  );

  it.each(ALL_STATUSES)(
    'agrees with isJobOrderDelayed for status=%s, requiredDeliveryDate === businessToday (IST midnight boundary, not yet overdue)',
    (status) => {
      const row = { status, requiredDeliveryDate: onBoundary };
      expect(evaluateDelayedWhere(where, row)).toBe(
        isJobOrderDelayed({ status, requiredDeliveryDate: onBoundary, businessToday }),
      );
      expect(evaluateDelayedWhere(where, row)).toBe(false);
    },
  );

  it.each(ALL_STATUSES)(
    'agrees with isJobOrderDelayed for status=%s, requiredDeliveryDate in the future',
    (status) => {
      const row = { status, requiredDeliveryDate: after };
      expect(evaluateDelayedWhere(where, row)).toBe(
        isJobOrderDelayed({ status, requiredDeliveryDate: after, businessToday }),
      );
      expect(evaluateDelayedWhere(where, row)).toBe(false);
    },
  );

  it('flags an overdue CANCELLED job order as not delayed (excluded from OPEN_PRODUCTION_STATUSES)', () => {
    const row = { status: 'CANCELLED' as const, requiredDeliveryDate: wellBefore };
    expect(evaluateDelayedWhere(where, row)).toBe(false);
  });

  it('flags an overdue PRODUCTION_COMPLETE job order as not delayed', () => {
    const row = { status: 'PRODUCTION_COMPLETE' as const, requiredDeliveryDate: wellBefore };
    expect(evaluateDelayedWhere(where, row)).toBe(false);
  });

  it('flags an overdue open-status (e.g. DRAFT) job order as delayed', () => {
    const row = { status: 'DRAFT' as const, requiredDeliveryDate: wellBefore };
    expect(evaluateDelayedWhere(where, row)).toBe(true);
  });
});
