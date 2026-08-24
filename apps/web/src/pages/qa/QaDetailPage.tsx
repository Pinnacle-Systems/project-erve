import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  qaChecklistChoices,
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
  QualityChecklist,
  QualityChecklistRemark,
  QualityChecklistResult,
  QualityChecklistRow,
  QualityExecutionHeader,
  QualityExecutionPageShell,
  QualityExecutionSection,
  StatusBadge,
} from '@erve/app-components';
import { DataTable } from '@erve/data-display';
import { Button } from '@erve/primitives';
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
  const ppSampleSession = data.sessions.find((session) => session.processFlowPpSample);
  const hasProcessFlowPpSample = Boolean(ppSampleSession);
  const content = (
    <div className="space-y-5">
      {ppSampleSession ? (
        <QualityExecutionHeader
          title="PP Sample Checklist"
          formName="PP Sample form"
          attemptNumber={ppSampleSession.cycleNumber}
          status={ppSampleSession.status}
          context={`${data.purchaseOrderNumber} · ${data.factory.name}`}
        />
      ) : (
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
      )}
      {ppSampleSession ? (
        <QualityExecutionSection title="Inspection context">
          <DescriptionList columns={3}>
            <DescriptionList.Item label="Job Order" value={data.jobOrderNumber} />
            <DescriptionList.Item
              label="Distributor"
              value={data.distributor?.name ?? 'Not available'}
            />
            <DescriptionList.Item
              label="Season snapshot"
              value={data.seasons.map((season) => season.displayName).join(', ') || 'Not recorded'}
            />
          </DescriptionList>
        </QualityExecutionSection>
      ) : (
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
      )}
      <QaInspectionForm
        detail={data}
        canMutate={canMutate}
        canReopen={canReopen}
        onUpdated={(updated) => {
          qc.setQueryData(['qa-detail', id], updated);
          void qc.invalidateQueries({ queryKey: ['qa-queue'] });
        }}
      />
      {!hasProcessFlowPpSample && (
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
      )}
      {!hasProcessFlowPpSample && (
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
              {
                key: 'reworkQuantity',
                header: 'Rework',
                accessor: 'reworkQuantity',
                align: 'right',
              },
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
      )}
      <Panel title="Inspection history">
        <div className={hasProcessFlowPpSample ? 'space-y-3' : 'space-y-4'}>
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
              <div className={session.processFlowPpSample ? 'space-y-2' : 'space-y-3'}>
                {session.forms.map((form) => (
                  <Panel
                    key={form.id}
                    variant="subtle"
                    padding="sm"
                    title={`Size ${form.sizeLabel}`}
                    description={
                      session.processFlowPpSample
                        ? `${form.styleNumber} · Sample quantity ${session.processFlowPpSample.sampleQuantity} · Decision: ${session.processFlowPpSample.decision ?? 'Pending'}`
                        : `${form.styleNumber} · ${form.inspectedQuantity} inspected`
                    }
                    actions={
                      <StatusBadge
                        label={form.status}
                        tone={form.status === 'FINALIZED' ? 'approved' : 'draft'}
                      />
                    }
                  >
                    {!session.processFlowPpSample ? (
                      <DescriptionList columns={4} density="compact">
                        <>
                          <DescriptionList.Item label="Accepted" value={form.acceptedQuantity} />
                          <DescriptionList.Item label="Rework" value={form.reworkQuantity} />
                          <DescriptionList.Item
                            label="Rejected"
                            value={form.permanentlyRejectedQuantity}
                          />
                          <DescriptionList.Item label="Samples" value={form.sampleQuantity} />
                        </>
                      </DescriptionList>
                    ) : null}
                    {session.processFlowPpSample ? (
                      <div className="mt-2">
                        <QualityChecklist supplementaryHeading="Remarks">
                          {form.checklist.map((item) => {
                            const label =
                              QA_CHECKLIST_ITEMS.find(
                                (definition) => definition.code === item.itemCode,
                              )?.label ?? item.itemCode.replaceAll('_', ' ');
                            return (
                              <QualityChecklistRow
                                key={item.itemCode}
                                label={label}
                                required
                                control={
                                  <QualityChecklistResult
                                    label={`${label} response`}
                                    choices={qaChecklistChoices(true)}
                                    value={item.status ?? ''}
                                  />
                                }
                                supplementary={<QualityChecklistRemark value={item.remarks} />}
                              />
                            );
                          })}
                        </QualityChecklist>
                      </div>
                    ) : form.checklist.some((item) => item.status || item.remarks) ? (
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
  return ppSampleSession ? (
    <QualityExecutionPageShell jobOrderId={id} jobOrderNumber={data.jobOrderNumber}>
      {content}
    </QualityExecutionPageShell>
  ) : (
    content
  );
}
