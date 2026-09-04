import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { canSubmitDistributorSalesReports, canSubmitDistributorReturns } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { SaleOrReturnPositionRow } from './types.js';

function rowKey(row: SaleOrReturnPositionRow) {
  return `${row.erveDispatchId}:${row.saleOrderLineId}`;
}

export function SaleOrReturnPositionListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canReport = canSubmitDistributorSalesReports(user);
  const canReturn = canSubmitDistributorReturns(user);

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reportDate, setReportDate] = useState('');
  const [formError, setFormError] = useState('');

  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnDate, setReturnDate] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnFormError, setReturnFormError] = useState('');

  const query = useQuery({
    queryKey: ['sale-or-return-positions'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<{ items: SaleOrReturnPositionRow[] }>>('/sale-or-return-positions');
      return res.data.data.items;
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const linesToSubmit = useMemo(
    () =>
      rows
        .map((row) => ({ row, quantity: Number(quantities[rowKey(row)] ?? 0) }))
        .filter(({ quantity }) => quantity > 0),
    [rows, quantities],
  );
  const returnLinesToSubmit = useMemo(
    () =>
      rows
        .map((row) => ({ row, quantity: Number(returnQuantities[rowKey(row)] ?? 0) }))
        .filter(({ quantity }) => quantity > 0),
    [rows, returnQuantities],
  );

  const submitMutation = useMutation({
    mutationFn: async () => {
      const distributorId = rows[0]?.distributor.id;
      if (!distributorId) throw new Error('No Sale-or-Return stock to report against');
      const res = await apiClient.post('/distributor-sales-reports', {
        distributorId,
        reportDate,
        lines: linesToSubmit.map(({ row, quantity }) => ({
          erveDispatchId: row.erveDispatchId,
          saleOrderLineId: row.saleOrderLineId,
          quantitySold: quantity,
        })),
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setQuantities({});
      void queryClient.invalidateQueries({ queryKey: ['sale-or-return-positions'] });
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to submit the sales report.')),
  });

  const submitReturnMutation = useMutation({
    mutationFn: async () => {
      const distributorId = rows[0]?.distributor.id;
      if (!distributorId) throw new Error('No Sale-or-Return stock to return');
      const res = await apiClient.post('/distributor-returns', {
        distributorId,
        returnDate,
        returnReason,
        lines: returnLinesToSubmit.map(({ row, quantity }) => ({
          erveDispatchId: row.erveDispatchId,
          saleOrderLineId: row.saleOrderLineId,
          requestedQuantity: quantity,
        })),
      });
      return res.data.data;
    },
    onSuccess: () => {
      setReturnFormError('');
      setReturnQuantities({});
      setReturnReason('');
      void queryClient.invalidateQueries({ queryKey: ['sale-or-return-positions'] });
    },
    onError: (caught) => setReturnFormError(getApiErrorMessage(caught, 'Unable to submit the return.')),
  });

  if (query.isLoading) return <LoadingState label="Loading Sale-or-Return stock position" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sale-or-Return Stock"
        subtitle="Dispatched consignment stock, quantity reported sold, returned, and remaining"
        secondaryActions={
          <>
            {canReport && (
              <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-sales-reports')}>
                Report History
              </Button>
            )}
            {canReturn && (
              <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-returns')}>
                Return History
              </Button>
            )}
          </>
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {returnFormError && <ValidationMessage tone="error">{returnFormError}</ValidationMessage>}

      <Panel padding="none">
        <DataTable
          rowKey={rowKey}
          data={rows}
          emptyState={<EmptyState title="No Sale-or-Return stock" description="No dispatched consignment stock to report against." />}
          columns={[
            { key: 'dispatch', header: 'Erve Dispatch #', render: (r) => r.erveDispatchNumber },
            { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
            { key: 'style', header: 'Style / Size', render: (r) => `${r.styleNumber} / ${r.sizeLabel}` },
            { key: 'received', header: 'Received', align: 'right', render: (r) => r.receivedQuantity.toLocaleString() },
            { key: 'sold', header: 'Actual Sold', align: 'right', render: (r) => r.actualSoldQuantity.toLocaleString() },
            { key: 'returned', header: 'Returned', align: 'right', render: (r) => r.returnedQuantity.toLocaleString() },
            { key: 'pendingReturn', header: 'Pending Return', align: 'right', render: (r) => (r.approvedAwaitingReceiptQuantity + r.pendingRequestedQuantity).toLocaleString() },
            { key: 'remaining', header: 'Remaining', align: 'right', render: (r) => r.remainingWithDistributor.toLocaleString() },
            ...(canReport
              ? [
                  {
                    key: 'report',
                    header: 'Report Sold Qty',
                    render: (r: SaleOrReturnPositionRow) =>
                      r.remainingWithDistributor > 0 ? (
                        <input
                          type="number"
                          min={0}
                          max={r.remainingWithDistributor}
                          className="w-20 rounded border border-[var(--erp-border)] px-2 py-1 text-sm"
                          value={quantities[rowKey(r)] ?? ''}
                          onChange={(e) => setQuantities((current) => ({ ...current, [rowKey(r)]: e.target.value }))}
                        />
                      ) : (
                        '—'
                      ),
                  },
                ]
              : []),
            ...(canReturn
              ? [
                  {
                    key: 'return',
                    header: 'Return Goods Qty',
                    render: (r: SaleOrReturnPositionRow) =>
                      r.returnableQuantity > 0 ? (
                        <input
                          type="number"
                          min={0}
                          max={r.returnableQuantity}
                          className="w-20 rounded border border-[var(--erp-border)] px-2 py-1 text-sm"
                          value={returnQuantities[rowKey(r)] ?? ''}
                          onChange={(e) => setReturnQuantities((current) => ({ ...current, [rowKey(r)]: e.target.value }))}
                        />
                      ) : (
                        '—'
                      ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      {canReport && linesToSubmit.length > 0 && (
        <Panel title="Submit Sales Report">
          <div className="flex flex-wrap items-end gap-3">
            <TextField label="Report Date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            <Button onClick={() => submitMutation.mutate()} loading={submitMutation.isPending} disabled={!reportDate}>
              Submit ({linesToSubmit.length} line{linesToSubmit.length === 1 ? '' : 's'})
            </Button>
          </div>
        </Panel>
      )}

      {canReturn && returnLinesToSubmit.length > 0 && (
        <Panel title="Submit Return Request">
          <div className="flex flex-wrap items-end gap-3">
            <TextField label="Return Date" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            <TextField
              label="Return Reason"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="e.g. End of season unsold stock"
            />
            <Button
              onClick={() => submitReturnMutation.mutate()}
              loading={submitReturnMutation.isPending}
              disabled={!returnDate || !returnReason.trim()}
            >
              Submit Return ({returnLinesToSubmit.length} line{returnLinesToSubmit.length === 1 ? '' : 's'})
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
