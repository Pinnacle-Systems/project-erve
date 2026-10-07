import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  calculatePpSampleOutcome,
  canStartQaInspection,
  qaChecklistChoices,
  QA_CHECKLIST_ITEMS,
  type ApiErrorResponse,
  type ApiSuccessResponse,
  type QaChecklistStatus,
  type QaDefectCategory,
  type QaInspectionDetail,
  type QaSizeInspectionFormView,
} from '@erve/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SelectField,
  SelectItem,
  Textarea,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import {
  AttachmentList,
  ConfirmDialog,
  createEnterToNextHandler,
  QualityChecklist,
  QualityChecklistRemark,
  QualityChecklistResult,
  QualityChecklistRow,
  QualityChoiceGroup,
  QualityExecutionActions,
  QualityExecutionSection,
  StatusBadge,
} from '@erve/app-components';
import { DescriptionList, FormGrid, FormSection, Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { useUnsavedChangesWarning } from '../../lib/use-unsaved-changes.js';
import { useAuthedImage } from '../../lib/use-authed-image.js';

type Draft = {
  sample: string;
  remarks: string;
  accepted: string;
  rework: string;
  rejected: string;
  category: QaDefectCategory | '';
  other: string;
  notes: string;
  checks: Record<string, { status: QaChecklistStatus | ''; remarks: string }>;
};
type Errors = Record<string, string>;
type SaveMutationVariables = {
  path: string;
  method: 'post' | 'put';
  body: object;
  finalizePath?: string;
  formId?: string;
  finalizeBody?: object;
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
const requestKey = (action: string, version: number) =>
  `web:${action}:${version}:${crypto.randomUUID()}`;
const initial = (form: QaSizeInspectionFormView): Draft => ({
  sample: form.sampleQuantity?.toString() ?? '',
  remarks: form.inspectionRemarks ?? '',
  accepted: String(form.acceptedQuantity),
  rework: String(form.reworkQuantity),
  rejected: String(form.permanentlyRejectedQuantity),
  category: form.defectCategory ?? '',
  other: form.otherDefectDetails ?? '',
  notes: form.defectNotes ?? '',
  checks: Object.fromEntries(
    form.checklist.map((item) => [
      item.itemCode,
      { status: item.status ?? '', remarks: item.remarks ?? '' },
    ]),
  ),
});
function EvidenceAttachment({
  id,
  name,
  readonly,
  removing,
  onRemove,
}: {
  id: string;
  name: string;
  readonly: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const image = useAuthedImage(`/qa/evidence/${id}/content`);
  return (
    <AttachmentList
      density="compact"
      items={[
        {
          id,
          name,
          status: image.error ? 'failed' : image.loading ? 'pending' : 'uploaded',
        },
      ]}
      onView={
        image.url ? () => window.open(image.url!, '_blank', 'noopener,noreferrer') : undefined
      }
      onRemove={!readonly && !removing ? onRemove : undefined}
    />
  );
}
function validate(
  draft: Draft,
  capacity: number,
  finalizing: boolean,
  evidence: number,
  ppSample: boolean,
): Errors {
  const errors: Errors = {};
  const quantity = (value: string, name: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!/^\d+$/.test(trimmed)) {
      errors[name] = 'Enter a non-negative whole number.';
      return null;
    }
    const num = Number(trimmed);
    if (num > 2147483647) {
      errors[name] = 'Quantity is too large.';
      return null;
    }
    return num;
  };
  const sample = quantity(draft.sample, 'sample');
  const accepted = ppSample ? 0 : quantity(draft.accepted, 'accepted');
  const rework = ppSample ? 0 : quantity(draft.rework, 'rework');
  const rejected = ppSample ? 0 : quantity(draft.rejected, 'rejected');
  if (sample !== null && sample > 2147483647) errors.sample = 'Sample quantity is too large.';
  if (!ppSample) {
    if (
      draft.accepted.trim() === '' ||
      draft.rework.trim() === '' ||
      draft.rejected.trim() === ''
    ) {
      errors.quantities = 'Enter a non-negative whole number for each quantity.';
    } else if (
      accepted !== null &&
      rework !== null &&
      rejected !== null &&
      accepted + rework + rejected > capacity
    ) {
      errors.quantities = `Quantities cannot exceed ${capacity}, the available capacity for this size.`;
    }
  }
  if (draft.category !== 'OTHER' && draft.other.trim())
    errors.other = 'Clear OTHER details unless OTHER is selected.';
  if (finalizing) {
    if (!draft.sample.trim()) errors.sample = 'Sample quantity is required to finalize.';
    for (const item of QA_CHECKLIST_ITEMS)
      if (
        !draft.checks[item.code]?.status ||
        (ppSample && draft.checks[item.code]?.status === 'AVAILABLE')
      )
        errors[`check.${item.code}`] = 'A response is required to finalize.';
    if (!ppSample) {
      if (
        draft.accepted.trim() === '' ||
        draft.rework.trim() === '' ||
        draft.rejected.trim() === ''
      ) {
        errors.quantities = 'Final quantities must reconcile to ' + capacity + '.';
      } else if (
        accepted !== null &&
        rework !== null &&
        rejected !== null &&
        accepted + rework + rejected !== capacity
      ) {
        errors.quantities = `Final quantities must reconcile to ${capacity}.`;
      }
    }
    if ((rework || rejected) && !draft.category) errors.category = 'Choose a defect category.';
    if (draft.category === 'OTHER' && !draft.other.trim())
      errors.other = 'Describe the other defect.';
    if (ppSample && evidence === 0)
      errors.evidence = 'Evidence is required before a PP Sample can be finalized.';
    else if (rejected !== null && rejected > 0 && evidence === 0)
      errors.evidence =
        'Evidence for this size is required before permanent rejection can be finalized.';
  }
  return errors;
}

export function QaInspectionForm({
  detail,
  canMutate,
  canReopen = false,
  onUpdated,
}: {
  detail: QaInspectionDetail;
  canMutate: boolean;
  canReopen?: boolean;
  onUpdated: (detail: QaInspectionDetail) => void;
}) {
  const session = detail.sessions.find(
    (item) => item.status === 'DRAFT' || item.status === 'REOPENED',
  );
  const forms = session?.forms ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected =
    forms.find((item) => item.id === selectedId) ??
    forms.find((item) => item.status !== 'FINALIZED') ??
    forms[0];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [pendingFinalize, setPendingFinalize] = useState<SaveMutationVariables | null>(null);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  // Entered-but-unsaved size results live only in `drafts` (cleared per form on save).
  useUnsavedChangesWarning(Object.keys(drafts).length > 0 || reopenReason.trim() !== '');
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const draft = selected ? (drafts[selected.id] ?? initial(selected)) : undefined;
  const line = selected
    ? detail.lines.find((item) => item.jobOrderLineSizeId === selected.jobOrderLineSizeId)
    : undefined;
  const rework = selected
    ? detail.reworkTasks.find((item) => item.id === selected.sourceReworkTaskId)
    : undefined;
  const ppSample = session?.processFlowPpSample ?? null;
  const capacity =
    ppSample?.sampleQuantity ?? rework?.assignedQuantity ?? selected?.preparedQuantity ?? 0;
  const remainingInspectable = rework?.assignedQuantity ?? line?.availableToInspect ?? capacity;
  const evidence = session?.evidence.filter((item) => item.inspectionLineId === selected?.id) ?? [];
  const update = (change: Partial<Draft>) => {
    if (!selected) return;
    setNotice('');
    setDrafts((all) => ({
      ...all,
      [selected.id]: { ...(all[selected.id] ?? initial(selected)), ...change },
    }));
  };
  const clearValidationErrors = (...fields: string[]) =>
    setErrors((current) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      if (!Object.keys(next).some((field) => field !== 'form')) delete next.form;
      return next;
    });
  const selectForm = (formId: string) => {
    setSelectedId(formId);
    setErrors({});
    setStale(false);
    setNotice('');
  };
  const refresh = async () =>
    (await apiClient.get<ApiSuccessResponse<QaInspectionDetail>>(`/qa/job-orders/${detail.id}`))
      .data.data;
  const mutation = useMutation({
    mutationFn: async ({
      path,
      method,
      body,
      finalizePath,
      formId,
      finalizeBody,
    }: SaveMutationVariables) => {
      const saved = (
        await apiClient.request<ApiSuccessResponse<QaInspectionDetail>>({
          url: path,
          method,
          data: body,
          headers: { 'Idempotency-Key': requestKey(path, selected?.version ?? 0) },
        })
      ).data.data;
      if (!finalizePath || !formId) return saved;
      const savedForm = saved.sessions
        .flatMap((candidate) => candidate.forms)
        .find((candidate) => candidate.id === formId);
      if (!savedForm) throw new Error('Saved size inspection form was not returned by the API.');
      return (
        await apiClient.request<ApiSuccessResponse<QaInspectionDetail>>({
          url: finalizePath,
          method: 'post',
          data: { expectedVersion: savedForm.version, ...finalizeBody },
          headers: { 'Idempotency-Key': requestKey(finalizePath, savedForm.version) },
        })
      ).data.data;
    },
    onSuccess: (updated, variables) => {
      if (selected)
        setDrafts((all) => {
          const next = { ...all };
          delete next[selected.id];
          return next;
        });
      setErrors({});
      setStale(false);
      setNotice(
        variables.finalizePath ? `Size ${selected?.sizeLabel} finalized.` : 'Size form updated.',
      );
      setReopenOpen(false);
      setReopenReason('');
      setPendingFinalize(null);
      onUpdated(updated);
    },
    onError: (error) => {
      setPendingFinalize(null);
      const api = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error : undefined;
      if (api?.code === 'STALE_VERSION' || api?.code === 'CONFLICT') setStale(true);
      const issues =
        (
          api?.details as
            { issues?: Array<{ path?: Array<string | number>; field?: string; message?: string }> } | undefined
        )?.issues ?? [];
      const own: Errors = {};
      const others: Record<string, string> = {};
      for (const issue of issues) {
        const path = issue.path?.map(String) ?? (issue.field ? issue.field.split('.') : []);
        const form = forms.find((candidate) => path.includes(candidate.id));
        const message = issue.message ?? 'Invalid value';
        if (form && form.id !== selected?.id) others[form.id] = message;
        else {
          const fieldKey =
            path.includes('acceptedQuantity') || path.includes('accepted')
              ? 'accepted'
              : path.includes('reworkQuantity') || path.includes('rework')
                ? 'rework'
                : path.includes('permanentlyRejectedQuantity') || path.includes('rejected')
                  ? 'rejected'
                  : path.includes('quantities')
                    ? 'quantities'
                    : path.includes('sampleQuantity') || path.includes('sample')
                      ? 'sample'
                      : path.includes('defectCategory') || path.includes('category')
                        ? 'category'
                        : path.includes('otherDefectDetails') || path.includes('other')
                          ? 'other'
                          : path.includes('defectNotes') || path.includes('notes')
                            ? 'notes'
                            : path.includes('inspectionRemarks') || path.includes('remarks')
                              ? 'remarks'
                              : path.includes('checklist')
                                ? 'checklist'
                                : path.join('.') || 'form';
          own[fieldKey] = message;
        }
      }
      const rawMessage = api?.message;
      const isRawTransport =
        !rawMessage ||
        rawMessage === 'Invalid request data' ||
        rawMessage.toLowerCase().includes('validation error');
      if (!issues.length) {
        own.form = isRawTransport
          ? 'Please review and correct the highlighted fields before saving.'
          : rawMessage ?? 'Unable to update the size inspection form.';
      } else if (!Object.keys(own).length && !Object.keys(others).length) {
        own.form = isRawTransport
          ? 'Please review and correct the highlighted fields before saving.'
          : rawMessage;
      }
      setErrors(own);
      const related = Object.entries(others).map(([id, message]) => {
        const form = forms.find((candidate) => candidate.id === id);
        return form ? `Size ${form.sizeLabel}: ${message}` : message;
      });
      if (related.length) setNotice(related.join(' '));
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('image', file);
      body.append('inspectionLineId', selected!.id);
      await apiClient.post(`/qa/inspections/${session!.id}/evidence`, body);
      return refresh();
    },
    onSuccess: (updated) => {
      setNotice(`Evidence added to size ${selected?.sizeLabel}.`);
      onUpdated(updated);
    },
  });
  const removeEvidence = useMutation({
    mutationFn: async (evidenceId: string) => {
      await apiClient.delete(`/qa/evidence/${evidenceId}`);
      return refresh();
    },
    onSuccess: (updated) => {
      setNotice(`Evidence removed from size ${selected?.sizeLabel}.`);
      onUpdated(updated);
    },
  });
  if (!canMutate && !canReopen) return null;
  if (!session)
    return canMutate && canStartQaInspection(detail.status) ? (
      <Panel
        title="QA Inspection Form"
        description="Start a size-specific inspection cycle for this job order."
        footer={
          <div className="flex justify-end">
            <Button
              loading={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  path: `/qa/job-orders/${detail.id}/inspections`,
                  method: 'post',
                  body: {
                    expectedVersion: detail.version,
                    sourceReworkTaskIds: detail.reworkTasks
                      .filter((item) => item.status === 'READY_FOR_REINSPECTION')
                      .map((item) => item.id),
                  },
                })
              }
            >
              Start inspection
            </Button>
          </div>
        }
      >
        {errors.form ? <ValidationMessage tone="error">{errors.form}</ValidationMessage> : null}
      </Panel>
    ) : null;
  if (!selected || !draft) return null;
  const readonly = selected.status === 'FINALIZED' || !canMutate;
  // DEMO-005: the PP Sample result is calculated from the checklist, never
  // chosen manually — any explicit No fails it, N/A and Yes never do.
  const calculatedPpSampleDecision = ppSample
    ? calculatePpSampleOutcome(
        QA_CHECKLIST_ITEMS.map((item) => ({ status: draft.checks[item.code]?.status || null })),
      )
    : null;
  const save = (finalizing: boolean) => {
    setNotice('');
    const next = validate(draft, capacity, finalizing, evidence.length, Boolean(ppSample));
    if (Object.keys(next).length) {
      setErrors({
        ...next,
        form: finalizing
          ? `Size ${selected.sizeLabel} was not finalized. Review the highlighted field${Object.keys(next).length === 1 ? '' : 's'}.`
          : `Size ${selected.sizeLabel} was not saved. Review the highlighted field${Object.keys(next).length === 1 ? '' : 's'}.`,
      });
      return;
    }
    setErrors({});
    const disposition = ppSample
      ? {}
      : {
          inspectedQuantity:
            Number(draft.accepted) + Number(draft.rework) + Number(draft.rejected),
          acceptedQuantity: Number(draft.accepted),
          reworkQuantity: Number(draft.rework),
          permanentlyRejectedQuantity: Number(draft.rejected),
        };
    const body = {
      expectedVersion: selected.version,
      sampleQuantity: draft.sample ? Number(draft.sample) : null,
      inspectionRemarks: draft.remarks.trim() || null,
      checklist: QA_CHECKLIST_ITEMS.map((item) => ({
        itemCode: item.code,
        status:
          ppSample && draft.checks[item.code]?.status === 'AVAILABLE'
            ? null
            : draft.checks[item.code]?.status || null,
        remarks: draft.checks[item.code]?.remarks.trim() || null,
      })),
      ...disposition,
      defectCategory: draft.category || null,
      otherDefectDetails: draft.category === 'OTHER' ? draft.other.trim() : null,
      defectNotes: draft.category === 'OTHER' ? null : draft.notes.trim() || null,
    };
    const variables: SaveMutationVariables = {
      path: `/qa/inspections/${session.id}/forms/${selected.id}`,
      method: 'put',
      body,
      finalizePath: finalizing
        ? `/qa/inspections/${session.id}/forms/${selected.id}/finalize`
        : undefined,
      formId: finalizing ? selected.id : undefined,
    };
    if (finalizing && ppSample) {
      setPendingFinalize(variables);
      return;
    }
    mutation.mutate(variables);
  };
  const executeReload = async () => {
    if (!selected) return;
    setReloading(true);
    try {
      const updated = await refresh();
      setDrafts((all) => {
        const next = { ...all };
        delete next[selected.id];
        return next;
      });
      setStale(false);
      setErrors({});
      setNotice(`Reloaded size ${selected.sizeLabel}.`);
      onUpdated(updated);
    } finally {
      setReloading(false);
      setReloadConfirmOpen(false);
    }
  };

  const handleReloadClick = async () => {
    if (!selected) return;
    if (drafts[selected.id]) {
      setReloadConfirmOpen(true);
      return;
    }
    await executeReload();
  };
  const formActions = (
    <QualityExecutionActions
      message={
        errors.form ? (
          <ValidationMessage tone="error" role="alert">
            {errors.form}
          </ValidationMessage>
        ) : notice ? (
          <ValidationMessage tone="success" role="status">
            {notice}
          </ValidationMessage>
        ) : null
      }
    >
      {!readonly && (
        <>
          <Button
            type="button"
            variant="secondary"
            loading={mutation.isPending}
            onClick={() => save(false)}
          >
            Save size form
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => save(true)}>
            Finalize size {selected.sizeLabel}
          </Button>
        </>
      )}
      {selected.status === 'FINALIZED' && canReopen && (
        <Button
          type="button"
          loading={mutation.isPending}
          onClick={() => {
            setReopenReason('');
            setReopenOpen(true);
          }}
        >
          Reopen size {selected.sizeLabel}
        </Button>
      )}
    </QualityExecutionActions>
  );
  return (
    <>
      <QualityExecutionSection
        title="QA Inspection Form"
        description={`Cycle ${session.cycleNumber} · ${forms.filter((form) => form.status === 'FINALIZED').length} of ${forms.length} forms finalized`}
      >
        <div className="space-y-6" onKeyDown={createEnterToNextHandler()}>
          {!ppSample && (
            <nav aria-label="Size inspection forms" className="flex flex-wrap gap-2">
              {forms.map((form) => (
                <Button
                  type="button"
                  key={form.id}
                  aria-pressed={form.id === selected.id}
                  onClick={() => selectForm(form.id)}
                  variant={form.id === selected.id ? 'default' : 'secondary'}
                >
                  Size {form.sizeLabel}
                  <StatusBadge
                    label={form.status}
                    tone={form.status === 'FINALIZED' ? 'approved' : 'draft'}
                  />
                </Button>
              ))}
            </nav>
          )}
          <FormSection title="Inspection Details">
            <DescriptionList columns={3}>
              <DescriptionList.Item label="Job Order" value={detail.jobOrderNumber} />
              <DescriptionList.Item
                label="Style / colour"
                value={`${selected.styleNumber} · ${selected.colour ?? '—'}`}
              />
              <DescriptionList.Item label="Selected size" value={selected.sizeLabel} />
              {ppSample && (
                <DescriptionList.Item label="Sample quantity" value={ppSample.sampleQuantity} />
              )}
              <DescriptionList.Item label="Prepared" value={selected.preparedQuantity} />
              <DescriptionList.Item
                label="Previously inspected"
                value={
                  line
                    ? line.acceptedQuantity + line.reworkQuantity + line.permanentlyRejectedQuantity
                    : 0
                }
              />
              <DescriptionList.Item label="Remaining inspectable" value={remainingInspectable} />
            </DescriptionList>
            <TextField
              label="Quantity of samples"
              aria-label="Quantity of samples"
              type="number"
              min={0}
              inputMode="numeric"
              width="xs"
              disabled={readonly || Boolean(ppSample)}
              value={draft.sample}
              errorMessage={errors.sample}
              onChange={(event) => update({ sample: event.target.value })}
            />
          </FormSection>
          {ppSample && (
            <FormSection title="PP Sample Result">
              <p>
                The result is calculated automatically from the checklist responses and cannot be
                overridden.
              </p>
              <QualityChecklistResult
                label="PP Sample result"
                value={ppSample.decision ?? calculatedPpSampleDecision ?? ''}
                choices={[
                  { value: 'PASS', label: 'PASS' },
                  { value: 'FAIL', label: 'FAIL' },
                ]}
              />
            </FormSection>
          )}
          <FormSection title="Inspection Checklist">
            <QualityChecklist supplementaryHeading="Remarks">
              {QA_CHECKLIST_ITEMS.map((item) => {
                const check = draft.checks[item.code] ?? { status: '', remarks: '' };
                const choices = qaChecklistChoices(Boolean(ppSample));
                return (
                  <QualityChecklistRow
                    key={item.code}
                    label={item.label}
                    required
                    error={errors[`check.${item.code}`]}
                    control={
                      readonly ? (
                        <QualityChecklistResult
                          label={`${item.label} response`}
                          choices={choices}
                          value={check.status}
                        />
                      ) : (
                        <QualityChoiceGroup
                          id={`qa-check-${item.code}`}
                          label={`${item.label} response`}
                          choices={choices}
                          value={check.status}
                          required
                          onChange={(value) =>
                            update({
                              checks: {
                                ...draft.checks,
                                [item.code]: {
                                  ...check,
                                  status: value as QaChecklistStatus,
                                },
                              },
                            })
                          }
                        />
                      )
                    }
                    supplementary={
                      readonly ? (
                        <QualityChecklistRemark value={check.remarks} />
                      ) : (
                        <TextField
                          aria-label={`${item.label} remarks`}
                          density="compact"
                          width="full"
                          value={check.remarks}
                          onChange={(event) =>
                            update({
                              checks: {
                                ...draft.checks,
                                [item.code]: { ...check, remarks: event.target.value },
                              },
                            })
                          }
                        />
                      )
                    }
                  />
                );
              })}
            </QualityChecklist>
          </FormSection>
          <FormSection title="Inspection remarks">
            <Textarea
              aria-label="Inspection remarks"
              disabled={readonly}
              value={draft.remarks}
              onChange={(event) => update({ remarks: event.target.value })}
              className="min-h-24"
            />
          </FormSection>
          {!ppSample && (
            <FormSection title="Inspection outcome">
              <FormGrid layout="content">
                {(['accepted', 'rework', 'rejected'] as const).map((field) => (
                  <TextField
                    key={field}
                    label={field[0]!.toUpperCase() + field.slice(1)}
                    aria-label={`${selected.sizeLabel} ${field}`}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    width="xs"
                    disabled={readonly}
                    value={draft[field]}
                    errorMessage={errors[field]}
                    onChange={(event) => {
                      clearValidationErrors(field, 'quantities');
                      update({ [field]: event.target.value } as Partial<Draft>);
                    }}
                  />
                ))}
              </FormGrid>
              {errors.quantities && (
                <ValidationMessage tone="error">{errors.quantities}</ValidationMessage>
              )}
            </FormSection>
          )}
          <FormSection title="Defect Information">
            <FormGrid columns={2}>
              <SelectField
                label="Defect category"
                width="md"
                errorMessage={errors.category}
                disabled={readonly}
                value={draft.category || 'NONE'}
                onValueChange={(value) => {
                  if (value !== 'NONE') clearValidationErrors('category');
                  if (value !== 'OTHER') clearValidationErrors('other');
                  update({
                    category: value === 'NONE' ? '' : (value as QaDefectCategory),
                    other: value === 'OTHER' ? draft.other : '',
                  });
                }}
              >
                <SelectItem value="NONE">None</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectField>
              {draft.category === 'OTHER' ? (
                <Textarea
                  label="Other defect details"
                  aria-label="Other defect details"
                  disabled={readonly}
                  value={draft.other}
                  errorMessage={errors.other}
                  onChange={(event) => {
                    if (event.target.value.trim()) clearValidationErrors('other');
                    update({ other: event.target.value });
                  }}
                  className="min-h-20"
                />
              ) : draft.category ? (
                <Textarea
                  label="Defect notes"
                  aria-label="Defect notes"
                  disabled={readonly}
                  value={draft.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                  className="min-h-20"
                />
              ) : null}
            </FormGrid>
            {errors.other && draft.category !== 'OTHER' && <p role="alert">{errors.other}</p>}
          </FormSection>
          <FormSection title={`Evidence for size ${selected.sizeLabel}`}>
            {evidence.length ? (
              evidence.map((item) => (
                <EvidenceAttachment
                  key={item.id}
                  id={item.id}
                  name={item.fileName}
                  readonly={readonly}
                  removing={removeEvidence.isPending}
                  onRemove={() => removeEvidence.mutate(item.id)}
                />
              ))
            ) : (
              <p>No evidence attached to this size.</p>
            )}
            {!readonly && (
              <>
                <input
                  ref={evidenceInputRef}
                  aria-label={`Upload evidence for size ${selected.sizeLabel}`}
                  type="file"
                  accept="image/*"
                  disabled={upload.isPending}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload.mutate(file);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={upload.isPending}
                  onClick={() => evidenceInputRef.current?.click()}
                >
                  Upload evidence
                </Button>
              </>
            )}
            {ppSample && !errors.evidence && (
              <p>PP Sample finalization requires evidence attached to this exact size.</p>
            )}
            {!ppSample && Number(draft.rejected || 0) > 0 && !errors.evidence && (
              <p>Permanent rejection requires evidence attached to this exact size.</p>
            )}
            {errors.evidence && <p role="alert">{errors.evidence}</p>}
          </FormSection>
          {stale && (
            <ValidationMessage tone="error" role="alert">
              <span>This size inspection has changed since you opened it.</span>{' '}
              <Button type="button" variant="ghost" density="compact" onClick={() => void handleReloadClick()}>
                Reload latest
              </Button>
            </ValidationMessage>
          )}
          {upload.isError ? (
            <ValidationMessage tone="error">Unable to upload evidence.</ValidationMessage>
          ) : null}
          {removeEvidence.isError ? (
            <ValidationMessage tone="error">Unable to remove evidence.</ValidationMessage>
          ) : null}
        </div>
      </QualityExecutionSection>
      {formActions}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen size {selected.sizeLabel}</DialogTitle>
            <DialogDescription>
              Record why this finalized size inspection needs correction.
            </DialogDescription>
          </DialogHeader>
          <TextField
            label="Reason"
            width="fill"
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              loading={mutation.isPending}
              disabled={!reopenReason.trim()}
              onClick={() =>
                mutation.mutate({
                  path: `/qa/inspections/${session.id}/forms/${selected.id}/reopen`,
                  method: 'post',
                  body: { expectedVersion: selected.version, reason: reopenReason.trim() },
                })
              }
            >
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingFinalize !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFinalize(null);
        }}
        title={`Finalize this inspection as ${calculatedPpSampleDecision}?`}
        confirmLabel="Yes, finalize"
        loading={mutation.isPending}
        onConfirm={() => {
          if (pendingFinalize) mutation.mutate(pendingFinalize);
        }}
      />
      {selected ? (
        <ConfirmDialog
          open={reloadConfirmOpen}
          onOpenChange={(open) => {
            setReloadConfirmOpen(open);
            if (!open) setReloading(false);
          }}
          title={`Discard unsaved edits for size ${selected.sizeLabel}?`}
          description={`Reloading size ${selected.sizeLabel} discards unsaved edits.`}
          confirmLabel="Discard and reload"
          cancelLabel="Keep editing"
          destructive
          loading={reloading}
          onConfirm={() => void executeReload()}
        />
      ) : null}
    </>
  );
}
