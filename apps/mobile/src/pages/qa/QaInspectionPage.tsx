import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  QaDefectCategory,
  QaInspectionDetail,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

type Entry = {
  accepted: string;
  rework: string;
  rejected: string;
  category: QaDefectCategory | '';
  notes: string;
};
const categories: QaDefectCategory[] = [
  'STITCHING',
  'FABRIC',
  'PRINT_EMBROIDERY',
  'MEASUREMENT',
  'FINISHING',
  'PACKAGING',
  'OTHER',
];
function message(error: unknown) {
  if (!isAxiosError<ApiErrorResponse>(error))
    return 'The request did not complete. You can safely retry.';
  const code = error.response?.data.error.code;
  if (code === 'STALE_VERSION')
    return 'This job changed on another device. Reload before continuing.';
  if (code === 'UNAUTHORIZED') return 'Your session expired. Sign in again.';
  if (code === 'FORBIDDEN') return 'Your QA permission or factory scope changed.';
  if (!error.response)
    return 'The result is unknown after a connection interruption. Retry with the same action.';
  return error.response.data.error.message;
}
function key(action: string, version: number) {
  return `mobile:${action}:${version}:${crypto.randomUUID()}`;
}

function useQaMutation(id: string, path: string, method: 'post' | 'put' = 'post') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, requestKey }: { body: object; requestKey: string }) =>
      (
        await apiClient.request<ApiSuccessResponse<QaInspectionDetail>>({
          url: path,
          method,
          data: body,
          headers: { 'Idempotency-Key': requestKey },
        })
      ).data.data,
    onSuccess: (data) => {
      queryClient.setQueryData(['qa-detail', id], data);
      void queryClient.invalidateQueries({ queryKey: ['qa-queue'] });
    },
  });
}

export function QaInspectionPage() {
  const { id = '' } = useParams();
  const draftKey = `erve:qa-draft:${id}`;
  const [entries, setEntries] = useState<Record<string, Entry>>(() => {
    const saved = localStorage.getItem(draftKey);
    if (!saved) return {};
    try {
      return JSON.parse(saved) as Record<string, Entry>;
    } catch {
      localStorage.removeItem(draftKey);
      return {};
    }
  });
  const query = useQuery({
    queryKey: ['qa-detail', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<QaInspectionDetail>>(`/qa/job-orders/${id}`)).data
        .data,
  });
  const currentDraft = query.data?.sessions.find((s) => s.status === 'DRAFT');
  useEffect(() => {
    if (Object.keys(entries).length) localStorage.setItem(draftKey, JSON.stringify(entries));
  }, [draftKey, entries]);
  useEffect(() => {
    if (query.data && !currentDraft) localStorage.removeItem(draftKey);
  }, [currentDraft, draftKey, query.data]);
  const start = useQaMutation(id, `/qa/job-orders/${id}/inspections`);
  const save = useQaMutation(id, `/qa/inspections/${currentDraft?.id ?? 'draft'}`, 'put');
  const finalize = useQaMutation(id, `/qa/inspections/${currentDraft?.id ?? 'draft'}/finalize`);
  const approve = useQaMutation(id, `/qa/job-orders/${id}/approve`);
  const detail = query.data;
  const selectedRework = useMemo(
    () =>
      detail?.reworkTasks.filter((t) => t.status === 'READY_FOR_REINSPECTION').map((t) => t.id) ??
      [],
    [detail],
  );
  const activeLines = useMemo(
    () =>
      detail?.lines.filter(
        (line) =>
          line.availableToInspect > 0 ||
          selectedRework.some(
            (taskId) =>
              detail.reworkTasks.find((t) => t.id === taskId)?.jobOrderLineSizeId ===
              line.jobOrderLineSizeId,
          ),
      ) ?? [],
    [detail, selectedRework],
  );
  if (query.isLoading)
    return (
      <main
        className="flex h-full min-h-0 items-center justify-center overflow-hidden bg-background p-5"
        role="status"
      >
        Loading inspection…
      </main>
    );
  if (!detail || query.isError)
    return (
      <main
        className="flex h-full min-h-0 flex-col items-center justify-center gap-3 overflow-hidden bg-background p-5 text-center"
        role="alert"
      >
        <p>{message(query.error)}</p>
        <button onClick={() => void query.refetch()}>Reload</button>
      </main>
    );
  const change = (lineId: string, patch: Partial<Entry>) =>
    setEntries((all) => ({
      ...all,
      [lineId]: {
        accepted: '',
        rework: '',
        rejected: '',
        category: '',
        notes: '',
        ...all[lineId],
        ...patch,
      },
    }));
  const sourceFor = (lineId: string) =>
    detail.reworkTasks.find(
      (t) => t.jobOrderLineSizeId === lineId && t.status === 'READY_FOR_REINSPECTION',
    );
  const payload = {
    expectedVersion: currentDraft?.version ?? 0,
    lines: activeLines
      .map((line) => {
        const e = entries[line.jobOrderLineSizeId] ?? {
          accepted: '',
          rework: '',
          rejected: '',
          category: '',
          notes: '',
        };
        const accepted = Number(e.accepted || 0),
          rework = Number(e.rework || 0),
          rejected = Number(e.rejected || 0);
        return {
          jobOrderLineSizeId: line.jobOrderLineSizeId,
          sourceReworkTaskId: sourceFor(line.jobOrderLineSizeId)?.id,
          inspectedQuantity: accepted + rework + rejected,
          acceptedQuantity: accepted,
          reworkQuantity: rework,
          permanentlyRejectedQuantity: rejected,
          defectCategory: e.category || null,
          defectNotes: e.notes || null,
        };
      })
      .filter((line) => line.inspectedQuantity > 0),
  };
  const failedMutation = [start, save, finalize, approve].find((mutation) => mutation.isError);
  const error = failedMutation?.error;
  return (
    <main className="min-h-full space-y-4 bg-background px-4 py-5">
      <Link to="/qa" className="inline-flex min-h-11 items-center text-[var(--erp-text-link)]">
        ← QA queue
      </Link>
      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          {detail.purchaseOrderNumber} · {detail.factory.name}
        </p>
        <h1 className="text-2xl font-semibold">{detail.jobOrderNumber}</h1>
        <p className="mt-2 text-sm">
          {detail.status.replaceAll('_', ' ')} · Version {detail.version}
        </p>
      </section>
      <section className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-4 text-sm">
        <span>Prepared {detail.totals.prepared}</span>
        <span>Still available {detail.totals.availableToInspect}</span>
        <span>Accepted {detail.totals.accepted}</span>
        <span>Awaiting reinspection {detail.totals.awaitingReinspection}</span>
        <span>Rejected {detail.totals.permanentlyRejected}</span>
        <span>Final approved {detail.totals.finalApproved}</span>
      </section>
      {error && (
        <section role="alert" className="rounded-lg border border-danger/40 bg-surface p-4">
          <p>{message(error)}</p>
          <div className="mt-2 flex gap-2">
            {failedMutation?.variables && (
              <button
                className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground"
                onClick={() => failedMutation.mutate(failedMutation.variables!)}
              >
                Retry safely
              </button>
            )}
            <button
              className="min-h-11 border border-border px-4"
              onClick={() => void query.refetch()}
            >
              Reload current version
            </button>
          </div>
        </section>
      )}
      {!currentDraft &&
        ['READY_FOR_QA', 'QA_IN_PROGRESS', 'READY_FOR_REINSPECTION'].includes(detail.status) && (
          <button
            className="min-h-12 w-full rounded-lg bg-primary text-primary-foreground"
            onClick={() =>
              start.mutate({
                body: { expectedVersion: detail.version, sourceReworkTaskIds: selectedRework },
                requestKey: key('start', detail.version),
              })
            }
          >
            {selectedRework.length ? 'Start reinspection' : 'Start inspection'}
          </button>
        )}
      {currentDraft && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Quantity disposition</h2>
            {activeLines.map((line) => {
              const e = entries[line.jobOrderLineSizeId] ?? {
                accepted: '',
                rework: '',
                rejected: '',
                category: '',
                notes: '',
              };
              const source = sourceFor(line.jobOrderLineSizeId);
              const maximum = source?.assignedQuantity ?? line.availableToInspect;
              return (
                <article
                  key={line.jobOrderLineSizeId}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <p className="font-semibold">
                    {line.styleNumber} · {line.sizeLabel}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {source
                      ? `Reinspect ${maximum}`
                      : `Prepared ${line.preparedQuantity} · available ${maximum}`}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['accepted', 'Accepted'],
                        ['rework', 'Rework'],
                        ['rejected', 'Reject'],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="text-xs">
                        {label}
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max={maximum}
                          className="mt-1 min-h-12 w-full rounded-md border border-border bg-background px-2 text-lg"
                          value={e[field]}
                          onChange={(event) =>
                            change(line.jobOrderLineSizeId, { [field]: event.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <select
                    aria-label="Defect category"
                    className="mt-3 min-h-12 w-full rounded-md border border-border bg-background px-3"
                    value={e.category}
                    onChange={(event) =>
                      change(line.jobOrderLineSizeId, {
                        category: event.target.value as QaDefectCategory,
                      })
                    }
                  >
                    <option value="">No defect category</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <textarea
                    aria-label="Defect notes"
                    placeholder="Defect notes"
                    className="mt-3 min-h-20 w-full rounded-md border border-border bg-background p-3"
                    value={e.notes}
                    onChange={(event) =>
                      change(line.jobOrderLineSizeId, { notes: event.target.value })
                    }
                  />
                </article>
              );
            })}
          </section>
          <button
            className="min-h-12 w-full rounded-lg bg-primary text-primary-foreground"
            disabled={!payload.lines.length || save.isPending}
            onClick={() =>
              save.mutate({
                body: payload,
                requestKey: key(`save:${currentDraft.id}`, currentDraft.version),
              })
            }
          >
            Save draft
          </button>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="font-semibold">Defect evidence</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Save quantities first. A photo is required for each permanently rejected line.
            </p>
            {currentDraft.lines.map((line) => (
              <label key={line.id} className="mt-3 block text-sm">
                {line.styleNumber} · {line.sizeLabel}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="mt-1 block min-h-11 w-full"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append('image', file);
                    form.append('inspectionLineId', line.id);
                    await apiClient.post(`/qa/inspections/${currentDraft.id}/evidence`, form);
                    await query.refetch();
                  }}
                />
              </label>
            ))}
          </section>
          <button
            className="min-h-12 w-full rounded-lg border border-primary text-primary"
            disabled={finalize.isPending}
            onClick={() =>
              finalize.mutate({
                body: { expectedVersion: currentDraft.version },
                requestKey: key(`finalize:${currentDraft.id}`, currentDraft.version),
              })
            }
          >
            Review complete · finalize session
          </button>
        </>
      )}
      {detail.status === 'QA_IN_PROGRESS' &&
        !currentDraft &&
        detail.totals.availableToInspect === 0 &&
        detail.totals.awaitingReinspection === 0 && (
          <button
            className="min-h-12 w-full rounded-lg bg-primary text-primary-foreground"
            onClick={() =>
              approve.mutate({
                body: { expectedVersion: detail.version },
                requestKey: key('approve', detail.version),
              })
            }
          >
            Approve final QA quantity
          </button>
        )}
      {detail.status === 'REWORK_REQUIRED' && (
        <p className="rounded-lg bg-primary/10 p-4">
          Factory rework is pending. Accepted quantities remain protected.
        </p>
      )}
      {detail.status === 'QA_APPROVED' && (
        <p className="rounded-lg bg-primary/10 p-4">
          QA approved: {detail.totals.finalApproved} units are authoritative for future warehouse
          receipt.
        </p>
      )}
    </main>
  );
}
