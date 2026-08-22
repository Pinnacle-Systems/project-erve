import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { FilterBar, getQaStatusPresentation, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Factory } from '../master-data/types.js';
import type { JobOrder, JobOrderStatus } from './types.js';
import {
  CONFIRMATION_LABELS,
  JOB_ORDER_STATUS_LABELS,
  confirmationTone,
  formatDateTime,
} from './job-order-ui.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { canCreateJobOrders, canFilterJobOrdersByFactory } from '../../auth/permissions.js';

export function JobOrderListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canCreate = canCreateJobOrders(user);
  const mayFilterByFactory = canFilterJobOrdersByFactory(user);
  const showQaWork = user?.roles.includes('QA_USER') ?? false;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<JobOrderStatus | ''>('');

  const rawFactoryId = searchParams.get('factoryId');
  const effectiveFactoryId = mayFilterByFactory ? (rawFactoryId ?? undefined) : undefined;

  useEffect(() => {
    if (!mayFilterByFactory && rawFactoryId !== null) {
      const next = new URLSearchParams(searchParams);
      next.delete('factoryId');
      setSearchParams(next, { replace: true });
    }
  }, [mayFilterByFactory, rawFactoryId, searchParams, setSearchParams]);

  const handleFactoryChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== 'ALL') {
      next.set('factoryId', value);
    } else {
      next.delete('factoryId');
    }
    setSearchParams(next, { replace: true });
  };

  const params = useMemo(
    () => ({
      search: search || undefined,
      status: status || undefined,
      factoryId: effectiveFactoryId,
    }),
    [search, status, effectiveFactoryId],
  );

  const jobOrdersQuery = useQuery({
    queryKey: ['job-orders', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<JobOrder>>>(
        '/job-orders',
        { params },
      );
      return res.data.data;
    },
  });

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Job Orders"
        subtitle="Factory production orders created from purchase order demand"
        primaryAction={
          canCreate ? (
            <Button asChild>
              <Link to="/job-orders/new">Create Job Order</Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job order or PO"
        statusValue={status || 'ALL'}
        statusAriaLabel="Lifecycle"
        statusPlaceholder="All lifecycle states"
        onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as JobOrderStatus))}
        statusOptions={[
          { label: 'All lifecycle states', value: 'ALL' },
          ...(Object.keys(JOB_ORDER_STATUS_LABELS) as JobOrderStatus[]).map((s) => ({
            label: JOB_ORDER_STATUS_LABELS[s],
            value: s,
          })),
        ]}
        hasActiveFilters={Boolean(search || status || effectiveFactoryId)}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
          handleFactoryChange('');
        }}
        actions={
          mayFilterByFactory ? (
            <SelectField
              aria-label="Factory"
              value={effectiveFactoryId || 'ALL'}
              onValueChange={handleFactoryChange}
              density="compact"
              width="md"
            >
              <SelectItem value="ALL">All factories</SelectItem>
              {(factoriesQuery.data ?? []).map((factory) => (
                <SelectItem key={factory.id} value={factory.id}>
                  {factory.name}
                </SelectItem>
              ))}
            </SelectField>
          ) : undefined
        }
      />

      <DataTable
        columns={[
          {
            key: 'jobOrderNumber',
            header: 'Job Order',
            render: (jobOrder) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/job-orders/${jobOrder.id}`}
              >
                {jobOrder.jobOrderNumber}
              </Link>
            ),
          },
          {
            key: 'purchaseOrderNumber',
            header: 'PO Number',
            render: (jobOrder) => jobOrder.purchaseOrder.poNumber,
          },
          { key: 'factory', header: 'Factory', render: (jobOrder) => jobOrder.factory.name },
          {
            key: 'processFlowVersion',
            header: 'Process Flow',
            render: (jobOrder) =>
              `${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`,
          },
          {
            key: 'workflow',
            header: showQaWork ? 'Status' : 'Current State',
            render: (jobOrder) => {
              if (!showQaWork) {
                return (
                  <StatusBadge
                    label={jobOrder.operationalState.primaryDisplayState.label}
                    tone={jobOrder.operationalState.primaryDisplayState.tone}
                    className="max-w-[18rem] whitespace-normal break-words leading-tight"
                  />
                );
              }

              const status = getQaStatusPresentation(jobOrder.operationalState);
              return (
                <div className="max-w-[18rem] space-y-1">
                  <StatusBadge
                    label={status.primary.label}
                    tone={status.primary.tone}
                    className="whitespace-normal break-words leading-tight"
                  />
                  {status.secondaryLabel ? (
                    <div className="text-xs leading-tight text-muted-foreground">
                      Production: {status.secondaryLabel}
                    </div>
                  ) : null}
                </div>
              );
            },
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
          {
            key: 'orderedQuantityTotal',
            header: 'Ordered',
            align: 'right',
            render: (jobOrder) => jobOrder.orderedQuantityTotal.toLocaleString(),
          },
          {
            key: 'preparedQuantityTotal',
            header: 'Prepared',
            align: 'right',
            render: (jobOrder) => jobOrder.preparedQuantityTotal.toLocaleString(),
          },
          {
            key: 'createdAt',
            header: 'Created',
            render: (jobOrder) => formatDateTime(jobOrder.createdAt),
          },
        ]}
        data={jobOrdersQuery.data?.items ?? []}
        loading={jobOrdersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading job orders" />}
        emptyState={
          <EmptyState
            title="No job orders found"
            description="Create job orders from submitted purchase order demand."
          />
        }
        error={
          jobOrdersQuery.isError ? (
            <ErrorState
              title="Unable to load job orders"
              description={jobOrdersQuery.error.message}
            />
          ) : undefined
        }
      />
    </div>
  );
}
