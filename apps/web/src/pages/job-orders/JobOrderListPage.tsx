import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Factory } from '../master-data/types.js';
import type { JobOrder, JobOrderStatus } from './types.js';
import { CONFIRMATION_LABELS, JOB_ORDER_STATUS_LABELS, confirmationTone, formatDateTime, statusTone } from './job-order-ui.js';

export function JobOrderListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<JobOrderStatus | ''>('');
  const [factoryId, setFactoryId] = useState('');

  const params = useMemo(
    () => ({ search: search || undefined, status: status || undefined, factoryId: factoryId || undefined }),
    [search, status, factoryId],
  );

  const jobOrdersQuery = useQuery({
    queryKey: ['job-orders', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrder[]>>('/job-orders', { params });
      return res.data.data;
    },
  });

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', { params: { status: 'ACTIVE' } });
      return res.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Job Orders"
        subtitle="Factory production orders created from purchase order demand"
        primaryAction={
          <Button asChild>
            <Link to="/job-orders/new">Create Job Order</Link>
          </Button>
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job order or PO"
        statusValue={status || 'ALL'}
        onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as JobOrderStatus))}
        statusOptions={[
          { label: 'All statuses', value: 'ALL' },
          ...(Object.keys(JOB_ORDER_STATUS_LABELS) as JobOrderStatus[]).map((s) => ({ label: JOB_ORDER_STATUS_LABELS[s], value: s })),
        ]}
        hasActiveFilters={Boolean(search || status || factoryId)}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
          setFactoryId('');
        }}
        actions={
          <SelectField
            aria-label="Factory"
            value={factoryId || 'ALL'}
            onValueChange={(value) => setFactoryId(value === 'ALL' ? '' : value)}
            density="compact"
            width="md"
          >
            <SelectItem value="ALL">All factories</SelectItem>
            {(factoriesQuery.data ?? []).map((factory) => (
              <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
            ))}
          </SelectField>
        }
      />

      <DataTable
        columns={[
          {
            key: 'jobOrderNumber',
            header: 'Job Order',
            render: (jobOrder) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/job-orders/${jobOrder.id}`}>
                {jobOrder.jobOrderNumber}
              </Link>
            ),
          },
          { key: 'purchaseOrderNumber', header: 'PO Number', render: (jobOrder) => jobOrder.purchaseOrder.poNumber },
          { key: 'factory', header: 'Factory', render: (jobOrder) => jobOrder.factory.name },
          {
            key: 'processFlowVersion',
            header: 'Process Flow',
            render: (jobOrder) => `${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`,
          },
          {
            key: 'status',
            header: 'Status',
            render: (jobOrder) => <StatusBadge label={JOB_ORDER_STATUS_LABELS[jobOrder.status]} tone={statusTone(jobOrder.status)} />,
          },
          {
            key: 'factoryConfirmationStatus',
            header: 'Confirmation',
            render: (jobOrder) => (
              <StatusBadge
                label={CONFIRMATION_LABELS[jobOrder.factoryConfirmationStatus]}
                tone={confirmationTone(jobOrder.factoryConfirmationStatus)}
              />
            ),
          },
          { key: 'orderedQuantityTotal', header: 'Ordered', align: 'right', render: (jobOrder) => jobOrder.orderedQuantityTotal.toLocaleString() },
          { key: 'preparedQuantityTotal', header: 'Prepared', align: 'right', render: (jobOrder) => jobOrder.preparedQuantityTotal.toLocaleString() },
          { key: 'createdAt', header: 'Created', render: (jobOrder) => formatDateTime(jobOrder.createdAt) },
        ]}
        data={jobOrdersQuery.data ?? []}
        loading={jobOrdersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading job orders" />}
        emptyState={<EmptyState title="No job orders found" description="Create job orders from submitted purchase order demand." />}
        error={
          jobOrdersQuery.isError ? (
            <ErrorState title="Unable to load job orders" description={jobOrdersQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
