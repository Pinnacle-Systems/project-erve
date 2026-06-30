import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Distributor, PurchaseMode, PurchaseOrder, PurchaseOrderStatus } from './types.js';

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  PARTIALLY_JOB_ORDERED: 'Partially Job Ordered',
  FULLY_JOB_ORDERED: 'Fully Job Ordered',
  PARTIALLY_FULFILLED: 'Partially Fulfilled',
  FULLY_FULFILLED: 'Fully Fulfilled',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusTone(status: PurchaseOrderStatus) {
  if (status === 'DRAFT') return 'draft';
  if (status === 'SUBMITTED') return 'submitted';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'CLOSED') return 'posted';
  if (status.includes('FULFILLED')) return 'success';
  if (status.includes('JOB_ORDERED')) return 'info';
  return 'pending';
}

export function PurchaseOrderListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const [distributorId, setDistributorId] = useState('');
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode | ''>('');

  const params = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      distributorId: distributorId || undefined,
      purchaseMode: purchaseMode || undefined,
    }),
    [search, status, distributorId, purchaseMode],
  );

  const ordersQuery = useQuery({
    queryKey: ['purchase-orders', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder[]>>('/purchase-orders', { params });
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
        title="Purchase Orders"
        subtitle="Distributor demand orders"
        primaryAction={
          <Button asChild>
            <Link to="/purchase-orders/new">Create PO</Link>
          </Button>
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search PO number"
        statusValue={status || 'ALL'}
        onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as PurchaseOrderStatus))}
        statusOptions={[
          { label: 'All statuses', value: 'ALL' },
          ...(Object.keys(STATUS_LABELS) as PurchaseOrderStatus[]).map((s) => ({ label: STATUS_LABELS[s], value: s })),
        ]}
        hasActiveFilters={Boolean(search || status || distributorId || purchaseMode)}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
          setDistributorId('');
          setPurchaseMode('');
        }}
        actions={
          <>
            <SelectField
              aria-label="Distributor"
              value={distributorId || 'ALL'}
              onValueChange={(value) => setDistributorId(value === 'ALL' ? '' : value)}
              density="compact"
              width="md"
            >
              <SelectItem value="ALL">All distributors</SelectItem>
              {(distributorsQuery.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectField>
            <SelectField
              aria-label="Purchase mode"
              value={purchaseMode || 'ALL'}
              onValueChange={(value) => setPurchaseMode(value === 'ALL' ? '' : (value as PurchaseMode))}
              density="compact"
              width="sm"
            >
              <SelectItem value="ALL">All modes</SelectItem>
              <SelectItem value="OUTRIGHT">Outright</SelectItem>
              <SelectItem value="SALE_RETURN">Sale Return</SelectItem>
            </SelectField>
          </>
        }
      />

      <DataTable
        columns={[
          {
            key: 'poNumber',
            header: 'PO Number',
            render: (po) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/purchase-orders/${po.id}`}>
                {po.poNumber}
              </Link>
            ),
          },
          { key: 'distributor', header: 'Distributor', render: (po) => po.distributor.name },
          { key: 'poDate', header: 'PO Date', render: (po) => formatDate(po.poDate) },
          { key: 'requiredDeliveryDate', header: 'Delivery Date', render: (po) => (po.requiredDeliveryDate ? formatDate(po.requiredDeliveryDate) : '—') },
          { key: 'purchaseMode', header: 'Mode', render: (po) => (po.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale Return') },
          {
            key: 'status',
            header: 'Status',
            render: (po) => <StatusBadge label={STATUS_LABELS[po.status]} tone={statusTone(po.status)} />,
          },
          { key: 'totalOrderedQuantity', header: 'Qty', align: 'right', render: (po) => po.totalOrderedQuantity.toLocaleString() },
          { key: 'createdAt', header: 'Created', render: (po) => formatDate(po.createdAt) },
        ]}
        data={ordersQuery.data ?? []}
        loading={ordersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading purchase orders" />}
        emptyState={<EmptyState title="No purchase orders found" description="Create a PO to start tracking distributor demand." />}
        error={
          ordersQuery.isError ? (
            <ErrorState title="Unable to load purchase orders" description={ordersQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
