import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  QA_CHECKLIST_ITEMS,
  type ApiSuccessResponse,
  type JobOrderAuditEntry,
  type QaInspectionDetail,
} from '@erve/types';
import {
  AuditTrail,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@erve/app-components';
import { DataTable } from '@erve/data-display';
import { Button, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { formatJobOrderAuditTitle } from '../job-orders/job-order-audit.js';
import { formatDateTime, statusTone } from '../job-orders/job-order-ui.js';
import { QaInspectionForm } from './QaInspectionForm.js';

const qaTotalLabels: Record<string, string> = {
  prepared: 'Prepared',
  availableToInspect: 'Available to inspect',
  accepted: 'Accepted',
  rework: 'Rework',
  awaitingReinspection: 'Awaiting reinspection',
  permanentlyRejected: 'Permanently rejected',
  finalApproved: 'Final approved',
};

export const canReopenQaForm = (roles: readonly string[] | undefined) =>
  roles?.some((role) => role === 'ADMIN' || role === 'MERCHANDISER') ?? false;

export function QaDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['qa-detail', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QaInspectionDetail>>(`/qa/job-orders/${id}`)).data
        .data,
  });
  const audit = useQuery({
    queryKey: ['job-order-audit', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<JobOrderAuditEntry[]>>(`/job-orders/${id}/audit`))
        .data.data,
  });
  const approve = useMutation({
    mutationFn: async ({ version }: { version: number }) =>
      (
        await apiClient.post<ApiSuccessResponse<QaInspectionDetail>>(
          `/qa/job-orders/${id}/approve`,
          { expectedVersion: version },
          { headers: { 'Idempotency-Key': `web:qa-approve:${id}:${version}` } },
        )
      ).data.data,
    onSuccess: (updated) => {
      qc.setQueryData(['qa-detail', id], updated);
      void qc.invalidateQueries({ queryKey: ['qa-queue'] });
    },
  });
  if (query.isLoading) return <LoadingState label="Loading QA inspection" />;
  if (!query.data || query.isError)
    return (
      <ErrorState
        title="Unable to load QA inspection"
        description="The selected QA job order could not be loaded."
        errorDetails={query.error?.message}
        onRetry={() => void query.refetch()}
      />
    );
  const data = query.data;
  const canMutate =
    user?.roles.some((role) => ['ADMIN', 'MERCHANDISER', 'QA_USER'].includes(role)) ?? false;
  const canReopen = canReopenQaForm(user?.roles);
  return (
    <div className="space-y-5">
      <PageHeader
        title={data.jobOrderNumber}
        subtitle={`From ${data.purchaseOrderNumber}`}
        status={
          <StatusBadge label={data.status.replaceAll('_', ' ')} tone={statusTone(data.status)} />
        }
        secondaryActions={
          <Button asChild variant="secondary">
            <Link to="/qa">Back</Link>
          </Button>
        }
      />
      <Panel title="Inspection context">
        <DescriptionList columns={3}>
          <DescriptionList.Item
            label="Distributor"
            value={data.distributor?.name ?? 'Not available'}
          />
          <DescriptionList.Item
            label="Season snapshot"
            value={data.seasons.map((season) => season.displayName).join(', ') || 'Not recorded'}
          />
          <DescriptionList.Item label="Prepared quantity" value={data.totals.prepared} />
        </DescriptionList>
      </Panel>
      <QaInspectionForm
        detail={data}
        canMutate={canMutate}
        canReopen={canReopen}
        onUpdated={(updated) => {
          qc.setQueryData(['qa-detail', id], updated);
          void qc.invalidateQueries({ queryKey: ['qa-queue'] });
        }}
      />
      {canMutate &&
        data.status === 'QA_IN_PROGRESS' &&
        !data.sessions.some(
          (session) => session.status === 'DRAFT' || session.status === 'REOPENED',
        ) &&
        data.totals.availableToInspect === 0 &&
        data.totals.awaitingReinspection === 0 && (
          <Panel
            title="QA approval"
            description="Publish the reconciled accepted quantity as the final approved quantity."
            footer={
              <div className="flex justify-end">
                <Button
                  loading={approve.isPending}
                  onClick={() => approve.mutate({ version: data.version })}
                >
                  Approve final QA quantity
                </Button>
              </div>
            }
          >
            {approve.isError ? (
              <ValidationMessage tone="error">
                {approve.error instanceof Error
                  ? approve.error.message
                  : 'Unable to approve the final QA quantity.'}
              </ValidationMessage>
            ) : null}
          </Panel>
        )}
      <Panel title="Inspection summary" padding="sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(data.totals).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{qaTotalLabels[label] ?? label}</p>
              <p className="text-xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Quantity reconciliation">
        <DataTable
          density="compact"
          rowKey="jobOrderLineSizeId"
          data={data.lines}
          columns={[
            {
              key: 'styleSize',
              header: 'Style / size',
              render: (line) => `${line.styleNumber} · ${line.sizeLabel}`,
            },
            {
              key: 'preparedQuantity',
              header: 'Prepared',
              accessor: 'preparedQuantity',
              align: 'right',
            },
            {
              key: 'availableToInspect',
              header: 'Available',
              accessor: 'availableToInspect',
              align: 'right',
            },
            {
              key: 'acceptedQuantity',
              header: 'Accepted',
              accessor: 'acceptedQuantity',
              align: 'right',
            },
            { key: 'reworkQuantity', header: 'Rework', accessor: 'reworkQuantity', align: 'right' },
            {
              key: 'awaitingReinspectionQuantity',
              header: 'Awaiting',
              accessor: 'awaitingReinspectionQuantity',
              align: 'right',
            },
            {
              key: 'permanentlyRejectedQuantity',
              header: 'Rejected',
              accessor: 'permanentlyRejectedQuantity',
              align: 'right',
            },
          ]}
        />
      </Panel>
      <Panel title="Inspection history">
        <div className="space-y-4">
          {data.sessions.map((session) => (
            <Panel
              key={session.id}
              variant="bordered"
              padding="sm"
              title={`Cycle ${session.cycleNumber}${session.cycleNumber > 1 ? ' · Reinspection' : ''}`}
              description={`${session.inspector.name} · ${formatDateTime(session.finalizedAt) ?? 'Draft'}`}
              actions={
                <StatusBadge
                  label={session.status}
                  tone={session.status === 'FINALIZED' ? 'approved' : 'draft'}
                />
              }
            >
              <div className="space-y-3">
                {session.forms.map((form) => (
                  <Panel
                    key={form.id}
                    variant="subtle"
                    padding="sm"
                    title={`Size ${form.sizeLabel}`}
                    description={`${form.styleNumber} · ${form.inspectedQuantity} inspected`}
                    actions={
                      <StatusBadge
                        label={form.status}
                        tone={form.status === 'FINALIZED' ? 'approved' : 'draft'}
                      />
                    }
                  >
                    <DescriptionList columns={4} density="compact">
                      <DescriptionList.Item label="Accepted" value={form.acceptedQuantity} />
                      <DescriptionList.Item label="Rework" value={form.reworkQuantity} />
                      <DescriptionList.Item
                        label="Rejected"
                        value={form.permanentlyRejectedQuantity}
                      />
                      <DescriptionList.Item label="Samples" value={form.sampleQuantity} />
                    </DescriptionList>
                    {form.checklist.some((item) => item.status || item.remarks) ? (
                      <ul className="mt-3 space-y-1 text-sm">
                        {form.checklist
                          .filter((item) => item.status || item.remarks)
                          .map((item) => (
                            <li key={item.itemCode}>
                              {QA_CHECKLIST_ITEMS.find(
                                (definition) => definition.code === item.itemCode,
                              )?.label ?? item.itemCode.replaceAll('_', ' ')}
                              : {item.status ?? '—'}
                              {item.remarks ? ` · ${item.remarks}` : ''}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                    {form.inspectionRemarks ? (
                      <p className="mt-3 text-sm">
                        <span className="font-medium">Inspection remarks:</span>{' '}
                        {form.inspectionRemarks}
                      </p>
                    ) : null}
                  </Panel>
                ))}
              </div>
            </Panel>
          ))}
          {data.sessions.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">No inspection history available.</p>
          ) : null}
        </div>
      </Panel>
      <Panel title="Rework status">
        {data.reworkTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rework.</p>
        ) : (
          <DataTable
            density="compact"
            rowKey="id"
            data={data.reworkTasks}
            columns={[
              { key: 'styleNumber', header: 'Style', accessor: 'styleNumber' },
              { key: 'sizeCode', header: 'Size', accessor: 'sizeCode' },
              {
                key: 'assignedQuantity',
                header: 'Quantity',
                accessor: 'assignedQuantity',
                align: 'right',
              },
              {
                key: 'attemptNumber',
                header: 'Attempt',
                accessor: 'attemptNumber',
                align: 'right',
              },
              {
                key: 'status',
                header: 'Status',
                render: (task) => task.status.replaceAll('_', ' '),
              },
            ]}
          />
        )}
      </Panel>
      <Panel title="Audit history">
        <AuditTrail
          density="compact"
          items={(audit.data ?? []).map((entry) => ({
            id: entry.id,
            title: formatJobOrderAuditTitle(entry.action, entry.metadata),
            actor: entry.actor?.name ?? 'System',
            timestamp: formatDateTime(entry.createdAt),
          }))}
          emptyState={audit.isLoading ? 'Loading history…' : 'No history available.'}
        />
      </Panel>
      <Panel title="Downstream availability">
        <p className="text-sm text-muted-foreground">
          {data.status === 'QA_APPROVED'
            ? `${data.totals.finalApproved} units are authoritative for the future warehouse workflow.`
            : 'No quantity is downstream-ready until final QA approval.'}
        </p>
      </Panel>
    </div>
  );
}
