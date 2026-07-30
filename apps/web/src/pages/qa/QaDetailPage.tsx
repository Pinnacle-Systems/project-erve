import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { ApiSuccessResponse, JobOrderAuditEntry, QaInspectionDetail } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useAuthedImage } from '../../lib/use-authed-image.js';

function Evidence({ id, name }: { id: string; name: string }) {
  const image = useAuthedImage(`/qa/evidence/${id}/content`);
  return (
    <div>
      {image.loading && <p>Loading {name}…</p>}
      {image.error && <p role="alert">Evidence unavailable or access denied.</p>}
      {image.url && (
        <a href={image.url} target="_blank" rel="noreferrer">
          <img className="h-28 max-w-48 rounded-md object-cover" src={image.url} alt={name} />
        </a>
      )}
    </div>
  );
}
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
  const reopen = useMutation({
    mutationFn: async ({
      sessionId,
      version,
      reason,
    }: {
      sessionId: string;
      version: number;
      reason: string;
    }) =>
      (
        await apiClient.post<ApiSuccessResponse<QaInspectionDetail>>(
          `/qa/inspections/${sessionId}/reopen`,
          { expectedVersion: version, reason },
          { headers: { 'Idempotency-Key': `web:reopen:${sessionId}:${version}` } },
        )
      ).data.data,
    onSuccess: (data) => {
      qc.setQueryData(['qa-detail', id], data);
      void qc.invalidateQueries({ queryKey: ['qa-queue'] });
    },
  });
  if (query.isLoading) return <p>Loading QA reconciliation…</p>;
  if (!query.data || query.isError)
    return <p role="alert">Unable to load QA detail. {query.error?.message}</p>;
  const data = query.data;
  const canReopen = user?.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER');
  return (
    <div className="space-y-5">
      <Link to="/qa" className="text-[var(--erp-text-link)]">
        ← QA queue
      </Link>
      <PageHeader
        title={data.jobOrderNumber}
        subtitle={`${data.factory.name} · ${data.status.replaceAll('_', ' ')}`}
      />
      <section className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(data.totals).map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label.replace(/([A-Z])/g, ' $1')}</p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Quantity reconciliation</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th>Style / size</th>
                <th>Prepared</th>
                <th>Available</th>
                <th>Accepted</th>
                <th>Rework</th>
                <th>Awaiting</th>
                <th>Rejected</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr className="border-b border-border" key={line.jobOrderLineSizeId}>
                  <td className="py-2">
                    {line.styleNumber} · {line.sizeLabel}
                  </td>
                  <td>{line.preparedQuantity}</td>
                  <td>{line.availableToInspect}</td>
                  <td>{line.acceptedQuantity}</td>
                  <td>{line.reworkQuantity}</td>
                  <td>{line.awaitingReinspectionQuantity}</td>
                  <td>{line.permanentlyRejectedQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Inspection sessions</h2>
        {data.sessions.map((session) => (
          <article key={session.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-semibold">
                  Cycle {session.cycleNumber} · {session.status}
                </p>
                <p className="text-sm text-muted-foreground">
                  {session.inspector.name} · {session.finalizedAt ?? 'Draft'}
                </p>
              </div>
              {canReopen && session.status === 'FINALIZED' && data.status !== 'QA_APPROVED' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt('Reason for reopening this finalized session?');
                    if (reason)
                      reopen.mutate({ sessionId: session.id, version: session.version, reason });
                  }}
                >
                  Reopen
                </Button>
              )}
            </div>
            <div className="mt-3 space-y-1 text-sm">
              {session.lines.map((line) => (
                <p key={line.id}>
                  {line.styleNumber} · {line.sizeLabel}: inspected {line.inspectedQuantity} =
                  accepted {line.acceptedQuantity} + rework {line.reworkQuantity} + rejected{' '}
                  {line.permanentlyRejectedQuantity}
                  {line.defectCategory ? ` · ${line.defectCategory.replaceAll('_', ' ')}` : ''}
                </p>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {session.evidence.map((e) => (
                <Evidence key={e.id} id={e.id} name={e.fileName} />
              ))}
            </div>
          </article>
        ))}
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Rework status</h2>
        {data.reworkTasks.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No rework.</p>
        ) : (
          data.reworkTasks.map((task) => (
            <p className="mt-2 text-sm" key={task.id}>
              {task.styleNumber} · {task.sizeCode}: {task.assignedQuantity}, attempt{' '}
              {task.attemptNumber}, {task.status.replaceAll('_', ' ')}
            </p>
          ))
        )}
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Audit history</h2>
        {audit.isLoading && <p>Loading audit…</p>}
        {audit.data?.map((entry) => (
          <p className="mt-2 text-sm" key={entry.id}>
            {new Date(entry.createdAt).toLocaleString()} · {entry.action} ·{' '}
            {entry.actor?.name ?? 'System'}
          </p>
        ))}
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold">Downstream availability</h2>
        <p className="mt-2">
          {data.status === 'QA_APPROVED'
            ? `${data.totals.finalApproved} units are authoritative for the future warehouse workflow.`
            : 'No quantity is downstream-ready until final QA approval.'}
        </p>
      </section>
    </div>
  );
}
