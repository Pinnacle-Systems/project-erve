import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, createEnterToNextHandler, PageHeader, StatusBadge, TotalsPanel } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { canConfirmFactoryInvoices, canEditFactoryInvoiceFinancials } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { FACTORY_INVOICE_STATUS_LABELS, factoryInvoiceStatusTone, formatMoney } from './factory-invoice-ui.js';
import { groupFinancialLinesByStyle } from './style-size-grouping.js';
import type { FactoryInvoiceView } from './types.js';

export function FactoryInvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canConfirm = canConfirmFactoryInvoices(user);
  const canEditFinancials = canEditFactoryInvoiceFinancials(user);

  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [gstInput, setGstInput] = useState<string | null>(null);
  const [remarksInput, setRemarksInput] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  const query = useQuery({
    queryKey: ['factory-invoice', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FactoryInvoiceView>>(`/factory-invoices/${id}`);
      return res.data.data;
    },
  });
  const invoice = query.data;

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['factory-invoice', id] });
  }

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<FactoryInvoiceView>>(`/factory-invoices/${id}/confirm`, {});
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setConfirmOpen(false);
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to confirm this Factory Invoice.')),
  });

  const saveFinancialsMutation = useMutation({
    mutationFn: async () => {
      const changedLines = (invoice?.lines ?? [])
        .map((line) => ({ id: line.id, unitRate: Number(rateInputs[line.id] ?? line.unitRate) }))
        .filter((line) => line.unitRate !== invoice!.lines.find((l) => l.id === line.id)!.unitRate);
      const res = await apiClient.patch<ApiSuccessResponse<FactoryInvoiceView>>(`/factory-invoices/${id}/financials`, {
        expectedVersion: invoice!.version,
        lines: changedLines.length > 0 ? changedLines : undefined,
        gstAmount: Number(gstInput ?? invoice!.gstAmount),
        remarks: remarksInput ?? invoice!.remarks,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setRateInputs({});
      setGstInput(null);
      setRemarksInput(null);
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to save financial changes.')),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<FactoryInvoiceView>>(`/factory-invoices/${id}/finalize`, {
        expectedVersion: invoice!.version,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setFinalizeOpen(false);
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to finalize this Factory Invoice.')),
  });

  const generateFactoryInvoiceDetailPdf = useCallback(async () => {
    if (!invoice) throw new Error('Factory Invoice not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateFactoryInvoiceDetailPdfBlob } = await import('./pdf/factory-invoice/generateFactoryInvoiceDetailPdf.js');
    return generateFactoryInvoiceDetailPdfBlob(invoice, { generatedAt: new Date().toISOString(), generatedBy: user?.name });
  }, [invoice, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateFactoryInvoiceDetailPdf,
    filename: () => buildPdfFilename(['ERVE-Factory-Invoice', invoice?.factoryDispatch.factoryDispatchNumber]),
  });

  if (query.isLoading) return <LoadingState label="Loading Factory Invoice" />;
  if (query.isError)
    return <ErrorState title="Unable to load Factory Invoice" description={query.error.message} />;
  if (!invoice) return <EmptyState title="Factory Invoice not found" tone="error" />;

  const editingFinancials = canEditFinancials && invoice.status === 'FACTORY_CONFIRMED';
  const hasFinancialChanges =
    Object.entries(rateInputs).some(([lineId, v]) => Number(v) !== invoice.lines.find((l) => l.id === lineId)?.unitRate) ||
    (gstInput != null && Number(gstInput) !== invoice.gstAmount) ||
    (remarksInput != null && remarksInput !== (invoice.remarks ?? ''));
  // ISS-010: outside active per-line Accountant editing, show one financially-compatible row per
  // Style (Style × Size duplication collapsed into a compact Size Breakdown) instead of one row
  // per source line. Accountant editing keeps the ungrouped per-line table below so every source
  // line's unit rate remains individually editable by its own id.
  const groupedLines = editingFinancials ? null : groupFinancialLinesByStyle(invoice.lines);
  const isFinalized = invoice.status === 'FINALIZED';
  // ISS-025: GST is invoice-level, ACCOUNTANT-only, editable any time between FACTORY_CONFIRMED and
  // FINALIZED (see factory-invoice.service.ts's updateFactoryInvoiceFinancials) — so right up until
  // FINALIZED it is never a settled, authoritative figure: it may still be the generation-time default
  // 0, or a value ACCOUNTANT has started entering but could still revise. A non-Accountant viewer
  // (FACTORY_USER, or ADMIN's read-only view) has no way to tell "not yet entered" apart from
  // "deliberately zero" and no authority to act on either, so for as long as the invoice is not
  // FINALIZED they see only the authoritative pre-tax production amount, never the GST figure itself.
  // ACCOUNTANT keeps the full, editable Subtotal/GST/Total breakdown at every status (clearly marked
  // provisional pre-finalization below) — a zero they entered stays visible and editable, never hidden.
  const showPreTaxConfirmation = !isFinalized && !canEditFinancials;

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.factoryDispatch.factoryDispatchNumber}
        subtitle={`${invoice.factory.name} · ${invoice.saleOrder.saleOrderNumber}`}
        status={<StatusBadge label={FACTORY_INVOICE_STATUS_LABELS[invoice.status]} tone={factoryInvoiceStatusTone(invoice.status)} />}
        secondaryActions={
          <>
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            <Button variant="secondary" onClick={() => navigate('/fulfillment/factory-invoices')}>
              Back
            </Button>
          </>
        }
        primaryAction={
          canConfirm && invoice.status === 'GENERATED' ? (
            <Button onClick={() => setConfirmOpen(true)} loading={confirmMutation.isPending}>
              Confirm Factory Invoice
            </Button>
          ) : editingFinancials ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => saveFinancialsMutation.mutate()}
                disabled={!hasFinancialChanges}
                loading={saveFinancialsMutation.isPending}
              >
                Save Changes
              </Button>
              <Button onClick={() => setFinalizeOpen(true)} loading={finalizeMutation.isPending}>
                Finalize
              </Button>
            </div>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={confirmOpen && canConfirm && invoice.status === 'GENERATED'}
        onOpenChange={setConfirmOpen}
        title="Confirm Factory Invoice?"
        description={`Confirm the pre-tax production amount ${formatMoney(invoice.subtotal)} for Factory Packing List ${invoice.factoryDispatch.factoryDispatchNumber}. GST and the final payable amount are determined later by Accounts.`}
        confirmLabel="Confirm Factory Invoice"
        cancelLabel="Continue Reviewing"
        loading={confirmMutation.isPending}
        onConfirm={() => { if (!confirmMutation.isPending) confirmMutation.mutate(); }}
      />
      <ConfirmDialog
        open={finalizeOpen && editingFinancials}
        onOpenChange={setFinalizeOpen}
        title="Finalize Factory Invoice?"
        description={`Finalize the Factory Invoice for ${invoice.factoryDispatch.factoryDispatchNumber}. Financial values will be locked. Save any unsaved changes before finalizing.`}
        confirmLabel="Finalize Factory Invoice"
        cancelLabel="Continue Editing"
        loading={finalizeMutation.isPending}
        onConfirm={() => { if (!finalizeMutation.isPending) finalizeMutation.mutate(); }}
      />
      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {invoice.status === 'GENERATED' && canEditFinancials && (
        <ValidationMessage tone="warning">
          Awaiting Factory Confirmation — financial values cannot be edited until the Factory confirms this invoice.
        </ValidationMessage>
      )}

      <div className="space-y-6" onKeyDown={createEnterToNextHandler()}>
        <Panel title="Invoice Details">
          <DescriptionList columns={4}>
            <DescriptionList.Item label="Factory" value={invoice.factory.name} />
            <DescriptionList.Item label="Dispatch Order" value={invoice.saleOrder.saleOrderNumber} />
            <DescriptionList.Item label="Factory Dispatch #" value={invoice.factoryDispatch.factoryDispatchNumber} />
            <DescriptionList.Item label="Generated" value={new Date(invoice.generatedAt).toLocaleString()} />
            {invoice.factoryConfirmedBy && (
              <DescriptionList.Item
                label="Factory Confirmed"
                value={`${invoice.factoryConfirmedBy.name} · ${invoice.factoryConfirmedAt ? new Date(invoice.factoryConfirmedAt).toLocaleString() : ''}`}
              />
            )}
            {invoice.finalizedBy && (
              <DescriptionList.Item
                label="Finalized"
                value={`${invoice.finalizedBy.name} · ${invoice.finalizedAt ? new Date(invoice.finalizedAt).toLocaleString() : ''}`}
              />
            )}
          </DescriptionList>
        </Panel>

        <Panel title="Lines" padding="none">
          {groupedLines ? (
            <DataTable
              rowKey="groupKey"
              data={groupedLines}
              columns={[
                {
                  key: 'style',
                  header: 'Style',
                  className: 'whitespace-normal max-w-xs break-words',
                  render: (g) => `${g.styleNumber} — ${g.styleName}`,
                },
                {
                  key: 'sizeBreakdown',
                  header: 'Size Breakdown',
                  className: 'whitespace-normal max-w-none break-words',
                  render: (g) => g.sizeEntries.map((entry) => `${entry.sizeLabel}: ${entry.quantity}`).join(' · '),
                },
                { key: 'totalQuantity', header: 'Total Qty', align: 'right', render: (g) => g.totalQuantity.toLocaleString() },
                {
                  key: 'rate',
                  header: 'Rate',
                  align: 'right',
                  render: (g) => (
                    <span>
                      {formatMoney(g.unitRate)}
                      {g.rateOverridden && (
                        <span className="ml-1 text-xs text-muted-foreground">(default {formatMoney(g.defaultRate)})</span>
                      )}
                    </span>
                  ),
                },
                { key: 'amount', header: 'Amount', align: 'right', render: (g) => formatMoney(g.amount) },
              ]}
            />
          ) : (
            <DataTable
              rowKey="id"
              data={invoice.lines}
              columns={[
                { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
                { key: 'size', header: 'Size', accessor: 'sizeLabel' },
                { key: 'qty', header: 'Quantity', align: 'right', render: (r) => r.quantity.toLocaleString() },
                { key: 'default', header: 'Default Rate', align: 'right', render: (r) => formatMoney(r.defaultRate) },
                {
                  key: 'unitRate',
                  header: 'Unit Rate',
                  align: 'right',
                  render: (r) => (
                    <TextField
                      aria-label={`Unit rate for ${r.styleNumber} ${r.sizeLabel}`}
                      type="number"
                      min={0.01}
                      step={0.01}
                      density="compact"
                      width="xs"
                      value={rateInputs[r.id] ?? String(r.unitRate)}
                      onChange={(e) => setRateInputs((current) => ({ ...current, [r.id]: e.target.value }))}
                    />
                  ),
                },
                { key: 'amount', header: 'Line Amount', align: 'right', render: (r) => formatMoney(r.lineAmount) },
              ]}
            />
          )}
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          {showPreTaxConfirmation ? (
            <TotalsPanel
              title={invoice.status === 'GENERATED' ? 'Factory Amount Confirmation' : 'Production Amount'}
              description="GST and the final payable total are not final until the invoice is finalized."
              items={[{ label: 'Production Amount (Before GST)', value: formatMoney(invoice.subtotal), emphasis: 'strong' }]}
            />
          ) : (
            <TotalsPanel
              title="Totals"
              description={!isFinalized ? 'Provisional — GST and Total are not final until the invoice is finalized.' : undefined}
              items={[
                { label: 'Subtotal', value: formatMoney(invoice.subtotal) },
                {
                  label: 'GST',
                  value: editingFinancials ? (
                    <TextField
                      aria-label="GST amount"
                      type="number"
                      min={0}
                      step={0.01}
                      density="compact"
                      width="xs"
                      value={gstInput ?? String(invoice.gstAmount)}
                      onChange={(e) => setGstInput(e.target.value)}
                    />
                  ) : (
                    formatMoney(invoice.gstAmount)
                  ),
                },
                { label: 'Total', value: formatMoney(invoice.total), emphasis: 'strong', dividerBefore: true },
              ]}
            />
          )}
          <Panel title="Remarks">
            {editingFinancials ? (
              <TextField
                aria-label="Remarks"
                value={remarksInput ?? (invoice.remarks ?? '')}
                onChange={(e) => setRemarksInput(e.target.value)}
              />
            ) : (
              <div className="text-sm text-muted-foreground">{invoice.remarks || '—'}</div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
