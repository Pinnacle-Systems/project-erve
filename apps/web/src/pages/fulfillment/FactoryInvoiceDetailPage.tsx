import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge, TotalsPanel } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { canConfirmFactoryInvoices, canEditFactoryInvoiceFinancials } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { FACTORY_INVOICE_STATUS_LABELS, factoryInvoiceStatusTone, formatMoney } from './factory-invoice-ui.js';
import type { FactoryInvoiceView } from './types.js';

const PRINT_STYLE = `
@media print {
  body * { visibility: hidden; }
  #factory-invoice-print, #factory-invoice-print * { visibility: visible; }
  #factory-invoice-print { position: absolute; top: 0; left: 0; width: 100%; }
}`;

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
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to finalize this Factory Invoice.')),
  });

  if (query.isLoading) return <LoadingState label="Loading Factory Invoice" />;
  if (!invoice) return <EmptyState title="Factory Invoice not found" tone="error" />;

  const editingFinancials = canEditFinancials && invoice.status === 'FACTORY_CONFIRMED';
  const hasFinancialChanges =
    Object.entries(rateInputs).some(([lineId, v]) => Number(v) !== invoice.lines.find((l) => l.id === lineId)?.unitRate) ||
    (gstInput != null && Number(gstInput) !== invoice.gstAmount) ||
    (remarksInput != null && remarksInput !== (invoice.remarks ?? ''));

  return (
    <div className="space-y-6">
      <style>{PRINT_STYLE}</style>
      <PageHeader
        title={invoice.factoryDispatch.factoryDispatchNumber}
        subtitle={`${invoice.factory.name} · ${invoice.saleOrder.saleOrderNumber}`}
        status={<StatusBadge label={FACTORY_INVOICE_STATUS_LABELS[invoice.status]} tone={factoryInvoiceStatusTone(invoice.status)} />}
        secondaryActions={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="secondary" onClick={() => navigate('/fulfillment/factory-invoices')}>
              Back
            </Button>
          </>
        }
        primaryAction={
          canConfirm && invoice.status === 'GENERATED' ? (
            <Button onClick={() => confirmMutation.mutate()} loading={confirmMutation.isPending}>
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
              <Button onClick={() => finalizeMutation.mutate()} loading={finalizeMutation.isPending}>
                Finalize
              </Button>
            </div>
          ) : undefined
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {invoice.status === 'GENERATED' && canEditFinancials && (
        <ValidationMessage tone="warning">
          Awaiting Factory Confirmation — financial values cannot be edited until the Factory confirms this invoice.
        </ValidationMessage>
      )}

      <div id="factory-invoice-print" className="space-y-6">
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
                render: (r) =>
                  editingFinancials ? (
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
                  ) : (
                    <span>
                      {formatMoney(r.unitRate)}
                      {r.unitRate !== r.defaultRate && (
                        <span className="ml-1 text-xs text-muted-foreground">(default {formatMoney(r.defaultRate)})</span>
                      )}
                    </span>
                  ),
              },
              { key: 'amount', header: 'Line Amount', align: 'right', render: (r) => formatMoney(r.lineAmount) },
            ]}
          />
        </Panel>

        <div className="grid gap-4 md:grid-cols-2">
          <TotalsPanel
            title="Totals"
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
