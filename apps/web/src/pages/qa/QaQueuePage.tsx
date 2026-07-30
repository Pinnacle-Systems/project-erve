import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  PaginatedResponse,
  QaQueueFilter,
  QaQueueSummary,
} from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';

export function QaQueuePage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<QaQueueFilter | ''>('');
  const query = useQuery({
    queryKey: ['qa-queue', search, filter],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<PaginatedResponse<QaQueueSummary>>>('/qa/queue', {
          params: { search: search || undefined, filter: filter || undefined },
        })
      ).data.data,
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="QA supervision"
        subtitle="Inspection, rework and authoritative disposition"
      />
      <div className="flex flex-wrap gap-3">
        <input
          className="min-h-10 rounded-md border border-border bg-surface px-3"
          aria-label="Search QA"
          placeholder="Job order or PO"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="min-h-10 rounded-md border border-border bg-surface px-3"
          value={filter}
          onChange={(e) => setFilter(e.target.value as QaQueueFilter | '')}
        >
          <option value="">All QA work</option>
          <option value="AWAITING_FIRST_INSPECTION">Awaiting inspection</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="REWORK_REQUIRED">Rework required</option>
          <option value="READY_FOR_REINSPECTION">Ready for reinspection</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </div>
      <DataTable
        data={query.data?.items ?? []}
        loading={query.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading QA queue" />}
        emptyState={
          <EmptyState title="No QA work found" description="Prepared job orders appear here." />
        }
        error={
          query.isError ? (
            <ErrorState title="Unable to load QA" description={query.error.message} />
          ) : undefined
        }
        columns={[
          {
            key: 'job',
            header: 'Job order',
            render: (item) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/qa/${item.id}`}>
                {item.jobOrderNumber}
              </Link>
            ),
          },
          { key: 'po', header: 'PO', render: (item) => item.purchaseOrderNumber },
          { key: 'factory', header: 'Factory', render: (item) => item.factory.name },
          { key: 'status', header: 'Status', render: (item) => item.status.replaceAll('_', ' ') },
          {
            key: 'prepared',
            header: 'Prepared',
            align: 'right',
            render: (item) => item.totals.prepared,
          },
          {
            key: 'accepted',
            header: 'Accepted',
            align: 'right',
            render: (item) => item.totals.accepted,
          },
          {
            key: 'rework',
            header: 'Awaiting rework',
            align: 'right',
            render: (item) => item.totals.awaitingReinspection,
          },
          {
            key: 'rejected',
            header: 'Rejected',
            align: 'right',
            render: (item) => item.totals.permanentlyRejected,
          },
          {
            key: 'approved',
            header: 'Downstream ready',
            align: 'right',
            render: (item) => item.totals.finalApproved,
          },
        ]}
      />
    </div>
  );
}
