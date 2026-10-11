/** Presentation only: preserve backend decimal strings without arithmetic. */
export function formatInvoiceMoney(value: string | null | undefined): string {
  if (value == null) return 'Unavailable';
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(value);
  if (scientific) {
    // Expand notation lexically. The amount never passes through Number.
    const exponent = Number(scientific[4]);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return 'Unavailable';
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
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return 'Unavailable';
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const grouped = BigInt(whole!).toLocaleString('en-IN');
  return `${negative ? '−' : ''}₹${grouped}.${fraction.padEnd(2, '0')}`;
}

export function formatInvoiceAdjustment(value: string | null | undefined): string {
  if (value == null) return 'Not snapshotted';
  const money = formatInvoiceMoney(value);
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
        TAX_INVOICE_LINE_RATE_OVERRIDDEN: 'Unit rate overridden',
        TAX_INVOICE_FINALIZED: 'Invoice finalized and EI number allocated',
      } as Record<string, string>
    )[action] ?? action.replaceAll('_', ' ').toLowerCase()
  );
}
