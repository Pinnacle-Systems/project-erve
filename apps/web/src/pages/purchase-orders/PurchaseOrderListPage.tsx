import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DistributorOption } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import {
  FinancialYearSelect,
  toCompactFinancialYearCode,
  useFinancialYearsQuery,
} from '../../lib/financial-years.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManagePurchaseOrders as canManageOrderSheets } from '../../auth/permissions.js';
import { DistributorLookupField } from '../master-data/DistributorLookupField.js';
import type { OrderSheetPlanningState, PurchaseMode, PurchaseOrder } from './types.js';
import { getOrderSheetPlanningState } from './types.js';

const PLANNING_STATE_LABELS: Record<OrderSheetPlanningState, string> = {
  AVAILABLE: 'Available for Job Order',
  INCLUDED_IN_JOB_ORDER: 'Included in Job Order',
  CANCELLED: 'Cancelled',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function planningStateTone(state: OrderSheetPlanningState) {
  if (state === 'CANCELLED') return 'cancelled';
  if (state === 'INCLUDED_IN_JOB_ORDER') return 'info';
  return 'pending';
}

export function PurchaseOrderListPage() {
  const { user } = useAuth();
  const canManagePurchaseOrders = canManageOrderSheets(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [planningState, setPlanningState] = useState<OrderSheetPlanningState | ''>('');
  // The filter's Distributor, as picked from the lookup — its id filters the
  // list and its name labels the PDF, with no Distributor master download.
  const [distributor, setDistributor] = useState<DistributorOption | null>(null);
  const distributorId = distributor?.id ?? '';
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode | ''>('');
  const [financialYearId, setFinancialYearId] = useState('');

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      planningState: planningState || undefined,
      distributorId: distributorId || undefined,
      purchaseMode: purchaseMode || undefined,
      // Filters by each Order Sheet's own Financial Year (derived from its
      // poDate). Optional, defaulting to "All" — this list shows everything
      // today with no date filter, and this preserves that.
      financialYearId: financialYearId || undefined,
    }),
    [debouncedSearch, planningState, distributorId, purchaseMode, financialYearId],
  );

  // Cursor-paginated (25 per page): Load more appends; a filter change
  // restarts at page 1. The PDF fetches every page itself.
  const { query: ordersQuery, items: orders } = useCursorList<PurchaseOrder>({
    queryKey: ['purchase-orders'],
    path: '/purchase-orders',
    params,
  });

  const financialYearsQuery = useFinancialYearsQuery();
  const distributorName = distributor?.name;
  const financialYearLabel = financialYearId
    ? toCompactFinancialYearCode(
        (financialYearsQuery.data ?? []).find((fy) => fy.id === financialYearId)?.code ?? '',
      )
    : undefined;

  const generateOrderSheetListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateOrderSheetListPdfBlob } = await import('./pdf/generateOrderSheetListPdf.js');
    return generateOrderSheetListPdfBlob(
      params,
      { search: debouncedSearch, planningState, distributorName, purchaseMode, financialYearLabel },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [params, debouncedSearch, planningState, distributorName, purchaseMode, financialYearLabel, user?.name]);

  const orderSheetListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Order-Sheets', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({
    generate: generateOrderSheetListPdf,
    filename: orderSheetListPdfFilename,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Order Sheets"
        subtitle="Distributor demand forecast"
        primaryAction={
          canManagePurchaseOrders ? (
            <Button asChild>
              <Link to="/purchase-orders/new">Create Order Sheet</Link>
            </Button>
          ) : undefined
        }
      />

      {/* ISS-084: one container-aware grid for filters and export actions. */}
      <div aria-label="Order Sheet filters and export actions" className="@container border-b border-border-subtle bg-surface-muted">
        <div className="grid grid-cols-1 items-start gap-2 px-3 py-2.5 sm:grid-cols-2 @min-[48rem]:grid-cols-3 @min-[64rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto]">
          <TextField
            aria-label="Search"
            placeholder="Search Order Sheet number"
            density="compact"
            width="full"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SelectField
            aria-label="Planning State"
            density="compact"
            width="full"
            value={planningState || 'ALL'}
            onValueChange={(value) =>
              setPlanningState(value === 'ALL' ? '' : (value as OrderSheetPlanningState))
            }
          >
            <SelectItem value="ALL">All planning states</SelectItem>
            {(Object.keys(PLANNING_STATE_LABELS) as OrderSheetPlanningState[]).map((state) => (
              <SelectItem key={state} value={state}>{PLANNING_STATE_LABELS[state]}</SelectItem>
            ))}
          </SelectField>
          <FinancialYearSelect
            aria-label="Financial Year"
            value={financialYearId}
            onValueChange={setFinancialYearId}
            allLabel="All Financial Years"
            width="full"
          />
          <DistributorLookupField
            aria-label="Distributor"
            id="order-sheet-distributor-filter"
            placeholder="All distributors"
            value={distributor}
            onChange={setDistributor}
            density="compact"
            width="full"
          />
          <SelectField
            aria-label="Purchase mode"
            value={purchaseMode || 'ALL'}
            onValueChange={(value) =>
              setPurchaseMode(value === 'ALL' ? '' : (value as PurchaseMode))
            }
            density="compact"
            width="full"
          >
            <SelectItem value="ALL">All modes</SelectItem>
            <SelectItem value="OUTRIGHT">Outright</SelectItem>
            <SelectItem value="SALE_RETURN">Sale or Return</SelectItem>
          </SelectField>
          <div className="flex min-h-8 min-w-0 flex-wrap items-center justify-end gap-2 sm:col-span-2 @min-[48rem]:col-span-1 @min-[64rem]:flex-nowrap">
            {(search || planningState || distributorId || purchaseMode || financialYearId) && (
              <Button
                type="button"
                variant="ghost"
                density="compact"
                onClick={() => {
                  setSearch('');
                  setPlanningState('');
                  setDistributor(null);
                  setPurchaseMode('');
                  setFinancialYearId('');
                }}
              >
                Clear filters
              </Button>
            )}
            <PdfActionButtons
              density="compact"
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
          </div>
        </div>
      </div>

      <DataTable
        columns={[
          {
            key: 'poNumber',
            header: 'Order Sheet Number',
            render: (po) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/purchase-orders/${po.id}`}
              >
                {po.poNumber}
              </Link>
            ),
          },
          { key: 'distributor', header: 'Distributor', render: (po) => po.distributor.name },
          { key: 'poDate', header: 'Order Sheet Date', render: (po) => formatDate(po.poDate) },
          {
            key: 'financialYear',
            header: 'FY',
            render: (po) => toCompactFinancialYearCode(po.financialYear.code),
          },
          {
            key: 'requiredDeliveryDate',
            header: 'Delivery Date',
            render: (po) => (po.requiredDeliveryDate ? formatDate(po.requiredDeliveryDate) : '—'),
          },
          {
            key: 'purchaseMode',
            header: 'Mode',
            render: (po) => (po.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale or Return'),
          },
          {
            key: 'planningState',
            header: 'Planning State',
            render: (po) => {
              const state = getOrderSheetPlanningState(po);
              return (
                <StatusBadge label={PLANNING_STATE_LABELS[state]} tone={planningStateTone(state)} />
              );
            },
          },
          {
            key: 'totalOrderedQuantity',
            header: 'Qty',
            align: 'right',
            render: (po) => po.totalOrderedQuantity.toLocaleString(),
          },
          { key: 'createdAt', header: 'Created', render: (po) => formatDate(po.createdAt) },
        ]}
        data={orders}
        loading={ordersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading Order Sheets" />}
        emptyState={
          <EmptyState
            title="No Order Sheets found"
            description={
              canManagePurchaseOrders
                ? 'Create an Order Sheet to start tracking distributor demand.'
                : 'Order Sheets will appear here when they are available.'
            }
            action={
              canManagePurchaseOrders ? (
                <Button asChild>
                  <Link to="/purchase-orders/new">Create Order Sheet</Link>
                </Button>
              ) : undefined
            }
          />
        }
        error={
          ordersQuery.isError ? (
            <ErrorState
              title="Unable to load Order Sheets"
              description={ordersQuery.error.message}
            />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(ordersQuery, orders.length, ['Order Sheet', 'Order Sheets'])} />
    </div>
  );
}
