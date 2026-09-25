import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, DistributorOption } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import {
  canSubmitDistributorSalesReports,
  canSubmitDistributorReturns,
  needsSaleOrReturnPositionDistributorSelector,
} from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { DistributorLookupField } from '../master-data/DistributorLookupField.js';
import type { SaleOrReturnPositionRow } from './types.js';

function rowKey(row: SaleOrReturnPositionRow) {
  return `${row.erveDispatchId}:${row.saleOrderLineId}`;
}

// UXAUTH-016: ADMIN reads Sale-or-Return positions broadly across every
// Distributor (see needsSaleOrReturnPositionDistributorSelector) and has no
// single mapped Distributor to default to — this page must ask it for one
// rather than deriving a submission Distributor from whichever row happens
// to load first. DISTRIBUTOR is unaffected: the API hard-scopes it to its
// own single Distributor regardless of any filter sent, exactly as before.
// The selected Distributor lives in the URL (mirrors
// needsFactoryDispatchFactorySelector/FactoryPackingQueuePage's Factory
// selector) rather than component state alone, so it survives a refresh and
// stays a single source of truth for both the positions query and the
// submission payload.
export function SaleOrReturnPositionListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canReport = canSubmitDistributorSalesReports(user);
  const canReturn = canSubmitDistributorReturns(user);
  const needsSelector = needsSaleOrReturnPositionDistributorSelector(user);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawDistributorId = searchParams.get('distributorId');

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reportDate, setReportDate] = useState('');
  const [formError, setFormError] = useState('');

  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnDate, setReturnDate] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnFormError, setReturnFormError] = useState('');

  // The URL's Distributor, resolved by id (GET /distributors/options/:id)
  // rather than by downloading every Distributor. A 404 means the id is
  // unknown — a stale/bookmarked/hand-edited link, not a load failure.
  const distributorOptionQuery = useQuery({
    queryKey: ['distributor-option', rawDistributorId],
    enabled: needsSelector && Boolean(rawDistributorId),
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiSuccessResponse<DistributorOption>>(
          `/distributors/options/${encodeURIComponent(rawDistributorId!)}`,
        );
        return res.data.data;
      } catch (caught) {
        if (isAxiosError(caught) && caught.response?.status === 404) return null;
        throw caught;
      }
    },
  });

  // A URL-provided distributorId is only trusted once it's confirmed as a
  // real ACTIVE Distributor (the same set the selector offers) — a
  // stale/bookmarked/hand-edited id must never be sent to the positions
  // endpoint or treated as "no selection".
  const resolvedDistributor = needsSelector && rawDistributorId ? distributorOptionQuery.data : undefined;
  const selectedDistributor =
    resolvedDistributor && resolvedDistributor.status === 'ACTIVE' ? resolvedDistributor : undefined;
  const selectedDistributorId = needsSelector ? selectedDistributor?.id : undefined;
  const hasUnresolvedSelector =
    needsSelector && Boolean(rawDistributorId) && (distributorOptionQuery.isLoading || distributorOptionQuery.isError);
  const hasStaleDistributorId = needsSelector && Boolean(rawDistributorId) && !hasUnresolvedSelector && !selectedDistributor;
  const hasValidDistributorContext = !needsSelector || Boolean(selectedDistributorId);

  const handleDistributorChange = (distributor: DistributorOption | null) => {
    const next = new URLSearchParams(searchParams);
    if (distributor) {
      // The picked option is already a resolved ACTIVE Distributor.
      queryClient.setQueryData(['distributor-option', distributor.id], distributor);
      next.set('distributorId', distributor.id);
    } else {
      next.delete('distributorId');
    }
    setSearchParams(next, { replace: true });
    // A Distributor switch must never let quantities entered against the
    // previous context reappear, be submitted, or leave a stale error
    // message visible under the new context.
    setQuantities({});
    setFormError('');
    setReturnQuantities({});
    setReturnFormError('');
  };

  const query = useQuery({
    queryKey: ['sale-or-return-positions', selectedDistributorId ?? 'own'],
    enabled: hasValidDistributorContext,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<{ items: SaleOrReturnPositionRow[] }>>('/sale-or-return-positions', {
        params: selectedDistributorId ? { distributorId: selectedDistributorId } : undefined,
      });
      return res.data.data.items;
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  // Roles that never see the selector (e.g. DISTRIBUTOR, hard-scoped
  // server-side to a single Distributor via getSoleDistributorId) still need
  // a coherent submission identity — derive it from the rows actually
  // returned rather than trusting row order, so a future server-side scoping
  // regression cannot silently reintroduce a mixed-Distributor submission.
  const scopedDistributorIds = useMemo(() => new Set(rows.map((row) => row.distributor.id)), [rows]);
  const scopedDistributorId = scopedDistributorIds.size === 1 ? [...scopedDistributorIds][0] : undefined;

  const effectiveDistributorId = needsSelector ? selectedDistributorId : scopedDistributorId;

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
      if (!effectiveDistributorId) throw new Error('Select a Distributor before submitting a sales report');
      if (!linesToSubmit.every(({ row }) => row.distributor.id === effectiveDistributorId)) {
        throw new Error('A Sales Report may only include lines for a single Distributor');
      }
      const res = await apiClient.post('/distributor-sales-reports', {
        distributorId: effectiveDistributorId,
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
      if (!effectiveDistributorId) throw new Error('Select a Distributor before submitting a return');
      if (!returnLinesToSubmit.every(({ row }) => row.distributor.id === effectiveDistributorId)) {
        throw new Error('A Return may only include lines for a single Distributor');
      }
      const res = await apiClient.post('/distributor-returns', {
        distributorId: effectiveDistributorId,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sale-or-Return Stock"
        subtitle={
          needsSelector
            ? 'Dispatched consignment stock for the selected Distributor, quantity reported sold, returned, and remaining'
            : 'Dispatched consignment stock, quantity reported sold, returned, and remaining'
        }
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

      {needsSelector && (
        <Panel padding="sm">
          {distributorOptionQuery.isError ? (
            <ErrorState title="Unable to load Distributor" description="Could not load the Distributor in this link." />
          ) : (
            <DistributorLookupField
              label="Distributor"
              placeholder="Select a Distributor"
              value={selectedDistributor ?? null}
              onChange={handleDistributorChange}
              width="md"
              disabled={hasUnresolvedSelector}
            />
          )}
        </Panel>
      )}

      {needsSelector && !rawDistributorId && !hasUnresolvedSelector && (
        <EmptyState
          tone="permission"
          title="Select a Distributor to view Sale or Return positions"
          description="Choose a Distributor above to see its Sale-or-Return stock position and report sales or returns against it."
        />
      )}

      {hasStaleDistributorId && (
        <EmptyState
          tone="error"
          title="Select a valid Distributor"
          description="The Distributor in this link is unknown or no longer available. Choose a Distributor above."
        />
      )}

      {hasUnresolvedSelector && distributorOptionQuery.isLoading && <LoadingState label="Loading Distributor" />}

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {returnFormError && <ValidationMessage tone="error">{returnFormError}</ValidationMessage>}

      {hasValidDistributorContext && (
        <>
          <Panel padding="none">
            <DataTable
              rowKey={rowKey}
              data={rows}
              loading={query.isLoading}
              loadingState={<LoadingState label="Loading Sale-or-Return stock position" />}
              error={
                query.isError ? (
                  <ErrorState title="Unable to load Sale-or-Return positions" description="Please try again." />
                ) : undefined
              }
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
        </>
      )}
    </div>
  );
}
