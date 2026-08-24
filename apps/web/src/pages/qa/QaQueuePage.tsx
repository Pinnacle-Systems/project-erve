import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, JobOrderQualityActivity } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import {
  QUALITY_RUNTIME_STATUS_LABELS,
  qualityRuntimeStatusTone,
} from '../job-orders/job-order-ui.js';

type QualityWorkItem = {
  jobOrderId: string;
  jobOrderNumber: string;
  purchaseOrderNumber: string;
  factory: { id: string; code: string; name: string };
  activity: JobOrderQualityActivity;
};

type QualityWorkFilter =
  'AVAILABLE' | 'IN_PROGRESS' | 'FAILED' | 'MISSED' | 'COMPLETED' | 'RECONCILIATION_CONFLICT';

export function QaQueuePage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QualityWorkFilter | ''>('');
  const query = useQuery({
    queryKey: ['process-flow-quality-work'],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<Array<QualityWorkItem>>>('/job-orders/quality-work'))
        .data.data,
  });
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const qualityWork = (query.data ?? []).filter((item) => {
    const matchesSearch =
      !normalizedSearch ||
      [
        item.jobOrderNumber,
        item.purchaseOrderNumber,
        item.factory.name,
        item.factory.code,
        item.activity.name,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    const matchesFilter =
      !filter ||
      (filter === 'RECONCILIATION_CONFLICT'
        ? item.activity.coverage?.reconciliationConflict === true
        : item.activity.status === filter);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="QA Work"
        subtitle="Quality inspections and reports required by active Job Orders."
      />
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job order, PO, activity or factory"
        statusValue={filter || 'ALL'}
        onStatusChange={(value) => setFilter(value === 'ALL' ? '' : (value as QualityWorkFilter))}
        statusOptions={[
          { label: 'All statuses', value: 'ALL' },
          { label: 'Available', value: 'AVAILABLE' },
          { label: 'In progress', value: 'IN_PROGRESS' },
          { label: 'Failed / retry required', value: 'FAILED' },
          { label: 'Missed', value: 'MISSED' },
          { label: 'Completed', value: 'COMPLETED' },
          { label: 'Reconciliation conflict', value: 'RECONCILIATION_CONFLICT' },
        ]}
        hasActiveFilters={Boolean(search || filter)}
        onClearFilters={() => {
          setSearch('');
          setFilter('');
        }}
      />
      <Panel
        title="Quality activities"
        description="Quality inspections and reports required by active Job Orders."
      >
        <DataTable
          data={qualityWork}
          rowKey={(item) => `${item.jobOrderId}:${item.activity.processFlowVersionStageId}`}
          loading={query.isLoading}
          loadingState={<LoadingState variant="rows" label="Loading QA work" />}
          emptyState={
            <EmptyState title="No QA work" description="No Quality activities match this view." />
          }
          error={
            query.isError ? (
              <ErrorState title="Unable to load QA work" description={query.error.message} />
            ) : undefined
          }
          columns={[
            {
              key: 'jobOrder',
              header: 'Job order',
              render: (item) => (
                <Link
                  className="font-medium text-[var(--erp-text-link)]"
                  to={`/job-orders/${item.jobOrderId}`}
                >
                  {item.jobOrderNumber}
                </Link>
              ),
            },
            { key: 'activity', header: 'Activity', render: (item) => item.activity.name },
            { key: 'factory', header: 'Factory', render: (item) => item.factory.name },
            {
              key: 'status',
              header: 'Status',
              render: (item) => {
                const conflict = item.activity.coverage?.reconciliationConflict === true;
                return (
                  <StatusBadge
                    label={
                      conflict
                        ? 'Reconciliation Conflict'
                        : QUALITY_RUNTIME_STATUS_LABELS[item.activity.status]
                    }
                    tone={conflict ? 'danger' : qualityRuntimeStatusTone(item.activity.status)}
                  />
                );
              },
            },
            {
              key: 'coverage',
              header: 'Coverage',
              render: (item) => {
                const coverage = item.activity.coverage;
                if (!coverage) return '—';
                return coverage.preparedQuantityAuthoritative
                  ? `${coverage.inspectedPhysicalCoverage ?? coverage.inspectedQuantity} / ${coverage.preparedQuantity}`
                  : `${coverage.inspectedPhysicalCoverage ?? coverage.inspectedQuantity} / —`;
              },
            },
          ]}
        />
      </Panel>
    </div>
  );
}
