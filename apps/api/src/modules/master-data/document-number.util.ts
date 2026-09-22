import { toCompactFinancialYearCode } from './financial-year.util.js';

// Business-confirmed prefixes — "EI" + document abbreviation, matching the
// confirmed Sale Order convention (EISO/25-26/0103).
export const DOCUMENT_PREFIXES = {
  // "Order Sheet" business terminology (formerly "Purchase Order"); the
  // DocumentType enum member/table names are unchanged (see the Order Sheet
  // rename plan) — only this prefix string moved from EIPO to EIOS. Existing
  // EIPO-numbered documents are untouched; no historical renumbering.
  PURCHASE_ORDER: 'EIOS',
  JOB_ORDER: 'EIJO',
  SALE_ORDER: 'EISO',
  // No original-scope-specified prefix exists for these three (see the
  // fulfillment audit) — chosen to follow the same "EI" + short document
  // abbreviation convention as the three above.
  FACTORY_DISPATCH: 'EIFD',
  ERVE_PACKING_LIST: 'EIPL',
  ERVE_DISPATCH: 'EIED',
  // No original-scope-specified prefix for Distributor Return either — same
  // "EI" + short document abbreviation convention as the three above.
  DISTRIBUTOR_RETURN: 'EIDR',
  // Historical-import module only (apps/api/src/modules/historical-import/).
  // Deliberately distinct from JOB_ORDER/EIJO and its own DocumentSequence
  // row — a historical Job Order never allocates a live EIJO serial. This
  // exists only because JobOrder.jobOrderNumber is still NOT NULL @unique;
  // the real historical identity is JobOrder.legacyReferenceNumber (e.g.
  // "EI25001"), not this value.
  HISTORICAL_JOB_ORDER: 'EIJOH',
} as const;

// MINIMUM width — pads short serials up to 4 digits but never truncates
// (10000 stays "10000"). The confirmed business example (EISO/25-26/0103)
// proves 4-digit padding, not a hard cap; treat as a strict fixed width only
// if the business later confirms that explicitly.
export const DOCUMENT_SERIAL_MIN_WIDTH = 4;

/** `formatDocumentNumber('EIOS', '2026-27', 1) === 'EIOS/26-27/0001'` */
export function formatDocumentNumber(prefix: string, financialYearCode: string, serial: number): string {
  return `${prefix}/${toCompactFinancialYearCode(financialYearCode)}/${String(serial).padStart(
    DOCUMENT_SERIAL_MIN_WIDTH,
    '0',
  )}`;
}
