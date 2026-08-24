import { useEffect, useState } from 'react';
import { Button, Checkbox, DatePicker, TextField } from '@erve/primitives';
import type {
  QualityExecutionPayload,
  QualityExecutionValidationError,
  QualityExecutionView,
} from '@erve/types';
import { displayActivityName } from '../job-order-operational-presentation.js';
import {
  QualityChecklist,
  QualityChecklistResult,
  QualityChecklistRow,
  QualityChoiceGroup,
} from './quality-checklist.js';
import {
  formatQualityDate,
  QualityDefinitionComponent,
  QualityFieldGrid,
  QualityReadOnlyGrid,
  QualityReadOnlyValue,
  QualityRepeatingList,
  QualityRepeatingRow,
} from './quality-definition-form.js';
import {
  QualityExecutionActions,
  QualityExecutionHeader,
  QualityExecutionSection,
  qualityExecutionControlClass,
  qualityExecutionTextAreaClass,
} from './quality-execution-shell.js';
import { QualityProductionContext } from './quality-production-context.js';

type ConfigRow = Record<string, unknown>;
const rows = (value: unknown): ConfigRow[] => (Array.isArray(value) ? (value as ConfigRow[]) : []);
const text = (value: unknown) => String(value ?? '');
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/(^|[_\s-])\S/g, (character) => character.toUpperCase())
    .replaceAll('_', ' ');
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (102.4 * 1024)) / 10} MB`;
};
const replace = <T,>(values: T[], match: (value: T) => boolean, next: T) => [
  ...values.filter((value) => !match(value)),
  next,
];
const controlClass = qualityExecutionControlClass;
const textAreaClass = qualityExecutionTextAreaClass;
let executionRowSequence = 0;
const nextRowKey = () => `execution-row-${++executionRowSequence}`;
const controlId = (componentId: string, fieldKey: string, rowIndex?: number) =>
  `quality-${componentId}-${rowIndex === undefined ? '' : `row-${rowIndex}-`}${fieldKey}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '-',
  );
const errorMatches = (
  error: QualityExecutionValidationError,
  componentId: string,
  fieldKey: string,
  rowIndex?: number,
) =>
  error.componentId === componentId && error.fieldKey === fieldKey && error.rowIndex === rowIndex;
const errorClass =
  'border-[var(--erp-form-field-error-border)] focus:border-[var(--erp-form-field-error-border)]';

export interface QualityExecutionFormProps {
  execution: QualityExecutionView;
  onSave(payload: QualityExecutionPayload): Promise<void>;
  onFinalize(payload: QualityExecutionPayload): Promise<void>;
  onUpload?(componentId: string, requirementKey: string, file: File): Promise<void>;
  onRemoveAttachment?(attachmentId: string): Promise<void>;
  onCancelBatch?(reason: string): Promise<void>;
  onStartReinspection?(): Promise<void>;
  onPermanentlyReject?(reason: string): Promise<void>;
  busy?: boolean;
  error?: string;
  validationErrors?: QualityExecutionValidationError[];
}

export function QualityExecutionForm(props: QualityExecutionFormProps) {
  const { execution, busy, error } = props;
  const [draft, setDraft] = useState<QualityExecutionPayload>(execution.responses);
  const [actionRowKeys, setActionRowKeys] = useState(() =>
    execution.responses.actions.map(() => nextRowKey()),
  );
  const [visibleErrors, setVisibleErrors] = useState(props.validationErrors ?? []);
  const [batchReason, setBatchReason] = useState('');
  useEffect(() => {
    const next = props.validationErrors ?? [];
    // The local list intentionally resets when the server returns a new validation result.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleErrors(next);
    const first = next[0];
    if (!first) return;
    const target = document.getElementById(
      controlId(first.componentId, first.fieldKey, first.rowIndex),
    );
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target?.focus();
  }, [props.validationErrors]);
  const fieldError = (componentId: string, fieldKey: string, rowIndex?: number) =>
    visibleErrors.find((item) => errorMatches(item, componentId, fieldKey, rowIndex));
  const clearFieldError = (
    componentId: string,
    fieldKey: string,
    rowIndex?: number,
    valid = true,
  ) => {
    if (!valid) return;
    setVisibleErrors((current) =>
      current.filter((item) => !errorMatches(item, componentId, fieldKey, rowIndex)),
    );
  };
  const focusError = (item: QualityExecutionValidationError) => {
    const target = document.getElementById(
      controlId(item.componentId, item.fieldKey, item.rowIndex),
    );
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    target?.focus();
  };
  const set = <K extends keyof QualityExecutionPayload>(
    key: K,
    value: QualityExecutionPayload[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const disabled = execution.status !== 'DRAFT' || busy;
  const priorInspectedQuantity =
    execution.coverage?.batches
      .filter((batch) => batch.status === 'FINALIZED' && batch.batchNumber < execution.batchNumber)
      .reduce((sum, batch) => sum + (batch.inspectedQuantity ?? 0), 0) ?? 0;
  const currentBatchQuantity = execution.inspectedQuantity ?? 0;
  const quantityThroughCurrentBatch = priorInspectedQuantity + currentBatchQuantity;
  const remainingAfterCurrentBatch = execution.coverage?.preparedQuantityAuthoritative
    ? Math.max(0, (execution.coverage.preparedQuantity ?? 0) - quantityThroughCurrentBatch)
    : null;
  const currentBatchConflict = execution.coverage?.preparedQuantityAuthoritative
    ? quantityThroughCurrentBatch > (execution.coverage.preparedQuantity ?? 0)
    : false;

  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <QualityExecutionHeader
        title={displayActivityName(execution.activityName)}
        formName={execution.qualityForm.name}
        versionNumber={execution.qualityForm.versionNumber}
        attemptNumber={execution.attemptNumber}
        status={execution.status}
        context={
          execution.coverage ? (
            <p aria-label="Final inspection batch summary">
              Prepared{' '}
              {execution.coverage.preparedQuantityAuthoritative
                ? execution.coverage.preparedQuantity
                : 'not available'}{' '}
              · Previously inspected {priorInspectedQuantity} · This inspection{' '}
              {execution.inspectedQuantity ?? 'not recorded'} · Remaining after this batch{' '}
              {remainingAfterCurrentBatch ?? 'pending prepared quantity'}
            </p>
          ) : undefined
        }
      />
      {execution.finalBatch ? (
        <QualityExecutionSection
          title={`Physical Final batch ${execution.finalBatch.batchNumber}`}
          description="The size allocation belongs to this physical batch and stays unchanged across every inspection attempt."
        >
          <QualityReadOnlyGrid>
            <QualityReadOnlyValue
              label="Physical quantity"
              value={String(execution.finalBatch.physicalQuantity)}
            />
            <QualityReadOnlyValue
              label="Disposition"
              value={titleCase(execution.finalBatch.disposition)}
            />
            {execution.finalBatch.allocations.map((allocation) => (
              <QualityReadOnlyValue
                key={allocation.jobOrderLineSizeId}
                label={`${allocation.sizeCode} · ${allocation.sizeLabel}`}
                value={String(allocation.quantity)}
              />
            ))}
          </QualityReadOnlyGrid>
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-foreground">Inspection attempts</p>
            <ol className="space-y-2" aria-label="Final batch inspection attempts">
              {execution.finalBatch.attempts.map((attempt) => (
                <li
                  key={attempt.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
                >
                  <span>Attempt {attempt.attemptNumber}</span>
                  <span className="font-medium">
                    {attempt.status === 'FINALIZED' ? attempt.outcome : titleCase(attempt.status)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {execution.finalBatch.release ? (
            <p className="mt-4 rounded-md bg-success-subtle p-3 text-sm text-success">
              {execution.finalBatch.release.quantity} units released downstream.
            </p>
          ) : null}
        </QualityExecutionSection>
      ) : null}
      {[...execution.sections]
        .sort((a, b) => a.sequence - b.sequence)
        .map((section) => (
          <QualityExecutionSection
            key={section.id}
            title={section.title}
            description={section.description}
            data-sequence={section.sequence}
          >
            <div className="space-y-4" data-quality-definition-components="true">
              {[...section.components]
                .sort((a, b) => a.sequence - b.sequence)
                .map((component) => {
                  const config = component.config;
                  return (
                    <QualityDefinitionComponent
                      key={component.id}
                      data-component-id={component.id}
                      data-component-type={component.type}
                      disabled={disabled}
                      readOnly={execution.status === 'FINALIZED'}
                      title={
                        component.type === 'PRODUCTION_PROGRESS'
                          ? 'Production context'
                          : component.title
                      }
                      description={component.description}
                      required={
                        (component.type === 'COMMENTS' && config.required === true) ||
                        component.type === 'INSPECTION_OUTCOME'
                      }
                    >
                      {component.type === 'SYSTEM_CONTEXT' && (
                        <div className="space-y-2">
                          <QualityReadOnlyGrid tiles>
                            {(component.systemValue ?? []).map((item) => {
                              const definition = rows(config.fields ?? config.metrics).find(
                                (row) => row.key === item.key,
                              );
                              return (
                                <QualityReadOnlyValue
                                  key={item.key}
                                  tile
                                  label={text(definition?.label ?? item.key)}
                                  value={item.available ? text(item.value) : 'Unavailable'}
                                />
                              );
                            })}
                          </QualityReadOnlyGrid>
                        </div>
                      )}
                      {component.type === 'PRODUCTION_PROGRESS' && (
                        <QualityProductionContext
                          context={execution.productionContext}
                          stageCodes={rows(config.metrics).flatMap((metric) =>
                            typeof metric.sourceActivityCode === 'string'
                              ? [metric.sourceActivityCode]
                              : [],
                          )}
                        />
                      )}
                      {component.type === 'FIELD_GROUP' &&
                        (execution.status === 'FINALIZED' ? (
                          <QualityReadOnlyGrid>
                            {rows(config.fields).map((field) => {
                              const fieldKey = text(field.key);
                              const systemValue = component.systemValue?.find(
                                (value) => value.key === fieldKey,
                              );
                              const current = draft.fieldResponses.find(
                                (value) =>
                                  value.componentId === component.id && value.fieldKey === fieldKey,
                              );
                              const value =
                                field.source === 'SYSTEM'
                                  ? systemValue?.available
                                    ? text(systemValue.value)
                                    : 'Unavailable'
                                  : (current?.value ?? '');
                              return (
                                <QualityReadOnlyValue
                                  key={fieldKey}
                                  label={text(field.label)}
                                  value={
                                    field.dataType === 'DATE'
                                      ? formatQualityDate(value)
                                      : field.dataType === 'BOOLEAN' && value
                                        ? value === 'true'
                                          ? 'Yes'
                                          : 'No'
                                        : value
                                  }
                                />
                              );
                            })}
                          </QualityReadOnlyGrid>
                        ) : (
                          <QualityFieldGrid>
                            {rows(config.fields).map((field) => {
                              const fieldKey = text(field.key);
                              const current = draft.fieldResponses.find(
                                (value) =>
                                  value.componentId === component.id && value.fieldKey === fieldKey,
                              );
                              const validation = fieldError(component.id, fieldKey);
                              const update = (value: string) => {
                                clearFieldError(
                                  component.id,
                                  fieldKey,
                                  undefined,
                                  Boolean(value.trim()),
                                );
                                set(
                                  'fieldResponses',
                                  value
                                    ? replace(
                                        draft.fieldResponses,
                                        (response) =>
                                          response.componentId === component.id &&
                                          response.fieldKey === fieldKey,
                                        { componentId: component.id, fieldKey, value },
                                      )
                                    : draft.fieldResponses.filter(
                                        (response) =>
                                          !(
                                            response.componentId === component.id &&
                                            response.fieldKey === fieldKey
                                          ),
                                      ),
                                );
                              };
                              if (field.source === 'SYSTEM') {
                                const systemValue = component.systemValue?.find(
                                  (value) => value.key === fieldKey,
                                );
                                return (
                                  <dl key={fieldKey}>
                                    <QualityReadOnlyValue
                                      key={fieldKey}
                                      label={text(field.label)}
                                      value={
                                        systemValue?.available
                                          ? text(systemValue.value)
                                          : 'Unavailable'
                                      }
                                    />
                                  </dl>
                                );
                              }
                              return field.dataType === 'DATE' ? (
                                <DatePicker
                                  key={fieldKey}
                                  id={controlId(component.id, fieldKey)}
                                  label={text(field.label)}
                                  required={field.required === true}
                                  error={validation?.message}
                                  width="full"
                                  value={current?.value || undefined}
                                  onValueChange={(value) => update(value ?? '')}
                                />
                              ) : field.dataType === 'BOOLEAN' ? (
                                <Checkbox
                                  key={fieldKey}
                                  id={controlId(component.id, fieldKey)}
                                  label={text(field.label)}
                                  required={field.required === true}
                                  error={validation?.message}
                                  checked={current?.value === 'true'}
                                  onCheckedChange={(checked) =>
                                    update(checked === true ? 'true' : 'false')
                                  }
                                />
                              ) : field.dataType === 'SELECT' ? (
                                <label key={fieldKey} className="space-y-1.5 text-sm font-medium">
                                  {text(field.label)}
                                  {field.required === true ? (
                                    <span className="ml-1 text-danger" aria-hidden="true">
                                      *
                                    </span>
                                  ) : null}
                                  <select
                                    id={controlId(component.id, fieldKey)}
                                    className={`${controlClass} ${validation ? errorClass : ''}`}
                                    required={field.required === true}
                                    aria-invalid={validation ? true : undefined}
                                    aria-describedby={
                                      validation
                                        ? `${controlId(component.id, fieldKey)}-error`
                                        : undefined
                                    }
                                    value={current?.value ?? ''}
                                    onChange={(event) => update(event.target.value)}
                                  >
                                    <option value="">Select</option>
                                    {(Array.isArray(field.options) ? field.options : []).map(
                                      (option) => (
                                        <option key={text(option)}>{text(option)}</option>
                                      ),
                                    )}
                                  </select>
                                  {validation ? (
                                    <span
                                      id={`${controlId(component.id, fieldKey)}-error`}
                                      role="alert"
                                      className="block text-xs text-danger"
                                    >
                                      {validation.message}
                                    </span>
                                  ) : null}
                                </label>
                              ) : (
                                <TextField
                                  key={fieldKey}
                                  id={controlId(component.id, fieldKey)}
                                  label={text(field.label)}
                                  type={field.dataType === 'NUMBER' ? 'number' : 'text'}
                                  required={field.required === true}
                                  errorMessage={validation?.message}
                                  width="full"
                                  value={current?.value ?? ''}
                                  onChange={(event) => update(event.target.value)}
                                />
                              );
                            })}
                          </QualityFieldGrid>
                        ))}
                      {component.type === 'ATTENDEE_LIST' &&
                        (execution.status === 'FINALIZED' ? (
                          <QualityReadOnlyGrid>
                            {(Array.isArray(config.roles) ? config.roles : []).map((role) => {
                              const roleConfig =
                                typeof role === 'string' ? null : (role as ConfigRow);
                              const roleKey =
                                typeof role === 'string' ? role : text(roleConfig?.key);
                              const roleLabel =
                                typeof role === 'string'
                                  ? role
                                  : text(roleConfig?.label ?? roleKey);
                              return (
                                <QualityReadOnlyValue
                                  key={roleKey}
                                  label={roleLabel}
                                  value={
                                    draft.attendees.find(
                                      (value) =>
                                        value.componentId === component.id &&
                                        value.roleKey === roleKey,
                                    )?.attendeeName
                                  }
                                />
                              );
                            })}
                          </QualityReadOnlyGrid>
                        ) : (
                          <QualityFieldGrid>
                            {(Array.isArray(config.roles) ? config.roles : []).map((role) => {
                              const roleConfig =
                                typeof role === 'string' ? null : (role as ConfigRow);
                              const roleKey =
                                typeof role === 'string' ? role : text(roleConfig?.key);
                              const roleLabel =
                                typeof role === 'string'
                                  ? role
                                  : text(roleConfig?.label ?? roleKey);
                              const current = draft.attendees.find(
                                (value) =>
                                  value.componentId === component.id && value.roleKey === roleKey,
                              );
                              const validation = fieldError(component.id, roleKey);
                              return (
                                <TextField
                                  key={roleKey}
                                  id={controlId(component.id, roleKey)}
                                  label={roleLabel}
                                  required={roleConfig?.required === true}
                                  errorMessage={validation?.message}
                                  placeholder="Attendee name"
                                  width="full"
                                  value={current?.attendeeName ?? ''}
                                  onChange={(event) => {
                                    clearFieldError(
                                      component.id,
                                      roleKey,
                                      undefined,
                                      Boolean(event.target.value.trim()),
                                    );
                                    set(
                                      'attendees',
                                      event.target.value
                                        ? replace(
                                            draft.attendees,
                                            (value) =>
                                              value.componentId === component.id &&
                                              value.roleKey === roleKey,
                                            {
                                              componentId: component.id,
                                              roleKey,
                                              attendeeName: event.target.value,
                                            },
                                          )
                                        : draft.attendees.filter(
                                            (value) =>
                                              !(
                                                value.componentId === component.id &&
                                                value.roleKey === roleKey
                                              ),
                                          ),
                                    );
                                  }}
                                />
                              );
                            })}
                          </QualityFieldGrid>
                        ))}
                      {component.type === 'ACTION_LIST' && (
                        <QualityRepeatingList>
                          {!draft.actions.some((action) => action.componentId === component.id) ? (
                            <p className="text-sm text-muted-foreground">
                              No follow-up actions added.
                            </p>
                          ) : null}
                          {execution.status === 'DRAFT' ? (
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="secondary"
                                density="compact"
                                onClick={() => {
                                  setActionRowKeys((current) => [...current, nextRowKey()]);
                                  set('actions', [
                                    ...draft.actions,
                                    { componentId: component.id, values: {} },
                                  ]);
                                }}
                              >
                                Add follow-up
                              </Button>
                            </div>
                          ) : null}
                          {draft.actions.map((action, index) => {
                            if (action.componentId !== component.id) return null;
                            const rowIndex = draft.actions
                              .slice(0, index)
                              .filter((candidate) => candidate.componentId === component.id).length;
                            return (
                              <QualityRepeatingRow key={actionRowKeys[index]}>
                                {execution.status === 'FINALIZED' ? (
                                  <QualityReadOnlyGrid>
                                    {rows(config.columns).map((column) => {
                                      const columnKey = text(column.key);
                                      const value = text(action.values[columnKey]);
                                      return (
                                        <QualityReadOnlyValue
                                          key={columnKey}
                                          label={text(column.label)}
                                          value={
                                            column.dataType === 'DATE'
                                              ? formatQualityDate(value)
                                              : value
                                          }
                                        />
                                      );
                                    })}
                                  </QualityReadOnlyGrid>
                                ) : (
                                  <QualityFieldGrid>
                                    {rows(config.columns).map((column) => {
                                      const columnKey = text(column.key);
                                      const validation = fieldError(
                                        component.id,
                                        columnKey,
                                        rowIndex,
                                      );
                                      const update = (value: string) => {
                                        clearFieldError(
                                          component.id,
                                          columnKey,
                                          rowIndex,
                                          Boolean(value.toString().trim()),
                                        );
                                        const next = [...draft.actions];
                                        next[index] = {
                                          ...action,
                                          values: {
                                            ...action.values,
                                            [columnKey]: value,
                                          },
                                        };
                                        set('actions', next);
                                      };
                                      return column.dataType === 'DATE' ? (
                                        <DatePicker
                                          key={columnKey}
                                          id={controlId(component.id, columnKey, rowIndex)}
                                          label={text(column.label)}
                                          required={column.required === true}
                                          error={validation?.message}
                                          width="full"
                                          value={text(action.values[columnKey]) || undefined}
                                          onValueChange={(value) => update(value ?? '')}
                                        />
                                      ) : column.dataType === 'SELECT' ? (
                                        <label
                                          key={columnKey}
                                          className="space-y-1.5 text-sm font-medium"
                                        >
                                          {text(column.label)}
                                          {column.required === true ? (
                                            <span className="ml-1 text-danger" aria-hidden="true">
                                              *
                                            </span>
                                          ) : null}
                                          <select
                                            id={controlId(component.id, columnKey, rowIndex)}
                                            className={`${controlClass} ${validation ? errorClass : ''}`}
                                            required={column.required === true}
                                            aria-invalid={validation ? true : undefined}
                                            aria-describedby={
                                              validation
                                                ? `${controlId(component.id, columnKey, rowIndex)}-error`
                                                : undefined
                                            }
                                            value={text(action.values[columnKey])}
                                            onChange={(event) => update(event.target.value)}
                                          >
                                            <option value="">Select</option>
                                            {(Array.isArray(column.options)
                                              ? column.options
                                              : []
                                            ).map((option) => (
                                              <option key={text(option)}>{text(option)}</option>
                                            ))}
                                          </select>
                                          {validation ? (
                                            <span
                                              id={`${controlId(component.id, columnKey, rowIndex)}-error`}
                                              role="alert"
                                              className="block text-xs text-danger"
                                            >
                                              {validation.message}
                                            </span>
                                          ) : null}
                                        </label>
                                      ) : (
                                        <TextField
                                          key={columnKey}
                                          id={controlId(component.id, columnKey, rowIndex)}
                                          label={text(column.label)}
                                          required={column.required === true}
                                          errorMessage={validation?.message}
                                          type={column.dataType === 'NUMBER' ? 'number' : 'text'}
                                          width="full"
                                          value={text(action.values[columnKey])}
                                          onChange={(event) => update(event.target.value)}
                                        />
                                      );
                                    })}
                                  </QualityFieldGrid>
                                )}
                                {execution.status === 'DRAFT' ? (
                                  <div className="mt-3 flex justify-end">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      density="compact"
                                      aria-label={`Remove follow-up item ${rowIndex + 1}`}
                                      onClick={() => {
                                        setVisibleErrors((current) =>
                                          current.filter(
                                            (item) => item.componentId !== component.id,
                                          ),
                                        );
                                        setActionRowKeys((current) =>
                                          current.filter((_, rowIndex) => rowIndex !== index),
                                        );
                                        set(
                                          'actions',
                                          draft.actions.filter(
                                            (_, actionIndex) => actionIndex !== index,
                                          ),
                                        );
                                      }}
                                    >
                                      Remove item
                                    </Button>
                                  </div>
                                ) : null}
                              </QualityRepeatingRow>
                            );
                          })}
                        </QualityRepeatingList>
                      )}
                      {component.type === 'CHECKLIST' && (
                        <QualityChecklist>
                          {rows(config.items).map((item) => {
                            const itemKey = text(item.key);
                            const current = draft.checklistResponses.find(
                              (value) =>
                                value.componentId === component.id && value.itemKey === itemKey,
                            );
                            const validation = fieldError(component.id, itemKey);
                            const label = text(item.label);
                            const choices = (config.responseOptions as string[]).map((option) => ({
                              value: option,
                              label: option,
                            }));
                            return (
                              <QualityChecklistRow
                                key={itemKey}
                                label={label}
                                required
                                control={
                                  execution.status === 'FINALIZED' ? (
                                    <QualityChecklistResult
                                      label={label}
                                      choices={choices}
                                      value={current?.response ?? ''}
                                    />
                                  ) : (
                                    <QualityChoiceGroup
                                      id={controlId(component.id, itemKey)}
                                      label={label}
                                      choices={choices}
                                      disabled={disabled}
                                      required
                                      value={current?.response ?? ''}
                                      error={validation?.message}
                                      onChange={(value) => {
                                        clearFieldError(
                                          component.id,
                                          itemKey,
                                          undefined,
                                          Boolean(value),
                                        );
                                        set(
                                          'checklistResponses',
                                          replace(
                                            draft.checklistResponses,
                                            (value) =>
                                              value.componentId === component.id &&
                                              value.itemKey === itemKey,
                                            {
                                              componentId: component.id,
                                              itemKey,
                                              response: value,
                                            },
                                          ),
                                        );
                                      }}
                                    />
                                  )
                                }
                              />
                            );
                          })}
                        </QualityChecklist>
                      )}
                      {component.type === 'AQL_RESULT' &&
                        rows(config.criteria).map((criterion) => {
                          const severity = text(criterion.severity) as
                            'CRITICAL' | 'MAJOR' | 'MINOR';
                          const current = draft.aqlResults.find(
                            (value) =>
                              value.componentId === component.id && value.severity === severity,
                          );
                          const maxError = fieldError(component.id, `${severity}.maxAllowed`);
                          const foundError = fieldError(component.id, `${severity}.found`);
                          const update = (part: {
                            maxAllowed?: number | null;
                            found?: number | null;
                          }) =>
                            set(
                              'aqlResults',
                              replace(
                                draft.aqlResults,
                                (value) =>
                                  value.componentId === component.id && value.severity === severity,
                                {
                                  componentId: component.id,
                                  severity,
                                  maxAllowed: current?.maxAllowed,
                                  found: current?.found,
                                  ...part,
                                },
                              ),
                            );
                          return (
                            <QualityRepeatingRow key={severity} className="mb-2 last:mb-0">
                              {execution.status === 'FINALIZED' ? (
                                <QualityReadOnlyGrid>
                                  <QualityReadOnlyValue
                                    label="Classification"
                                    value={`${titleCase(severity)} · AQL ${text(criterion.aql)}`}
                                  />
                                  <QualityReadOnlyValue
                                    label="Maximum allowed"
                                    value={current?.maxAllowed}
                                  />
                                  <QualityReadOnlyValue label="Found" value={current?.found} />
                                </QualityReadOnlyGrid>
                              ) : (
                                <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]">
                                  <div className="pb-2 text-sm font-semibold text-foreground">
                                    {titleCase(severity)}
                                    <span className="ml-2 font-normal text-muted-foreground">
                                      AQL {text(criterion.aql)}
                                    </span>
                                  </div>
                                  <TextField
                                    id={controlId(component.id, `${severity}.maxAllowed`)}
                                    label="Maximum allowed"
                                    type="number"
                                    required
                                    errorMessage={maxError?.message}
                                    width="full"
                                    min="0"
                                    value={current?.maxAllowed ?? ''}
                                    onChange={(event) => {
                                      clearFieldError(
                                        component.id,
                                        `${severity}.maxAllowed`,
                                        undefined,
                                        Boolean(event.target.value),
                                      );
                                      update({
                                        maxAllowed: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      });
                                    }}
                                  />
                                  <TextField
                                    id={controlId(component.id, `${severity}.found`)}
                                    label="Found"
                                    type="number"
                                    required
                                    errorMessage={foundError?.message}
                                    width="full"
                                    min="0"
                                    value={current?.found ?? ''}
                                    onChange={(event) => {
                                      clearFieldError(
                                        component.id,
                                        `${severity}.found`,
                                        undefined,
                                        Boolean(event.target.value),
                                      );
                                      update({
                                        found: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      });
                                    }}
                                  />
                                </div>
                              )}
                            </QualityRepeatingRow>
                          );
                        })}
                      {component.type === 'DEFECT_LIST' && (
                        <QualityRepeatingList data-quality-defect-list="true">
                          {!draft.defects.some((defect) => defect.componentId === component.id) ? (
                            <p className="text-sm text-muted-foreground">No defects recorded.</p>
                          ) : null}
                          {execution.status === 'DRAFT' ? (
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="secondary"
                                density="compact"
                                onClick={() =>
                                  set('defects', [
                                    ...draft.defects,
                                    {
                                      componentId: component.id,
                                      description: '',
                                      severity: (
                                        config.severities as Array<'CRITICAL' | 'MAJOR' | 'MINOR'>
                                      )[0]!,
                                      ...(config.captureQuantity === true ? { quantity: 0 } : {}),
                                    },
                                  ])
                                }
                              >
                                Add defect
                              </Button>
                            </div>
                          ) : null}
                          {draft.defects.map(
                            (defect, index) =>
                              defect.componentId === component.id && (
                                <QualityRepeatingRow key={index}>
                                  {execution.status === 'FINALIZED' ? (
                                    <QualityReadOnlyGrid>
                                      <QualityReadOnlyValue
                                        className="sm:col-span-2"
                                        label="Defect description"
                                        value={defect.description}
                                      />
                                      <QualityReadOnlyValue
                                        label="Severity"
                                        value={titleCase(defect.severity)}
                                      />
                                      {config.captureQuantity === true ? (
                                        <QualityReadOnlyValue
                                          label="Quantity"
                                          value={defect.quantity}
                                        />
                                      ) : null}
                                    </QualityReadOnlyGrid>
                                  ) : (
                                    <>
                                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_minmax(7rem,0.6fr)]">
                                        <TextField
                                          label="Defect description"
                                          aria-label="Defect description"
                                          width="full"
                                          value={defect.description}
                                          onChange={(event) => {
                                            const next = [...draft.defects];
                                            next[index] = {
                                              ...defect,
                                              description: event.target.value,
                                            };
                                            set('defects', next);
                                          }}
                                        />
                                        <label className="space-y-1.5 text-sm font-medium">
                                          Severity
                                          <select
                                            aria-label="Defect severity"
                                            className={controlClass}
                                            value={defect.severity}
                                            onChange={(event) => {
                                              const next = [...draft.defects];
                                              next[index] = {
                                                ...defect,
                                                severity: event.target
                                                  .value as typeof defect.severity,
                                              };
                                              set('defects', next);
                                            }}
                                          >
                                            {(config.severities as string[]).map((option) => (
                                              <option key={option} value={option}>
                                                {titleCase(option)}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                        {config.captureQuantity === true ? (
                                          <TextField
                                            label="Quantity"
                                            aria-label="Defect quantity"
                                            type="number"
                                            min="0"
                                            width="full"
                                            value={defect.quantity ?? ''}
                                            onChange={(event) => {
                                              const next = [...draft.defects];
                                              next[index] = {
                                                ...defect,
                                                quantity: event.target.value
                                                  ? Number(event.target.value)
                                                  : null,
                                              };
                                              set('defects', next);
                                            }}
                                          />
                                        ) : null}
                                      </div>
                                      <div className="mt-2 flex justify-end">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          density="compact"
                                          aria-label={`Remove defect ${index + 1}`}
                                          onClick={() =>
                                            set(
                                              'defects',
                                              draft.defects.filter(
                                                (_, defectIndex) => defectIndex !== index,
                                              ),
                                            )
                                          }
                                        >
                                          Remove defect
                                        </Button>
                                      </div>
                                    </>
                                  )}
                                </QualityRepeatingRow>
                              ),
                          )}
                        </QualityRepeatingList>
                      )}
                      {component.type === 'CORRECTIVE_ACTIONS' && (
                        <QualityRepeatingList data-quality-corrective-actions="true">
                          {!draft.correctiveActions.some(
                            (action) => action.componentId === component.id,
                          ) ? (
                            <p className="text-sm text-muted-foreground">
                              No corrective actions added.
                            </p>
                          ) : null}
                          {execution.status === 'DRAFT' ? (
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="secondary"
                                density="compact"
                                onClick={() =>
                                  set('correctiveActions', [
                                    ...draft.correctiveActions,
                                    { componentId: component.id, values: {} },
                                  ])
                                }
                              >
                                Add corrective action
                              </Button>
                            </div>
                          ) : null}
                          {draft.correctiveActions.map((action, index) => {
                            if (action.componentId !== component.id) return null;
                            const rowIndex = draft.correctiveActions
                              .slice(0, index)
                              .filter((candidate) => candidate.componentId === component.id).length;
                            return (
                              <QualityRepeatingRow key={index}>
                                {execution.status === 'FINALIZED' ? (
                                  <QualityReadOnlyGrid>
                                    {rows(config.columns).map((column) => (
                                      <QualityReadOnlyValue
                                        key={text(column.key)}
                                        label={text(column.label)}
                                        value={text(action.values[text(column.key)])}
                                      />
                                    ))}
                                  </QualityReadOnlyGrid>
                                ) : (
                                  <QualityFieldGrid>
                                    {rows(config.columns).map((column) => {
                                      const columnKey = text(column.key);
                                      const validation = fieldError(
                                        component.id,
                                        columnKey,
                                        rowIndex,
                                      );
                                      return (
                                        <TextField
                                          key={columnKey}
                                          id={controlId(component.id, columnKey, rowIndex)}
                                          label={text(column.label)}
                                          required={column.required === true}
                                          errorMessage={validation?.message}
                                          width="full"
                                          value={text(action.values[columnKey])}
                                          onChange={(event) => {
                                            clearFieldError(
                                              component.id,
                                              columnKey,
                                              rowIndex,
                                              Boolean(event.target.value.trim()),
                                            );
                                            const next = [...draft.correctiveActions];
                                            next[index] = {
                                              ...action,
                                              values: {
                                                ...action.values,
                                                [columnKey]: event.target.value,
                                              },
                                            };
                                            set('correctiveActions', next);
                                          }}
                                        />
                                      );
                                    })}
                                  </QualityFieldGrid>
                                )}
                                {execution.status === 'DRAFT' ? (
                                  <div className="mt-2 flex justify-end">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      density="compact"
                                      aria-label={`Remove corrective action ${rowIndex + 1}`}
                                      onClick={() =>
                                        set(
                                          'correctiveActions',
                                          draft.correctiveActions.filter(
                                            (_, actionIndex) => actionIndex !== index,
                                          ),
                                        )
                                      }
                                    >
                                      Remove action
                                    </Button>
                                  </div>
                                ) : null}
                              </QualityRepeatingRow>
                            );
                          })}
                        </QualityRepeatingList>
                      )}
                      {component.type === 'TEST_RESULTS' && (
                        <QualityChecklist resultHeading="Test result">
                          {rows(config.tests).map((test) => {
                            const testKey = text(test.key);
                            const current = draft.testResults.find(
                              (value) =>
                                value.componentId === component.id && value.testKey === testKey,
                            );
                            const validation = fieldError(component.id, testKey);
                            const label = text(test.label);
                            const choices = (test.responseOptions as string[]).map((option) => ({
                              value: option,
                              label: option,
                            }));
                            return (
                              <QualityChecklistRow
                                key={testKey}
                                label={label}
                                required
                                control={
                                  execution.status === 'FINALIZED' ? (
                                    <QualityChecklistResult
                                      label={label}
                                      choices={choices}
                                      value={current?.response ?? ''}
                                    />
                                  ) : (
                                    <QualityChoiceGroup
                                      id={controlId(component.id, testKey)}
                                      label={label}
                                      choices={choices}
                                      value={current?.response ?? ''}
                                      required
                                      disabled={disabled}
                                      error={validation?.message}
                                      onChange={(response) => {
                                        clearFieldError(
                                          component.id,
                                          testKey,
                                          undefined,
                                          Boolean(response),
                                        );
                                        set(
                                          'testResults',
                                          replace(
                                            draft.testResults,
                                            (value) =>
                                              value.componentId === component.id &&
                                              value.testKey === testKey,
                                            { componentId: component.id, testKey, response },
                                          ),
                                        );
                                      }}
                                    />
                                  )
                                }
                              />
                            );
                          })}
                        </QualityChecklist>
                      )}
                      {component.type === 'QUANTITY_RECONCILIATION' && (
                        <div className="space-y-4" data-quality-quantity-reconciliation="true">
                          {execution.status === 'FINALIZED' ? (
                            <QualityReadOnlyGrid columns={2} className="lg:grid-cols-4">
                              {rows(config.fields).map((field) => {
                                const fieldKey = text(field.key);
                                const systemValue = component.systemValue?.find(
                                  (value) => value.key === fieldKey,
                                );
                                const response = draft.quantities.find(
                                  (value) =>
                                    value.componentId === component.id &&
                                    value.fieldKey === fieldKey,
                                );
                                return (
                                  <QualityReadOnlyValue
                                    key={fieldKey}
                                    label={text(field.label)}
                                    value={
                                      field.source === 'SYSTEM'
                                        ? systemValue?.available
                                          ? text(systemValue.value)
                                          : 'Unavailable'
                                        : response?.value
                                    }
                                  />
                                );
                              })}
                            </QualityReadOnlyGrid>
                          ) : (
                            <QualityFieldGrid columns={2} className="lg:grid-cols-4">
                              {rows(config.fields).map((field) => {
                                const fieldKey = text(field.key);
                                const systemValue = component.systemValue?.find(
                                  (value) => value.key === fieldKey,
                                );
                                if (field.source === 'SYSTEM')
                                  return (
                                    <QualityReadOnlyValue
                                      key={fieldKey}
                                      label={text(field.label)}
                                      value={
                                        systemValue?.available
                                          ? text(systemValue.value)
                                          : 'Unavailable'
                                      }
                                      tile
                                    />
                                  );
                                const validation = fieldError(component.id, fieldKey);
                                return (
                                  <TextField
                                    key={fieldKey}
                                    id={controlId(component.id, fieldKey)}
                                    label={text(field.label)}
                                    type="number"
                                    min="0"
                                    required={field.required === true}
                                    errorMessage={validation?.message}
                                    width="full"
                                    value={
                                      draft.quantities.find(
                                        (value) =>
                                          value.componentId === component.id &&
                                          value.fieldKey === fieldKey,
                                      )?.value ?? ''
                                    }
                                    onChange={(event) => {
                                      clearFieldError(
                                        component.id,
                                        fieldKey,
                                        undefined,
                                        Boolean(event.target.value),
                                      );
                                      set(
                                        'quantities',
                                        event.target.value
                                          ? replace(
                                              draft.quantities,
                                              (value) =>
                                                value.componentId === component.id &&
                                                value.fieldKey === fieldKey,
                                              {
                                                componentId: component.id,
                                                fieldKey,
                                                value: Number(event.target.value),
                                              },
                                            )
                                          : draft.quantities.filter(
                                              (value) =>
                                                !(
                                                  value.componentId === component.id &&
                                                  value.fieldKey === fieldKey
                                                ),
                                            ),
                                      );
                                    }}
                                  />
                                );
                              })}
                            </QualityFieldGrid>
                          )}
                          {execution.coverage ? (
                            <div className="space-y-3 border-t border-border-subtle pt-4">
                              <QualityReadOnlyGrid columns={2} className="lg:grid-cols-4">
                                <QualityReadOnlyValue
                                  label="Prepared quantity"
                                  value={
                                    execution.coverage.preparedQuantityAuthoritative
                                      ? execution.coverage.preparedQuantity
                                      : 'Unavailable'
                                  }
                                />
                                <QualityReadOnlyValue
                                  label="Previously inspected"
                                  value={priorInspectedQuantity}
                                />
                                <QualityReadOnlyValue
                                  label="This inspection"
                                  value={execution.inspectedQuantity}
                                />
                                <QualityReadOnlyValue
                                  label="Remaining after this batch"
                                  value={remainingAfterCurrentBatch ?? 'Pending prepared quantity'}
                                />
                              </QualityReadOnlyGrid>
                              <div
                                role="status"
                                data-reconciliation-state={
                                  !execution.coverage.preparedQuantityAuthoritative
                                    ? 'UNKNOWN'
                                    : currentBatchConflict
                                      ? 'CONFLICT'
                                      : remainingAfterCurrentBatch === 0
                                        ? 'COMPLETE'
                                        : 'IN_PROGRESS'
                                }
                                className="rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-sm"
                              >
                                {!execution.coverage.preparedQuantityAuthoritative ? (
                                  <>
                                    <p className="font-semibold text-foreground">
                                      Prepared quantity unavailable
                                    </p>
                                    <p className="mt-1 text-muted-foreground">
                                      This draft can be saved, but prepared quantity reconciliation
                                      is required before finalization.
                                    </p>
                                  </>
                                ) : currentBatchConflict ? (
                                  <>
                                    <p className="font-semibold text-danger">Quantity conflict</p>
                                    <p className="mt-1 text-muted-foreground">
                                      This inspection would exceed the prepared quantity.
                                    </p>
                                  </>
                                ) : remainingAfterCurrentBatch === 0 ? (
                                  <>
                                    <p className="font-semibold text-success">✓ Reconciled</p>
                                    <p className="mt-1 text-muted-foreground">
                                      All {execution.coverage.preparedQuantity} prepared units are
                                      covered through this batch.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-semibold text-foreground">
                                      Inspection remaining
                                    </p>
                                    <p className="mt-1 text-muted-foreground">
                                      {remainingAfterCurrentBatch} units remain after this batch.
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {component.type === 'COMMENTS' &&
                        (execution.status === 'FINALIZED' ? (
                          <p
                            data-quality-read-only-value="true"
                            className="min-h-8 whitespace-pre-wrap break-words text-sm text-foreground"
                          >
                            {draft.comments.find((value) => value.componentId === component.id)
                              ?.value || '\u2014'}
                          </p>
                        ) : (
                          <div>
                            {config.required === true ? (
                              <span className="sr-only">Required</span>
                            ) : null}
                            <textarea
                              id={controlId(component.id, 'value')}
                              aria-label={component.title}
                              aria-invalid={fieldError(component.id, 'value') ? true : undefined}
                              aria-describedby={
                                fieldError(component.id, 'value')
                                  ? `${controlId(component.id, 'value')}-error`
                                  : undefined
                              }
                              className={`${textAreaClass} ${fieldError(component.id, 'value') ? errorClass : ''}`}
                              placeholder={text(config.placeholder) || undefined}
                              maxLength={
                                typeof config.maxLength === 'number' ? config.maxLength : undefined
                              }
                              required={config.required === true}
                              value={
                                draft.comments.find((value) => value.componentId === component.id)
                                  ?.value ?? ''
                              }
                              onChange={(event) => {
                                clearFieldError(
                                  component.id,
                                  'value',
                                  undefined,
                                  Boolean(event.target.value.trim()),
                                );
                                set(
                                  'comments',
                                  replace(
                                    draft.comments,
                                    (value) => value.componentId === component.id,
                                    {
                                      componentId: component.id,
                                      value: event.target.value,
                                    },
                                  ),
                                );
                              }}
                            />
                            {fieldError(component.id, 'value') ? (
                              <p
                                id={`${controlId(component.id, 'value')}-error`}
                                role="alert"
                                className="mt-1 text-xs text-danger"
                              >
                                {fieldError(component.id, 'value')?.message}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      {component.type === 'SIGNATURES' &&
                        (execution.status === 'FINALIZED' ? (
                          <QualityReadOnlyGrid>
                            {rows(config.roles).map((role) => (
                              <QualityReadOnlyValue
                                key={text(role.key)}
                                label={text(role.label)}
                                value={
                                  draft.signoffs.find(
                                    (value) =>
                                      value.componentId === component.id &&
                                      value.roleKey === role.key,
                                  )?.signatoryName
                                }
                              />
                            ))}
                          </QualityReadOnlyGrid>
                        ) : (
                          <QualityFieldGrid>
                            {rows(config.roles).map((role) => (
                              <TextField
                                key={text(role.key)}
                                id={controlId(component.id, text(role.key))}
                                label={text(role.label)}
                                placeholder="Signatory name"
                                required={role.required === true}
                                errorMessage={fieldError(component.id, text(role.key))?.message}
                                width="full"
                                value={
                                  draft.signoffs.find(
                                    (value) =>
                                      value.componentId === component.id &&
                                      value.roleKey === role.key,
                                  )?.signatoryName ?? ''
                                }
                                onChange={(event) => {
                                  clearFieldError(
                                    component.id,
                                    text(role.key),
                                    undefined,
                                    Boolean(event.target.value.trim()),
                                  );
                                  set(
                                    'signoffs',
                                    event.target.value
                                      ? replace(
                                          draft.signoffs,
                                          (value) =>
                                            value.componentId === component.id &&
                                            value.roleKey === role.key,
                                          {
                                            componentId: component.id,
                                            roleKey: text(role.key),
                                            signatoryName: event.target.value,
                                          },
                                        )
                                      : draft.signoffs.filter(
                                          (value) =>
                                            !(
                                              value.componentId === component.id &&
                                              value.roleKey === role.key
                                            ),
                                        ),
                                  );
                                }}
                              />
                            ))}
                          </QualityFieldGrid>
                        ))}
                      {component.type === 'INSPECTION_OUTCOME' && (
                        <div data-quality-inspection-outcome="true" className="w-full min-w-0">
                          {execution.status === 'FINALIZED' ? (
                            <div className="space-y-3">
                              <QualityChecklistResult
                                label={component.title}
                                value={draft.outcome?.value ?? ''}
                                choices={(config.allowedOutcomes as string[]).map((outcome) => ({
                                  value: outcome,
                                  label: outcome,
                                }))}
                              />
                              <QualityReadOnlyValue
                                label="Outcome remarks"
                                value={draft.outcome?.remarks}
                              />
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="max-w-md">
                                <QualityChoiceGroup
                                  id={controlId(component.id, 'value')}
                                  label={component.title}
                                  choices={(config.allowedOutcomes as string[]).map((outcome) => ({
                                    value: outcome,
                                    label: outcome,
                                  }))}
                                  value={draft.outcome?.value ?? ''}
                                  required
                                  disabled={disabled}
                                  error={fieldError(component.id, 'value')?.message}
                                  onChange={(outcome) => {
                                    clearFieldError(component.id, 'value');
                                    set('outcome', {
                                      componentId: component.id,
                                      value: outcome as 'PASS' | 'FAIL',
                                      remarks: draft.outcome?.remarks,
                                    });
                                  }}
                                />
                              </div>
                              <label className="block space-y-1.5 text-sm font-medium">
                                Outcome remarks
                                <textarea
                                  id={controlId(component.id, 'remarks')}
                                  aria-invalid={
                                    fieldError(component.id, 'remarks') ? true : undefined
                                  }
                                  aria-describedby={
                                    fieldError(component.id, 'remarks')
                                      ? `${controlId(component.id, 'remarks')}-error`
                                      : undefined
                                  }
                                  className={`${textAreaClass} ${fieldError(component.id, 'remarks') ? errorClass : ''}`}
                                  value={draft.outcome?.remarks ?? ''}
                                  onChange={(event) => {
                                    clearFieldError(
                                      component.id,
                                      'remarks',
                                      undefined,
                                      Boolean(event.target.value.trim()),
                                    );
                                    if (draft.outcome)
                                      set('outcome', {
                                        ...draft.outcome,
                                        remarks: event.target.value,
                                      });
                                  }}
                                />
                              </label>
                              {fieldError(component.id, 'remarks') ? (
                                <p
                                  id={`${controlId(component.id, 'remarks')}-error`}
                                  role="alert"
                                  className="text-xs text-danger"
                                >
                                  {fieldError(component.id, 'remarks')?.message}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                      {component.type === 'ATTACHMENTS' &&
                        rows(config.requirements).map((requirement) => {
                          const requirementKey = text(requirement.key);
                          const requirementLabel = text(requirement.label);
                          const requirementAttachments = execution.attachments.filter(
                            (item) =>
                              item.componentId === component.id &&
                              item.requirementKey === requirement.key,
                          );
                          const required =
                            requirement.required === true ||
                            requirement.requiredWhen === 'ALWAYS' ||
                            (requirement.requiredWhen === 'INSPECTION_FAILED' &&
                              draft.outcome?.value === 'FAIL');
                          const validation = fieldError(component.id, requirementKey);
                          return (
                            <div
                              key={requirementKey}
                              data-quality-evidence-requirement="true"
                              className="space-y-2 rounded-md border border-border-subtle bg-surface-muted p-3"
                            >
                              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                                <p className="min-w-0 text-sm font-semibold text-foreground">
                                  {requirementLabel}
                                  {required ? (
                                    <span className="ml-1 text-danger" aria-hidden="true">
                                      *
                                    </span>
                                  ) : null}
                                </p>
                                {execution.status === 'DRAFT' && props.onUpload ? (
                                  <label className="relative cursor-pointer">
                                    <input
                                      id={controlId(component.id, requirementKey)}
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      required={required && requirementAttachments.length === 0}
                                      aria-label={`Select ${requirementLabel}`}
                                      aria-invalid={validation ? true : undefined}
                                      aria-describedby={
                                        validation
                                          ? `${controlId(component.id, requirementKey)}-error`
                                          : undefined
                                      }
                                      className="peer sr-only"
                                      onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) {
                                          clearFieldError(component.id, requirementKey);
                                          void props.onUpload?.(component.id, requirementKey, file);
                                        }
                                      }}
                                    />
                                    <span className="inline-flex min-h-10 items-center rounded-control border border-border bg-surface-raised px-3 text-sm font-semibold text-foreground transition hover:bg-surface peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--erp-focus-ring)]">
                                      {requirementAttachments.length > 0
                                        ? 'Add more evidence'
                                        : 'Select evidence'}
                                    </span>
                                  </label>
                                ) : null}
                              </div>
                              {validation ? (
                                <p
                                  id={`${controlId(component.id, requirementKey)}-error`}
                                  role="alert"
                                  className="text-xs text-danger"
                                >
                                  {validation.message}
                                </p>
                              ) : null}
                              {requirementAttachments.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No evidence uploaded.
                                </p>
                              ) : (
                                <ul className="space-y-2" aria-label={`${requirementLabel} files`}>
                                  {requirementAttachments.map((item) => (
                                    <li
                                      key={item.id}
                                      className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">
                                          {item.fileName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          Uploaded · {formatFileSize(item.sizeBytes)}
                                        </p>
                                      </div>
                                      {execution.status === 'DRAFT' && props.onRemoveAttachment ? (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          density="compact"
                                          aria-label={`Remove ${item.fileName}`}
                                          onClick={() => void props.onRemoveAttachment?.(item.id)}
                                        >
                                          Remove
                                        </Button>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                    </QualityDefinitionComponent>
                  );
                })}
            </div>
          </QualityExecutionSection>
        ))}
      {visibleErrors.length > 0 ? (
        <div
          role="alert"
          aria-labelledby="quality-validation-title"
          className="rounded-md border border-danger bg-danger-subtle p-3 text-sm text-danger"
        >
          <p id="quality-validation-title" className="font-semibold">
            Please complete the required fields:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {visibleErrors.map((item) => (
              <li key={`${item.componentId}:${item.rowIndex ?? ''}:${item.fieldKey}`}>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => focusError(item)}
                >
                  {item.sectionTitle} → {item.componentTitle}
                  {item.rowIndex === undefined ? '' : ` ${item.rowIndex + 1}`} → {item.fieldLabel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : error ? (
        <p role="alert" className="rounded-md bg-danger-subtle p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {execution.status === 'DRAFT' && (
        <div className="space-y-3">
          {execution.finalBatch && props.onCancelBatch ? (
            <TextField
              label="Cancellation reason"
              value={batchReason}
              width="full"
              onChange={(event) => setBatchReason(event.target.value)}
            />
          ) : null}
          <QualityExecutionActions>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void props.onSave({ ...draft, expectedVersion: execution.version })}
            >
              Save draft
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={busy}
              onClick={() =>
                void props.onFinalize({ ...draft, expectedVersion: execution.version })
              }
            >
              Finalize
            </Button>
            {execution.finalBatch && props.onCancelBatch ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !batchReason.trim()}
                onClick={() => void props.onCancelBatch?.(batchReason.trim())}
              >
                Cancel unused batch
              </Button>
            ) : null}
          </QualityExecutionActions>
        </div>
      )}
      {execution.status === 'FINALIZED' &&
      execution.finalBatch?.disposition === 'AWAITING_REINSPECTION' ? (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted p-4">
          <p className="text-sm text-muted-foreground">
            This physical batch released no quantity. Start another inspection attempt, or close it
            as permanently rejected.
          </p>
          <TextField
            label="Permanent rejection reason"
            value={batchReason}
            width="full"
            onChange={(event) => setBatchReason(event.target.value)}
          />
          <QualityExecutionActions>
            <Button
              type="button"
              variant="default"
              disabled={busy}
              onClick={() => void props.onStartReinspection?.()}
            >
              Start reinspection
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !batchReason.trim()}
              onClick={() => void props.onPermanentlyReject?.(batchReason.trim())}
            >
              Mark permanently rejected
            </Button>
          </QualityExecutionActions>
        </div>
      ) : null}
    </form>
  );
}
