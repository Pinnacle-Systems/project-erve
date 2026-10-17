import type { JobOrder } from '../types.js';
import { resolveJobOrderPrimaryStyle } from '../resolveJobOrderPrimaryStyle.js';

/** Validate the API identity against the one-Style line invariant; never guess from a line. */
export function resolveJobOrderListPdfStyle(jobOrder: JobOrder): JobOrder['primaryStyle'] {
  const primary = jobOrder.primaryStyle;
  const lines = resolveJobOrderPrimaryStyle(jobOrder.lines);
  if (!primary.consistent || !lines.consistent || primary.style.id !== lines.style.styleId) {
    return { consistent: false };
  }
  return primary;
}
