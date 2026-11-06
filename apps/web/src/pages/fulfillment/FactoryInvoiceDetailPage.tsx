import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, createEnterToNextHandler, PageHeader, StatusBadge, TotalsPanel } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorCode, getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { canConfirmFactoryInvoices, canEditFactoryInvoiceFinancials } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { FACTORY_INVOICE_STATUS_LABELS, factoryInvoiceStatusTone, formatMoney } from './factory-invoice-ui.js';
import { groupFinancialLinesByStyle } from './style-size-grouping.js';
import type { FactoryInvoiceView } from './types.js';

// Amounts are stored to 2 decimal places (matches the server's validation).
function isMoneyInput(value: string): boolean {
  if (value.trim() === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;
}

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

  // Confirmation names the exact saved version the Factory User is looking at, so the server can
  // refuse (409) if Accounts saved a rate/GST change after this page loaded.
  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<FactoryInvoiceView>>(`/factory-invoices/${id}/confirm`, {
        expectedVersion: invoice!.version,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setConfirmOpen(false);
      return invalidate();
    },
    onError: (caught) => {
      setFormError(getApiErrorMessage(caught, 'Unable to confirm this Factory Invoice.'));
      if (getApiErrorCode(caught) === 'STALE_VERSION') {
        // The invoice changed under the reviewer: close the dialog and reload so the updated values
        // are on screen; confirming again needs a fresh, deliberate click on the latest invoice.
        setConfirmOpen(false);
        return invalidate();
      }
    },
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
    onError: (caught) => {
      setFormError(getApiErrorMessage(caught, 'Unable to save financial changes.'));
      // Stale (409) or already locked by a Factory confirmation (400): reload the saved invoice.
      return invalidate();
    },
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

  const isGenerated = invoice.status === 'GENERATED';
  // The invoice is an expected billing statement: Accounts may correct rates/GST only until the Factory
  // confirms it (factory-invoice.service.ts's updateFactoryInvoiceFinancials accepts GENERATED only);
  // Factory confirmation locks every financial value for every role.
  const editingFinancials = canEditFinancials && isGenerated;
  const rateInputInvalid = Object.values(rateInputs).some((v) => !isMoneyInput(v) || Number(v) <= 0);
  const gstInputInvalid = gstInput != null && (!isMoneyInput(gstInput) || Number(gstInput) < 0);
  const hasFinancialChanges =
    Object.entries(rateInputs).some(([lineId, v]) => Number(v) !== invoice.lines.find((l) => l.id === lineId)?.unitRate) ||
    (gstInput != null && Number(gstInput) !== invoice.gstAmount) ||
    (remarksInput != null && remarksInput !== (invoice.remarks ?? ''));
  // ISS-010: outside active per-line Accountant editing, show one financially-compatible row per
  // Style (Style × Size duplication collapsed into a compact Size Breakdown) instead of one row
  // per source line. Accountant editing keeps the ungrouped per-line table below so every source
  // line's unit rate remains individually editable by its own id.
  const groupedLines = editingFinancials ? null : groupFinancialLinesByStyle(invoice.lines);
  const totalsDescription =
    invoice.status === 'GENERATED'
      ? editingFinancials
        ? 'Expected invoice — you can update rates and GST until the Factory confirms.'
        : 'Expected invoice — Accounts may still update rates and GST until the Factory confirms.'
      : invoice.status === 'FACTORY_CONFIRMED'
        ? 'Confirmed by the Factory — these values are locked.'
        : undefined;

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
          canConfirm && isGenerated ? (
            <Button onClick={() => { setFormError(''); setConfirmOpen(true); }} loading={confirmMutation.isPending}>
              Confirm Factory Invoice
            </Button>
          ) : editingFinancials ? (
            <Button
              onClick={() => saveFinancialsMutation.mutate()}
              disabled={!hasFinancialChanges || rateInputInvalid || gstInputInvalid}
              loading={saveFinancialsMutation.isPending}
            >
              Save Changes
            </Button>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={confirmOpen && canConfirm && isGenerated}
        onOpenChange={setConfirmOpen}
        title="Confirm Factory Invoice?"
        description={`Confirm the expected invoice for Factory Packing List ${invoice.factoryDispatch.factoryDispatchNumber}: Subtotal ${formatMoney(invoice.subtotal)} + GST ${formatMoney(invoice.gstAmount)} = Expected Invoice Total ${formatMoney(invoice.total)}. Once confirmed, these values are locked.`}
        confirmLabel="Confirm Factory Invoice"
        cancelLabel="Continue Reviewing"
        loading={confirmMutation.isPending}
        error={formError || undefined}
        onConfirm={() => { if (!confirmMutation.isPending) confirmMutation.mutate(); }}
      />
      {formError && !confirmOpen && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {rateInputInvalid && (
        <ValidationMessage tone="error">Unit rates must be greater than zero, with at most 2 decimal places.</ValidationMessage>
      )}
      {gstInputInvalid && (
        <ValidationMessage tone="error">GST must be zero or more, with at most 2 decimal places.</ValidationMessage>
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
                label="Finalized (legacy)"
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
          <TotalsPanel
            title="Expected Invoice Total"
            description={totalsDescription}
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
              { label: 'Expected Invoice Total', value: formatMoney(invoice.total), emphasis: 'strong', dividerBefore: true },
            ]}
          />
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
