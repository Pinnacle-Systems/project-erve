import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, QualityWorkItem } from '@erve/types';
import type { JobOrderFactoryOption } from '../job-orders/types.js';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { SelectField, SelectItem } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import {
  QUALITY_RUNTIME_STATUS_LABELS,
  qualityRuntimeStatusTone,
} from '../job-orders/job-order-ui.js';

type QualityWorkFilter =
  'AVAILABLE' | 'IN_PROGRESS' | 'FAILED' | 'MISSED' | 'COMPLETED' | 'RECONCILIATION_CONFLICT';

export function QaQueuePage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [filter, setFilter] = useState<QualityWorkFilter | ''>('');
  const [factoryId, setFactoryId] = useState('');

  const params = {
    search: debouncedSearch || undefined,
    status: filter && filter !== 'RECONCILIATION_CONFLICT' ? filter : undefined,
    conflict: filter === 'RECONCILIATION_CONFLICT' ? 'true' : undefined,
    factoryId: factoryId || undefined,
  };

  // The API pages this queue by cursor (25 per page, server-filtered) so no
  // valid QA work is ever silently excluded by a client-side-only window —
  // see QW1's fix for the old take-100-candidates blind spot.
  const { query: qualityWorkQuery, items: qualityWork } = useCursorList<QualityWorkItem>({
    queryKey: ['process-flow-quality-work'],
    path: '/job-orders/quality-work',
    params,
  });

  const factoriesQuery = useQuery({
    queryKey: ['job-order-factory-options'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrderFactoryOption[]>>(
        '/job-orders/factory-options',
      );
      return res.data.data;
    },
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
        searchPlaceholder="Search job order, activity or factory"
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
        hasActiveFilters={Boolean(search || filter || factoryId)}
        onClearFilters={() => {
          setSearch('');
          setFilter('');
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
              <SelectItem key={factory.id} value={factory.id}>
                {factory.name}
              </SelectItem>
            ))}
          </SelectField>
        }
      />
      <Panel
        title="Quality activities"
        description="Quality inspections and reports required by active Job Orders."
      >
        <DataTable
          data={qualityWork}
          rowKey={(item) => `${item.jobOrderId}:${item.activity.processFlowVersionStageId}`}
          loading={qualityWorkQuery.isLoading}
          loadingState={<LoadingState variant="rows" label="Loading QA work" />}
          emptyState={
            <EmptyState title="No QA work" description="No Quality activities match this view." />
          }
          error={
            qualityWorkQuery.isError ? (
              <ErrorState
                title="Unable to load QA work"
                description={qualityWorkQuery.error.message}
              />
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
        <LoadMoreFooter
          {...loadMoreProps(qualityWorkQuery, qualityWork.length, ['activity', 'activities'])}
        />
      </Panel>
    </div>
  );
}
