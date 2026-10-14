export function assertUnissuedDraft(
  invoice: { status: string; invoiceNumber: string | null } | null,
  numberedInvoiceCount: number,
) {
  if (
    !invoice ||
    invoice.status !== 'DRAFT' ||
    invoice.invoiceNumber !== null ||
    numberedInvoiceCount !== 0
  )
    throw new Error(
      'PR8 acceptance requires a live unnumbered Tax Invoice Draft and no issued invoices',
    );
}
export function assertNoUncertainRequest(
  pending: Record<string, unknown>,
  completed: Record<string, unknown>,
) {
  if (Object.keys(pending).some((key) => !completed[key]))
    throw new Error(
      'An earlier HTTP request may have committed before checkpointing; reconciliation is required before retry. Preserve the disposable target.',
    );
}
