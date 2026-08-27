import { toCompactFinancialYearCode } from './financial-year.util.js';

// Business-confirmed prefixes — "EI" + document abbreviation, matching the
// confirmed Sale Order convention (EISO/25-26/0103).
export const DOCUMENT_PREFIXES = {
  PURCHASE_ORDER: 'EIPO',
  JOB_ORDER: 'EIJO',
  SALE_ORDER: 'EISO',
} as const;

// MINIMUM width — pads short serials up to 4 digits but never truncates
// (10000 stays "10000"). The confirmed business example (EISO/25-26/0103)
// proves 4-digit padding, not a hard cap; treat as a strict fixed width only
// if the business later confirms that explicitly.
export const DOCUMENT_SERIAL_MIN_WIDTH = 4;

/** `formatDocumentNumber('EIPO', '2026-27', 1) === 'EIPO/26-27/0001'` */
export function formatDocumentNumber(prefix: string, financialYearCode: string, serial: number): string {
  return `${prefix}/${toCompactFinancialYearCode(financialYearCode)}/${String(serial).padStart(
    DOCUMENT_SERIAL_MIN_WIDTH,
    '0',
  )}`;
}
