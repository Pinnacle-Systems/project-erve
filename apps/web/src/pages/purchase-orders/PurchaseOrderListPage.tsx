import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DistributorOption } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
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

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search Order Sheet number"
            statusValue={planningState || 'ALL'}
            onStatusChange={(value) =>
              setPlanningState(value === 'ALL' ? '' : (value as OrderSheetPlanningState))
            }
            statusOptions={[
              { label: 'All planning states', value: 'ALL' },
              ...(Object.keys(PLANNING_STATE_LABELS) as OrderSheetPlanningState[]).map((s) => ({
                label: PLANNING_STATE_LABELS[s],
                value: s,
              })),
            ]}
            hasActiveFilters={Boolean(
              search || planningState || distributorId || purchaseMode || financialYearId,
            )}
            onClearFilters={() => {
              setSearch('');
              setPlanningState('');
              setDistributor(null);
              setPurchaseMode('');
              setFinancialYearId('');
            }}
            actions={
              <>
                <FinancialYearSelect
                  aria-label="Financial Year"
                  value={financialYearId}
                  onValueChange={setFinancialYearId}
                  allLabel="All Financial Years"
                />
                <DistributorLookupField
                  aria-label="Distributor"
                  id="order-sheet-distributor-filter"
                  placeholder="All distributors"
                  value={distributor}
                  onChange={setDistributor}
                  density="compact"
                  width="md"
                />
                <SelectField
                  aria-label="Purchase mode"
                  value={purchaseMode || 'ALL'}
                  onValueChange={(value) =>
                    setPurchaseMode(value === 'ALL' ? '' : (value as PurchaseMode))
                  }
                  density="compact"
                  width="sm"
                >
                  <SelectItem value="ALL">All modes</SelectItem>
                  <SelectItem value="OUTRIGHT">Outright</SelectItem>
                  <SelectItem value="SALE_RETURN">Sale or Return</SelectItem>
                </SelectField>
              </>
            }
          />
        </div>
        <PdfActionButtons
          isGenerating={pdfAction.isGenerating}
          error={pdfAction.error}
          onDownload={pdfAction.handleDownload}
          onPrint={pdfAction.handlePrint}
        />
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
