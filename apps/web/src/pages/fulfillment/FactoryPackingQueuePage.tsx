import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { SelectField, SelectItem } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { needsFactoryDispatchFactorySelector } from '../../auth/permissions.js';
import type { FactoryDispatchSummary, FactoryPackingQueueLine, PaginatedResult } from './types.js';

interface FactoryOption {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const NO_FACTORY_SELECTED = 'NONE';

// Phase 4: packing itself now happens on the Dispatch Order's own Packing
// List page (cartons are the sole physical packing fact) — this page is a
// pure progress view, required vs. physical-carton-packed, that links there.
//
// UXAUTH-005: ADMIN/MERCHANDISER/SENIOR_MANAGEMENT read broadly (see
// needsFactoryDispatchFactorySelector, which mirrors the API's
// canReadFactoryDispatchBroadly exactly) and therefore have no single mapped
// Factory to default to — this page must ask them for one instead of
// issuing an invalid request or presenting the resulting error as "Nothing
// to pack". FACTORY_USER is unaffected: it never sees the selector and its
// requests never carry a factoryId, exactly as before this batch.
export function FactoryPackingQueuePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const needsSelector = needsFactoryDispatchFactorySelector(user);
  const rawFactoryId = searchParams.get('factoryId');

  const factoryOptionsQuery = useQuery({
    queryKey: ['factory-dispatch-factory-options'],
    enabled: needsSelector,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FactoryOption[]>>('/factory-dispatches/factory-options');
      return res.data.data;
    },
  });

  const selectedFactory = needsSelector
    ? (factoryOptionsQuery.data ?? []).find((factory) => factory.id === rawFactoryId)
    : undefined;
  // A URL-provided factoryId is only trusted once it's confirmed against the
  // loaded option set — a stale/bookmarked/hand-edited id must never be sent
  // to the queue/list endpoints or treated as "no selection" (see
  // hasValidFactoryContext below).
  const selectedFactoryId = needsSelector ? selectedFactory?.id : undefined;
  const hasUnresolvedSelector = needsSelector && (factoryOptionsQuery.isLoading || factoryOptionsQuery.isError);
  const hasStaleFactoryId = needsSelector && Boolean(rawFactoryId) && !hasUnresolvedSelector && !selectedFactory;
  const hasValidFactoryContext = !needsSelector || Boolean(selectedFactoryId);

  const handleFactoryChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== NO_FACTORY_SELECTED) {
      next.set('factoryId', value);
    } else {
      next.delete('factoryId');
    }
    setSearchParams(next, { replace: true });
  };

  const queueQuery = useQuery({
    queryKey: ['factory-packing-queue', selectedFactoryId ?? 'own'],
    enabled: hasValidFactoryContext,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FactoryPackingQueueLine[]>>('/factory-dispatches/packing-queue', {
        params: selectedFactoryId ? { factoryId: selectedFactoryId } : undefined,
      });
      return res.data.data;
    },
  });

  const dispatchesQuery = useQuery({
    queryKey: ['factory-dispatches', selectedFactoryId ?? 'own'],
    enabled: hasValidFactoryContext,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<FactoryDispatchSummary>>>('/factory-dispatches', {
        params: { limit: 25, factoryId: selectedFactoryId },
      });
      return res.data.data.items;
    },
  });

  const generateFactoryPackingQueueListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateFactoryPackingQueueListPdfBlob } = await import('./pdf/factory-packing-queue/generateFactoryPackingQueueListPdf.js');
    return generateFactoryPackingQueueListPdfBlob(queueQuery.data ?? [], {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
      factoryId: selectedFactoryId,
    });
  }, [queueQuery.data, user?.name, selectedFactoryId]);

  const pdfAction = usePdfAction({
    generate: generateFactoryPackingQueueListPdf,
    filename: () => buildPdfFilename(['ERVE-Factory-Packing-Queue', getLocalDateString()]),
  });

  // The PDF must never export a failed/not-yet-loaded/wrong-Factory result —
  // it's only offered once the currently selected Factory's queue has
  // actually loaded successfully.
  const canOfferPdf = queueQuery.isSuccess;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Factory Packing Queue"
        subtitle={
          needsSelector
            ? 'Approved goods allocated from the selected Factory, awaiting packing'
            : 'Approved goods allocated from your Factory, awaiting packing'
        }
        secondaryActions={
          canOfferPdf ? (
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
          ) : undefined
        }
      />

      {needsSelector && (
        <Panel padding="sm">
          {factoryOptionsQuery.isError ? (
            <ErrorState title="Unable to load Factories" description="Could not load the list of Factories to choose from." />
          ) : (
            <SelectField
              label="Factory"
              value={rawFactoryId ?? NO_FACTORY_SELECTED}
              onValueChange={handleFactoryChange}
              width="md"
              disabled={factoryOptionsQuery.isLoading}
            >
              <SelectItem value={NO_FACTORY_SELECTED}>Select a Factory</SelectItem>
              {(factoryOptionsQuery.data ?? []).map((factory) => (
                <SelectItem key={factory.id} value={factory.id}>
                  {factory.code} — {factory.name}
                  {factory.status === 'INACTIVE' ? ' (inactive)' : ''}
                </SelectItem>
              ))}
            </SelectField>
          )}
        </Panel>
      )}

      {needsSelector && !rawFactoryId && !hasUnresolvedSelector && (
        <EmptyState
          tone="permission"
          title="Select a Factory to view its packing queue"
          description="Choose a Factory above to see its Awaiting Packing queue and Factory Dispatches."
        />
      )}

      {hasStaleFactoryId && (
        <EmptyState
          tone="error"
          title="Select a valid Factory"
          description="The Factory in this link is unknown or no longer available. Choose a Factory above."
        />
      )}

      {needsSelector && factoryOptionsQuery.isLoading && <LoadingState label="Loading Factories" />}

      {hasValidFactoryContext && (
        <>
          <Panel title="Awaiting Packing" padding="none">
            <DataTable
              rowKey="saleOrderLineId"
              data={queueQuery.data ?? []}
              loading={queueQuery.isLoading}
              loadingState={<LoadingState label="Loading the packing queue" />}
              error={
                queueQuery.isError ? (
                  <ErrorState title="Unable to load the packing queue" description="Please try again." />
                ) : undefined
              }
              emptyState={<EmptyState title="Nothing to pack" description="No approved goods are currently allocated from this Factory." />}
              onRowClick={(row) => navigate(`/sale-orders/${row.saleOrderId}/packing-list`)}
              columns={[
                { key: 'saleOrderNumber', header: 'Sale Order', accessor: 'saleOrderNumber' },
                { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
                { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
                { key: 'size', header: 'Size', accessor: 'sizeLabel' },
                { key: 'allocated', header: 'Required', align: 'right', render: (r) => r.allocatedQuantity.toLocaleString() },
                { key: 'packed', header: 'Packed', align: 'right', render: (r) => r.packedQuantity.toLocaleString() },
                { key: 'remaining', header: 'Remaining', align: 'right', render: (r) => r.remainingQuantity.toLocaleString() },
              ]}
            />
          </Panel>

          <Panel title={needsSelector ? 'Factory Dispatches' : 'Your Factory Dispatches'}>
            <DataTable
              rowKey="id"
              data={dispatchesQuery.data ?? []}
              loading={dispatchesQuery.isLoading}
              error={
                dispatchesQuery.isError ? (
                  <ErrorState title="Unable to load Factory Dispatches" description="Please try again." />
                ) : undefined
              }
              emptyState={<EmptyState title="No Factory Dispatches yet" />}
              onRowClick={(row) => navigate(`/sale-orders/${row.saleOrder.id}/packing-list`)}
              columns={[
                { key: 'number', header: 'Dispatch #', accessor: 'factoryDispatchNumber' },
                { key: 'saleOrder', header: 'Sale Order', render: (r) => r.saleOrder.saleOrderNumber },
                { key: 'distributor', header: 'Distributors', render: (r) => r.saleOrder.distributors.map((d) => d.name).join(', ') },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => (
                    <StatusBadge
                      label={r.status === 'READY_FOR_ERVE' ? 'Ready for Erve' : 'Draft'}
                      tone={r.status === 'READY_FOR_ERVE' ? 'approved' : 'draft'}
                    />
                  ),
                },
                {
                  key: 'consolidated',
                  header: 'Consolidated',
                  render: (r) => (r.consolidated ? 'Yes' : '—'),
                },
              ]}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
