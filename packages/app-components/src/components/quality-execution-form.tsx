import { useEffect, useState } from 'react';
import { Button, Checkbox, DatePicker, TextField } from '@erve/primitives';
import type {
  QualityExecutionPayload,
  QualityExecutionValidationError,
  QualityExecutionView,
} from '@erve/types';
import { displayActivityName } from '../job-order-operational-presentation.js';

type ConfigRow = Record<string, unknown>;
const rows = (value: unknown): ConfigRow[] => (Array.isArray(value) ? (value as ConfigRow[]) : []);
const text = (value: unknown) => String(value ?? '');
const replace = <T,>(values: T[], match: (value: T) => boolean, next: T) => [
  ...values.filter((value) => !match(value)),
  next,
];
const controlClass =
  'h-control w-full rounded-control border border-[var(--erp-form-field-border)] bg-surface-raised px-[var(--erp-control-padding-x)] text-control text-foreground outline-hidden focus:border-[var(--erp-form-field-focus-border)] focus:ring-[length:var(--erp-focus-ring-width)] focus:ring-[var(--erp-focus-ring)] disabled:opacity-[var(--erp-disabled-opacity)]';
const textAreaClass = `${controlClass} min-h-24 py-2`;
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
  const disabled = execution.status === 'FINALIZED' || busy;

  return (
    <form className="mx-auto max-w-[90rem] space-y-5" onSubmit={(event) => event.preventDefault()}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">
          {displayActivityName(execution.activityName)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {execution.qualityForm.name} v{execution.qualityForm.versionNumber} · Attempt{' '}
          {execution.attemptNumber} · {execution.status}
        </p>
        {execution.coverage && (
          <p aria-label="Final inspection coverage">
            Prepared:{' '}
            {execution.coverage.preparedQuantityAuthoritative
              ? execution.coverage.preparedQuantity
              : 'Not yet recorded'}{' '}
            · Inspected: {execution.coverage.inspectedQuantity} · Remaining:{' '}
            {execution.coverage.remainingQuantity ?? 'Pending prepared quantity'}
            {execution.coverage.complete ? ' · Full inspection coverage achieved' : ''}
            {execution.coverage.reconciliationConflict
              ? ' · Reconciliation conflict: inspected exceeds prepared quantity'
              : ''}
          </p>
        )}
      </header>
      {[...execution.sections]
        .sort((a, b) => a.sequence - b.sequence)
        .map((section) => (
          <section
            key={section.id}
            className="space-y-5 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5"
            data-sequence={section.sequence}
          >
            <div className="space-y-1 border-b border-border-subtle pb-3">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              {section.description ? (
                <p className="text-sm text-muted-foreground">{section.description}</p>
              ) : null}
            </div>
            {[...section.components]
              .sort((a, b) => a.sequence - b.sequence)
              .map((component) => {
                const config = component.config;
                return (
                  <fieldset key={component.id} disabled={disabled} className="min-w-0 space-y-3">
                    <legend className="mb-3 font-semibold">
                      {component.title}
                      {(component.type === 'COMMENTS' && config.required === true) ||
                      component.type === 'INSPECTION_OUTCOME' ? (
                        <span className="ml-1 text-danger" aria-hidden="true">
                          *
                        </span>
                      ) : null}
                    </legend>
                    {component.description ? (
                      <p className="text-sm text-muted-foreground">{component.description}</p>
                    ) : null}
                    {['SYSTEM_CONTEXT', 'PRODUCTION_PROGRESS'].includes(component.type) && (
                      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(component.systemValue ?? []).map((item) => (
                          <div
                            key={item.key}
                            className="min-w-0 rounded-md bg-surface-muted px-3 py-2"
                          >
                            <dt className="text-xs font-medium text-muted-foreground">
                              {text(
                                rows(config.fields ?? config.metrics).find(
                                  (row) => row.key === item.key,
                                )?.label ?? item.key,
                              )}
                            </dt>
                            <dd className="mt-1 break-words text-sm font-medium text-foreground">
                              {item.available ? text(item.value) : 'Unavailable'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {component.type === 'FIELD_GROUP' && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                              <TextField
                                key={fieldKey}
                                id={controlId(component.id, fieldKey)}
                                label={text(field.label)}
                                width="full"
                                readOnly
                                value={
                                  systemValue?.available ? text(systemValue.value) : 'Unavailable'
                                }
                              />
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
                      </div>
                    )}
                    {component.type === 'ATTENDEE_LIST' && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(Array.isArray(config.roles) ? config.roles : []).map((role) => {
                          const roleConfig = typeof role === 'string' ? null : (role as ConfigRow);
                          const roleKey = typeof role === 'string' ? role : text(roleConfig?.key);
                          const roleLabel =
                            typeof role === 'string' ? role : text(roleConfig?.label ?? roleKey);
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
                      </div>
                    )}
                    {component.type === 'ACTION_LIST' && (
                      <div className="space-y-3">
                        {!draft.actions.some((action) => action.componentId === component.id) ? (
                          <p className="text-sm text-muted-foreground">
                            No follow-up actions added.
                          </p>
                        ) : null}
                        {execution.status === 'DRAFT' ? (
                          <Button
                            type="button"
                            variant="secondary"
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
                        ) : null}
                        {draft.actions.map((action, index) => {
                          if (action.componentId !== component.id) return null;
                          const rowIndex = draft.actions
                            .slice(0, index)
                            .filter((candidate) => candidate.componentId === component.id).length;
                          return (
                            <div
                              key={actionRowKeys[index]}
                              className="rounded-md border border-border-subtle bg-surface-muted p-3"
                            >
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {rows(config.columns).map((column) => {
                                  const columnKey = text(column.key);
                                  const validation = fieldError(component.id, columnKey, rowIndex);
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
                                        {(Array.isArray(column.options) ? column.options : []).map(
                                          (option) => (
                                            <option key={text(option)}>{text(option)}</option>
                                          ),
                                        )}
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
                              </div>
                              {execution.status === 'DRAFT' ? (
                                <div className="mt-3 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                      setVisibleErrors((current) =>
                                        current.filter((item) => item.componentId !== component.id),
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
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {component.type === 'CHECKLIST' &&
                      rows(config.items).map((item) => {
                        const itemKey = text(item.key);
                        const current = draft.checklistResponses.find(
                          (value) =>
                            value.componentId === component.id && value.itemKey === itemKey,
                        );
                        const validation = fieldError(component.id, itemKey);
                        return (
                          <label key={itemKey} className="block">
                            {text(item.label)}
                            <span className="ml-1 text-danger" aria-hidden="true">
                              *
                            </span>
                            <select
                              id={controlId(component.id, itemKey)}
                              aria-label={text(item.label)}
                              required
                              className={validation ? errorClass : undefined}
                              aria-invalid={validation ? true : undefined}
                              aria-describedby={
                                validation ? `${controlId(component.id, itemKey)}-error` : undefined
                              }
                              value={current?.response ?? ''}
                              onChange={(event) => {
                                clearFieldError(
                                  component.id,
                                  itemKey,
                                  undefined,
                                  Boolean(event.target.value),
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
                                      response: event.target.value,
                                    },
                                  ),
                                );
                              }}
                            >
                              <option value="">Select</option>
                              {(config.responseOptions as string[]).map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                            {validation ? (
                              <span
                                id={`${controlId(component.id, itemKey)}-error`}
                                role="alert"
                                className="block text-xs text-danger"
                              >
                                {validation.message}
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    {component.type === 'AQL_RESULT' &&
                      rows(config.criteria).map((criterion) => {
                        const severity = text(criterion.severity) as 'CRITICAL' | 'MAJOR' | 'MINOR';
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
                          <div key={severity} className="grid grid-cols-3 gap-2">
                            <span>
                              {severity} · AQL {text(criterion.aql)}
                            </span>
                            <label className="block">
                              Max{' '}
                              <span className="text-danger" aria-hidden="true">
                                *
                              </span>
                              <input
                                id={controlId(component.id, `${severity}.maxAllowed`)}
                                aria-label={`${severity} max`}
                                aria-invalid={maxError ? true : undefined}
                                className={maxError ? errorClass : undefined}
                                type="number"
                                min="0"
                                required
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
                              {maxError ? (
                                <span role="alert" className="block text-xs text-danger">
                                  {maxError.message}
                                </span>
                              ) : null}
                            </label>
                            <label className="block">
                              Found{' '}
                              <span className="text-danger" aria-hidden="true">
                                *
                              </span>
                              <input
                                id={controlId(component.id, `${severity}.found`)}
                                aria-label={`${severity} found`}
                                aria-invalid={foundError ? true : undefined}
                                className={foundError ? errorClass : undefined}
                                type="number"
                                min="0"
                                required
                                value={current?.found ?? ''}
                                onChange={(event) => {
                                  clearFieldError(
                                    component.id,
                                    `${severity}.found`,
                                    undefined,
                                    Boolean(event.target.value),
                                  );
                                  update({
                                    found: event.target.value ? Number(event.target.value) : null,
                                  });
                                }}
                              />
                              {foundError ? (
                                <span role="alert" className="block text-xs text-danger">
                                  {foundError.message}
                                </span>
                              ) : null}
                            </label>
                          </div>
                        );
                      })}
                    {component.type === 'DEFECT_LIST' && (
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            set('defects', [
                              ...draft.defects,
                              {
                                componentId: component.id,
                                description: '',
                                severity: (
                                  config.severities as Array<'CRITICAL' | 'MAJOR' | 'MINOR'>
                                )[0]!,
                                quantity: 0,
                              },
                            ])
                          }
                        >
                          Add defect
                        </button>
                        {draft.defects.map(
                          (defect, index) =>
                            defect.componentId === component.id && (
                              <div key={index} className="grid grid-cols-3 gap-2">
                                <input
                                  aria-label="Defect description"
                                  value={defect.description}
                                  onChange={(event) => {
                                    const next = [...draft.defects];
                                    next[index] = { ...defect, description: event.target.value };
                                    set('defects', next);
                                  }}
                                />
                                <select
                                  aria-label="Defect severity"
                                  value={defect.severity}
                                  onChange={(event) => {
                                    const next = [...draft.defects];
                                    next[index] = {
                                      ...defect,
                                      severity: event.target.value as typeof defect.severity,
                                    };
                                    set('defects', next);
                                  }}
                                >
                                  {(config.severities as string[]).map((option) => (
                                    <option key={option}>{option}</option>
                                  ))}
                                </select>
                                <input
                                  aria-label="Defect quantity"
                                  type="number"
                                  min="0"
                                  value={defect.quantity ?? ''}
                                  onChange={(event) => {
                                    const next = [...draft.defects];
                                    next[index] = {
                                      ...defect,
                                      quantity: Number(event.target.value),
                                    };
                                    set('defects', next);
                                  }}
                                />
                              </div>
                            ),
                        )}
                      </div>
                    )}
                    {component.type === 'CORRECTIVE_ACTIONS' && (
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            set('correctiveActions', [
                              ...draft.correctiveActions,
                              { componentId: component.id, values: {} },
                            ])
                          }
                        >
                          Add corrective action
                        </button>
                        {draft.correctiveActions.map((action, index) => {
                          if (action.componentId !== component.id) return null;
                          const rowIndex = draft.correctiveActions
                            .slice(0, index)
                            .filter((candidate) => candidate.componentId === component.id).length;
                          return (
                            <div key={index}>
                              {rows(config.columns).map((column) => {
                                const columnKey = text(column.key);
                                const validation = fieldError(component.id, columnKey, rowIndex);
                                return (
                                  <label key={columnKey}>
                                    {text(column.label)}
                                    {column.required === true ? (
                                      <span className="ml-1 text-danger" aria-hidden="true">
                                        *
                                      </span>
                                    ) : null}
                                    <input
                                      id={controlId(component.id, columnKey, rowIndex)}
                                      required={column.required === true}
                                      aria-invalid={validation ? true : undefined}
                                      aria-describedby={
                                        validation
                                          ? `${controlId(component.id, columnKey, rowIndex)}-error`
                                          : undefined
                                      }
                                      className={validation ? errorClass : undefined}
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
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {component.type === 'TEST_RESULTS' &&
                      rows(config.tests).map((test) => {
                        const testKey = text(test.key);
                        const current = draft.testResults.find(
                          (value) =>
                            value.componentId === component.id && value.testKey === testKey,
                        );
                        const validation = fieldError(component.id, testKey);
                        return (
                          <label key={testKey} className="block">
                            {text(test.label)}
                            <span className="ml-1 text-danger" aria-hidden="true">
                              *
                            </span>
                            <select
                              id={controlId(component.id, testKey)}
                              required
                              aria-invalid={validation ? true : undefined}
                              aria-describedby={
                                validation ? `${controlId(component.id, testKey)}-error` : undefined
                              }
                              className={validation ? errorClass : undefined}
                              value={current?.response ?? ''}
                              onChange={(event) => {
                                clearFieldError(
                                  component.id,
                                  testKey,
                                  undefined,
                                  Boolean(event.target.value),
                                );
                                set(
                                  'testResults',
                                  replace(
                                    draft.testResults,
                                    (value) =>
                                      value.componentId === component.id &&
                                      value.testKey === testKey,
                                    {
                                      componentId: component.id,
                                      testKey,
                                      response: event.target.value,
                                    },
                                  ),
                                );
                              }}
                            >
                              <option value="">Select</option>
                              {(test.responseOptions as string[]).map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                            {validation ? (
                              <span
                                id={`${controlId(component.id, testKey)}-error`}
                                role="alert"
                                className="block text-xs text-danger"
                              >
                                {validation.message}
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    {component.type === 'QUANTITY_RECONCILIATION' &&
                      rows(config.fields).map((field) =>
                        field.source === 'SYSTEM' ? (
                          <p key={text(field.key)}>
                            {text(field.label)}:{' '}
                            {text(
                              component.systemValue?.find((value) => value.key === field.key)
                                ?.value,
                            )}
                          </p>
                        ) : (
                          <label key={text(field.key)} className="block">
                            {text(field.label)}
                            {field.required === true ? (
                              <span className="ml-1 text-danger" aria-hidden="true">
                                *
                              </span>
                            ) : null}
                            <input
                              id={controlId(component.id, text(field.key))}
                              type="number"
                              min="0"
                              required={field.required === true}
                              aria-invalid={
                                fieldError(component.id, text(field.key)) ? true : undefined
                              }
                              className={
                                fieldError(component.id, text(field.key)) ? errorClass : undefined
                              }
                              value={
                                draft.quantities.find(
                                  (value) =>
                                    value.componentId === component.id &&
                                    value.fieldKey === field.key,
                                )?.value ?? ''
                              }
                              onChange={(event) => {
                                clearFieldError(
                                  component.id,
                                  text(field.key),
                                  undefined,
                                  Boolean(event.target.value),
                                );
                                set(
                                  'quantities',
                                  replace(
                                    draft.quantities,
                                    (value) =>
                                      value.componentId === component.id &&
                                      value.fieldKey === field.key,
                                    {
                                      componentId: component.id,
                                      fieldKey: text(field.key),
                                      value: Number(event.target.value),
                                    },
                                  ),
                                );
                              }}
                            />
                            {fieldError(component.id, text(field.key)) ? (
                              <span role="alert" className="block text-xs text-danger">
                                {fieldError(component.id, text(field.key))?.message}
                              </span>
                            ) : null}
                          </label>
                        ),
                      )}
                    {component.type === 'COMMENTS' && (
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
                    )}
                    {component.type === 'SIGNATURES' && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                                  value.componentId === component.id && value.roleKey === role.key,
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
                      </div>
                    )}
                    {component.type === 'INSPECTION_OUTCOME' && (
                      <div>
                        {(config.allowedOutcomes as string[]).map((outcome, outcomeIndex) => (
                          <label key={outcome}>
                            <input
                              id={outcomeIndex === 0 ? controlId(component.id, 'value') : undefined}
                              type="radio"
                              name={`outcome-${component.id}`}
                              required
                              aria-invalid={fieldError(component.id, 'value') ? true : undefined}
                              checked={draft.outcome?.value === outcome}
                              onChange={() => {
                                clearFieldError(component.id, 'value');
                                set('outcome', {
                                  componentId: component.id,
                                  value: outcome as 'PASS' | 'FAIL',
                                  remarks: draft.outcome?.remarks,
                                });
                              }}
                            />
                            {outcome}
                          </label>
                        ))}
                        {fieldError(component.id, 'value') ? (
                          <p role="alert" className="text-xs text-danger">
                            {fieldError(component.id, 'value')?.message}
                          </p>
                        ) : null}
                        <textarea
                          id={controlId(component.id, 'remarks')}
                          aria-label="Outcome remarks"
                          aria-invalid={fieldError(component.id, 'remarks') ? true : undefined}
                          className={fieldError(component.id, 'remarks') ? errorClass : undefined}
                          value={draft.outcome?.remarks ?? ''}
                          onChange={(event) => {
                            clearFieldError(
                              component.id,
                              'remarks',
                              undefined,
                              Boolean(event.target.value.trim()),
                            );
                            if (draft.outcome)
                              set('outcome', { ...draft.outcome, remarks: event.target.value });
                          }}
                        />
                        {fieldError(component.id, 'remarks') ? (
                          <p role="alert" className="text-xs text-danger">
                            {fieldError(component.id, 'remarks')?.message}
                          </p>
                        ) : null}
                      </div>
                    )}
                    {component.type === 'ATTACHMENTS' &&
                      rows(config.requirements).map((requirement) => (
                        <div key={text(requirement.key)}>
                          <label>
                            {text(requirement.label)}
                            {requirement.required === true ||
                            requirement.requiredWhen === 'ALWAYS' ||
                            (requirement.requiredWhen === 'INSPECTION_FAILED' &&
                              draft.outcome?.value === 'FAIL') ? (
                              <span className="ml-1 text-danger" aria-hidden="true">
                                *
                              </span>
                            ) : null}
                            <input
                              id={controlId(component.id, text(requirement.key))}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              required={
                                requirement.required === true ||
                                requirement.requiredWhen === 'ALWAYS' ||
                                (requirement.requiredWhen === 'INSPECTION_FAILED' &&
                                  draft.outcome?.value === 'FAIL')
                              }
                              aria-invalid={
                                fieldError(component.id, text(requirement.key)) ? true : undefined
                              }
                              className={
                                fieldError(component.id, text(requirement.key))
                                  ? errorClass
                                  : undefined
                              }
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file && props.onUpload) {
                                  clearFieldError(component.id, text(requirement.key));
                                  void props.onUpload(component.id, text(requirement.key), file);
                                }
                              }}
                            />
                          </label>
                          {fieldError(component.id, text(requirement.key)) ? (
                            <p role="alert" className="text-xs text-danger">
                              {fieldError(component.id, text(requirement.key))?.message}
                            </p>
                          ) : null}
                          <ul>
                            {execution.attachments
                              .filter(
                                (item) =>
                                  item.componentId === component.id &&
                                  item.requirementKey === requirement.key,
                              )
                              .map((item) => (
                                <li key={item.id}>
                                  {item.fileName}
                                  {execution.status === 'DRAFT' && props.onRemoveAttachment ? (
                                    <button
                                      type="button"
                                      onClick={() => void props.onRemoveAttachment?.(item.id)}
                                    >
                                      Remove
                                    </button>
                                  ) : null}
                                </li>
                              ))}
                          </ul>
                        </div>
                      ))}
                  </fieldset>
                );
              })}
          </section>
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
        <footer className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
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
            onClick={() => void props.onFinalize({ ...draft, expectedVersion: execution.version })}
          >
            Finalize
          </Button>
        </footer>
      )}
    </form>
  );
}
