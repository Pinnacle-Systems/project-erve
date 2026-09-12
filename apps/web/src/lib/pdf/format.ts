const EMPTY_VALUE = '—';

/** Formats a value for PDF display, falling back to an em dash for null/undefined/empty string. */
export function formatPdfValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === 'string' && value.trim() === '') return EMPTY_VALUE;
  return String(value);
}

/** Formats an ISO date/datetime string as `dd MMM yyyy` in the browser's local timezone. */
export function formatPdfDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Formats an ISO date/datetime string as `dd MMM yyyy, HH:mm` in the browser's local timezone. */
export function formatPdfDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** Formats a plain (non-currency) quantity/amount with 2 decimal places, right-alignment friendly. */
export function formatPdfNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY_VALUE;
  return value.toFixed(decimals);
}

/**
 * Formats a currency amount with its ISO code prefix (e.g. "INR 249.50"), never a currency
 * symbol: PDFDocument's Helvetica (one of the PDF spec's base-14 fonts) has no glyph for "₹" —
 * the app's on-screen `₹` convention (price-list-ui.ts's `formatPrice`) silently renders as a
 * broken superscript glyph in an actual PDF viewer, so the printed document intentionally
 * diverges from the screen here. Zero renders as "INR 0.00", never the empty-value dash — only
 * null/undefined do.
 */
export function formatPdfMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EMPTY_VALUE;
  return `${currency} ${value.toFixed(2)}`;
}

export { EMPTY_VALUE as PDF_EMPTY_VALUE };
