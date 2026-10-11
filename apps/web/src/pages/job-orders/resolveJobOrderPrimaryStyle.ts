import type { JobOrderLine } from '@erve/types';

export type JobOrderPrimaryStyle = Pick<JobOrderLine, 'styleId' | 'styleNumber' | 'styleName' | 'primaryImage'>;

export type JobOrderPrimaryStyleResult =
  | { consistent: true; style: JobOrderPrimaryStyle }
  | { consistent: false };

/**
 * A Job Order is exactly one Style — server-enforced on create and on
 * adding a source Order Sheet (`job-orders.service.ts`: "All source Order
 * Sheets (and the Job Order) must share one Style"). Lines legitimately
 * differ by Size/allocation (one line per consolidated source Order Sheet),
 * never by Style; the schema's JobOrderLine[] shape simply doesn't carry
 * that guarantee as a type-level constraint, so this is a defensive check,
 * not a "Job Orders can have several Styles" case. Shared by both the Job
 * Order detail page header and JobOrderDetailDocument so the check is
 * written once: when legacy/corrupted data violates it (`consistent:
 * false`), every caller must show an explicit "identity unavailable"
 * state — never nothing, and never a guess at one line's Style/image — and
 * should surface the inconsistency through its own operational-visibility
 * channel. This function stays pure (no logging side effect) so it stays
 * trivially testable; it never mutates the underlying data to force
 * consistency.
 */
export function resolveJobOrderPrimaryStyle(lines: JobOrderPrimaryStyle[]): JobOrderPrimaryStyleResult {
  const first = lines[0];
  if (!first) return { consistent: false };
  const allSameStyle = lines.every((line) => line.styleId === first.styleId);
  if (!allSameStyle) return { consistent: false };
  return { consistent: true, style: first };
}
