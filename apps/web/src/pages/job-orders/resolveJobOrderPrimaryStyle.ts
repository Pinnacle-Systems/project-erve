import type { JobOrderLine } from '@erve/types';

export type JobOrderPrimaryStyle = Pick<JobOrderLine, 'styleId' | 'styleNumber' | 'styleName' | 'primaryImage'>;

export type JobOrderPrimaryStyleResult =
  | { consistent: true; style: JobOrderPrimaryStyle }
  | { consistent: false };

/**
 * A Job Order's lines legitimately differ by Size/allocation, never by
 * Style, per the business model — but the schema technically allows a
 * JobOrderLine[] with more than one distinct styleId (see job-orders
 * module docs). Shared by both the Job Order detail page header and
 * JobOrderDetailDocument so the invariant check is written once: when
 * legacy/inconsistent data violates it (`consistent: false`), every caller
 * must show the existing honest missing-image fallback instead of guessing
 * one line's Style/image, and should surface the inconsistency through its
 * own operational-visibility channel — this function stays pure (no
 * logging side effect) so it stays trivially testable; it never mutates
 * the underlying data to force consistency.
 */
export function resolveJobOrderPrimaryStyle(lines: JobOrderPrimaryStyle[]): JobOrderPrimaryStyleResult {
  const first = lines[0];
  if (!first) return { consistent: false };
  const allSameStyle = lines.every((line) => line.styleId === first.styleId);
  if (!allSameStyle) return { consistent: false };
  return { consistent: true, style: first };
}
