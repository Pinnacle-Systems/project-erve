import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { FinancialYearSelect, toCompactFinancialYearCode } from '../../lib/financial-years.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManagePurchaseOrders as canManageOrderSheets } from '../../auth/permissions.js';
import type { Distributor, OrderSheetPlanningState, PurchaseMode, PurchaseOrder } from './types.js';
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
  const [distributorId, setDistributorId] = useState('');
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

  const ordersQuery = useQuery({
    queryKey: ['purchase-orders', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<PurchaseOrder>>>(
        '/purchase-orders',
        { params },
      );
      return res.data.data;
    },
  });

  const distributorsQuery = useQuery({
    queryKey: ['distributors', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Distributor[]>>('/distributors', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
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
          setDistributorId('');
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
            <SelectField
              aria-label="Distributor"
              value={distributorId || 'ALL'}
              onValueChange={(value) => setDistributorId(value === 'ALL' ? '' : value)}
              density="compact"
              width="md"
            >
              <SelectItem value="ALL">All distributors</SelectItem>
              {(distributorsQuery.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectField>
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
        data={ordersQuery.data?.items ?? []}
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
    </div>
  );
}
