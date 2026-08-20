import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  PaginatedResponse,
  QaQueueFilter,
  QaQueueSummary,
  JobOrderQualityActivity,
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
  const processFlowQuery = useQuery({
    queryKey: ['process-flow-quality-work'],
    queryFn: async () =>
      (
        await apiClient.get<
          ApiSuccessResponse<
            Array<{
              jobOrderId: string;
              jobOrderNumber: string;
              purchaseOrderNumber: string;
              factory: { id: string; code: string; name: string };
              activity: JobOrderQualityActivity;
            }>
          >
        >('/job-orders/quality-work')
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
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Process Flow Quality work</h2>
        {processFlowQuery.isLoading && (
          <LoadingState variant="rows" label="Loading Process Flow Quality work" />
        )}
        {processFlowQuery.isError && (
          <ErrorState
            title="Unable to load Process Flow Quality work"
            description={processFlowQuery.error.message}
          />
        )}
        {(processFlowQuery.data ?? []).map((item) => (
          <div
            key={`${item.jobOrderId}:${item.activity.processFlowVersionStageId}`}
            className="rounded-md border border-border p-3"
          >
            <Link
              className="font-medium text-[var(--erp-text-link)]"
              to={`/job-orders/${item.jobOrderId}`}
            >
              {item.jobOrderNumber} Â· {item.activity.name}
            </Link>
            <p>
              {item.factory.name} Â· {item.activity.status.replaceAll('_', ' ')}
            </p>
            {item.activity.status === 'FAILED' && <p>Retry available</p>}
            {item.activity.status === 'MISSED' && (
              <p>Not performed during associated Production activity</p>
            )}
            {item.activity.coverage && (
              <p>
                Prepared {item.activity.coverage.preparedQuantity ?? 'Unknown'} Â· Inspected{' '}
                {item.activity.coverage.inspectedQuantity} Â· Remaining{' '}
                {item.activity.coverage.remainingQuantity ?? 'Unknown'} Â· Coverage{' '}
                {item.activity.coverage.state}
              </p>
            )}
          </div>
        ))}
      </section>
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
