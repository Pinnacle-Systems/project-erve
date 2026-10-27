/** Expands backend decimal strings (including scientific notation) without passing through Number. */
function parseInvoiceAmount(value: string): string | null {
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(value);
  if (scientific) {
    const exponent = Number(scientific[4]);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
    const whole = scientific[2]!;
    const digits = whole + (scientific[3] ?? '');
    const point = whole.length + exponent;
    value =
      scientific[1] +
      (point <= 0
        ? `0.${'0'.repeat(-point)}${digits}`
        : point >= digits.length
          ? digits + '0'.repeat(point - digits.length)
          : `${digits.slice(0, point)}.${digits.slice(point)}`);
  }
  return /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
}

/**
 * Exact backend decimal string, sign-normalized and with no currency formatting or rounding.
 * For internal summation/grouping use (sumInvoiceAmounts, line-identity keys) — never for display,
 * since it must not lose precision before those exact computations run.
 */
export function exactInvoiceAmount(value: string | null | undefined): string | null {
  if (value == null) return null;
  const parsed = parseInvoiceAmount(value);
  if (parsed === null) return null;
  const negative = parsed.startsWith('-');
  const [whole, fraction = ''] = parsed.replace(/^-/, '').split('.');
  return `${negative ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}`;
}

/** Decimal-safe round-half-up to exactly 2 fraction digits, via BigInt (never float). */
function roundToTwoDecimals(whole: string, fraction: string): { whole: string; fraction: string } {
  if (fraction.length <= 2) return { whole, fraction: fraction.padEnd(2, '0') };
  const keep = fraction.slice(0, 2);
  const roundUp = fraction.charCodeAt(2) >= 53; // charCode of '5'; only the next digit decides half-up
  if (!roundUp) return { whole, fraction: keep };
  const digits = (BigInt(whole + keep) + 1n).toString().padStart(whole.length + 2, '0');
  return { whole: digits.slice(0, -2), fraction: digits.slice(-2) };
}

/** Presentation only: rounds to exactly two decimals for display; never used for arithmetic. */
export function formatInvoiceMoney(value: string | null | undefined): string {
  if (value == null) return 'Unavailable';
  const parsed = parseInvoiceAmount(value);
  if (parsed === null) return 'Unavailable';
  const negative = parsed.startsWith('-');
  const [whole, fraction = ''] = parsed.replace(/^-/, '').split('.');
  const rounded = roundToTwoDecimals(whole!, fraction);
  const grouped = BigInt(rounded.whole).toLocaleString('en-IN');
  return `${negative ? '−' : ''}₹${grouped}.${rounded.fraction}`;
}

export function formatInvoiceAdjustment(value: string | null | undefined): string {
  if (value == null) return 'Not snapshotted';
  const money = formatInvoiceMoney(value);
  if (money === 'Unavailable') return money;
  return !value.startsWith('-') && /[1-9]/.test(value) ? `+${money}` : money;
}

export function invoiceIssuedAmount(invoice: {
  grandTotal: string | null;
  payableTotal: string | null;
}) {
  return invoice.payableTotal !== null
    ? { amount: invoice.payableTotal, label: 'Final payable' }
    : { amount: invoice.grandTotal, label: 'Original issued total' };
}

export function formatInvoiceDate(instant: string | null | undefined): string {
  return instant
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(instant))
    : 'Not allocated';
}

export function formatInvoiceTimestamp(instant: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}

export function invoiceAuditTitle(action: string): string {
  return (
    (
      {
        TAX_INVOICE_DRAFT_CREATED: 'Draft created',
        TAX_INVOICE_BILL_TO_REFRESHED: 'Draft Bill-To corrected',
        TAX_INVOICE_LINE_RATE_OVERRIDDEN: 'Unit rate overridden',
        TAX_INVOICE_FINALIZED: 'Invoice finalized and EI number allocated',
        TAX_INVOICE_CANCELLED: 'Invoice cancelled',
      } as Record<string, string>
    )[action] ?? action.replaceAll('_', ' ').toLowerCase()
  );
}
