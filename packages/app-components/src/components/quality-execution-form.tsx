import { useState } from 'react';
import type { QualityExecutionPayload, QualityExecutionView } from '@erve/types';

type ConfigRow = Record<string, unknown>;
const rows = (value: unknown): ConfigRow[] => (Array.isArray(value) ? (value as ConfigRow[]) : []);
const text = (value: unknown) => String(value ?? '');
const replace = <T,>(values: T[], match: (value: T) => boolean, next: T) => [
  ...values.filter((value) => !match(value)),
  next,
];

export interface QualityExecutionFormProps {
  execution: QualityExecutionView;
  onSave(payload: QualityExecutionPayload): Promise<void>;
  onFinalize(payload: QualityExecutionPayload): Promise<void>;
  onUpload?(componentId: string, requirementKey: string, file: File): Promise<void>;
  onRemoveAttachment?(attachmentId: string): Promise<void>;
  busy?: boolean;
  error?: string;
}

export function QualityExecutionForm(props: QualityExecutionFormProps) {
  const { execution, busy, error } = props;
  const [draft, setDraft] = useState<QualityExecutionPayload>(execution.responses);
  const set = <K extends keyof QualityExecutionPayload>(
    key: K,
    value: QualityExecutionPayload[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const disabled = execution.status === 'FINALIZED' || busy;

  return (
    <form className="space-y-6" onSubmit={(event) => event.preventDefault()}>
      <header>
        <h1 className="text-xl font-semibold">{execution.activityName}</h1>
        <p>
          {execution.qualityForm.name} v{execution.qualityForm.versionNumber} · Attempt{' '}
          {execution.attemptNumber} · {execution.status}
        </p>
        {execution.coverage && (
          <p aria-label="Final inspection coverage">
            Prepared:{' '}
            {execution.coverage.preparedQuantityAuthoritative
              ? execution.coverage.preparedQuantity
              : 'Not yet recorded'}{' '}
            · Inspected:{' '}
            {execution.coverage.inspectedQuantity} · Remaining:{' '}
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
            className="space-y-4 rounded border p-4"
            data-sequence={section.sequence}
          >
            <h2 className="text-lg font-semibold">{section.title}</h2>
            {[...section.components]
              .sort((a, b) => a.sequence - b.sequence)
              .map((component) => {
                const config = component.config;
                return (
                  <fieldset key={component.id} disabled={disabled} className="space-y-2">
                    <legend className="font-medium">{component.title}</legend>
                    {['SYSTEM_CONTEXT', 'PRODUCTION_PROGRESS'].includes(component.type) && (
                      <dl>
                        {(component.systemValue ?? []).map((item) => (
                          <div key={item.key}>
                            <dt>
                              {text(
                                rows(config.fields ?? config.metrics).find(
                                  (row) => row.key === item.key,
                                )?.label ?? item.key,
                              )}
                            </dt>
                            <dd>{item.available ? text(item.value) : 'Unavailable'}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {component.type === 'FIELD_GROUP' &&
                      rows(config.fields).map((field) => {
                        const fieldKey = text(field.key);
                        const current = draft.fieldResponses.find(
                          (value) =>
                            value.componentId === component.id && value.fieldKey === fieldKey,
                        );
                        return (
                          <label key={fieldKey} className="block">
                            {text(field.label)}
                            <input
                              type={
                                field.dataType === 'DATE'
                                  ? 'date'
                                  : field.dataType === 'NUMBER'
                                    ? 'number'
                                    : 'text'
                              }
                              value={current?.value ?? ''}
                              onChange={(event) =>
                                set(
                                  'fieldResponses',
                                  replace(
                                    draft.fieldResponses,
                                    (value) =>
                                      value.componentId === component.id &&
                                      value.fieldKey === fieldKey,
                                    {
                                      componentId: component.id,
                                      fieldKey,
                                      value: event.target.value,
                                    },
                                  ),
                                )
                              }
                            />
                          </label>
                        );
                      })}
                    {component.type === 'ATTENDEE_LIST' && (
                      <div>
                        {(config.roles as string[]).map((roleKey) => {
                          const current = draft.attendees.find(
                            (value) =>
                              value.componentId === component.id && value.roleKey === roleKey,
                          );
                          return (
                            <label key={roleKey} className="block">
                              {roleKey}
                              <input
                                value={current?.attendeeName ?? ''}
                                onChange={(event) =>
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
                                  )
                                }
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {component.type === 'ACTION_LIST' && (
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            set('actions', [
                              ...draft.actions,
                              { componentId: component.id, values: {} },
                            ])
                          }
                        >
                          Add follow-up
                        </button>
                        {draft.actions.map(
                          (action, index) =>
                            action.componentId === component.id && (
                              <div key={index}>
                                {rows(config.columns).map((column) => (
                                  <label key={text(column.key)} className="block">
                                    {text(column.label)}
                                    <input
                                      type={column.dataType === 'DATE' ? 'date' : 'text'}
                                      value={text(action.values[text(column.key)])}
                                      onChange={(event) => {
                                        const next = [...draft.actions];
                                        next[index] = {
                                          ...action,
                                          values: {
                                            ...action.values,
                                            [text(column.key)]: event.target.value,
                                          },
                                        };
                                        set('actions', next);
                                      }}
                                    />
                                  </label>
                                ))}
                              </div>
                            ),
                        )}
                      </div>
                    )}
                    {component.type === 'CHECKLIST' &&
                      rows(config.items).map((item) => {
                        const itemKey = text(item.key);
                        const current = draft.checklistResponses.find(
                          (value) =>
                            value.componentId === component.id && value.itemKey === itemKey,
                        );
                        return (
                          <label key={itemKey} className="block">
                            {text(item.label)}
                            <select
                              aria-label={text(item.label)}
                              value={current?.response ?? ''}
                              onChange={(event) =>
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
                                )
                              }
                            >
                              <option value="">Select</option>
                              {(config.responseOptions as string[]).map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
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
                            <input
                              aria-label={`${severity} max`}
                              type="number"
                              min="0"
                              placeholder="Max"
                              value={current?.maxAllowed ?? ''}
                              onChange={(event) =>
                                update({
                                  maxAllowed: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                            <input
                              aria-label={`${severity} found`}
                              type="number"
                              min="0"
                              placeholder="Found"
                              value={current?.found ?? ''}
                              onChange={(event) =>
                                update({
                                  found: event.target.value ? Number(event.target.value) : null,
                                })
                              }
                            />
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
                        {draft.correctiveActions.map(
                          (action, index) =>
                            action.componentId === component.id && (
                              <div key={index}>
                                {rows(config.columns).map((column) => (
                                  <label key={text(column.key)}>
                                    {text(column.label)}
                                    <input
                                      value={text(action.values[text(column.key)])}
                                      onChange={(event) => {
                                        const next = [...draft.correctiveActions];
                                        next[index] = {
                                          ...action,
                                          values: {
                                            ...action.values,
                                            [text(column.key)]: event.target.value,
                                          },
                                        };
                                        set('correctiveActions', next);
                                      }}
                                    />
                                  </label>
                                ))}
                              </div>
                            ),
                        )}
                      </div>
                    )}
                    {component.type === 'TEST_RESULTS' &&
                      rows(config.tests).map((test) => {
                        const testKey = text(test.key);
                        const current = draft.testResults.find(
                          (value) =>
                            value.componentId === component.id && value.testKey === testKey,
                        );
                        return (
                          <label key={testKey} className="block">
                            {text(test.label)}
                            <select
                              value={current?.response ?? ''}
                              onChange={(event) =>
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
                                )
                              }
                            >
                              <option value="">Select</option>
                              {(test.responseOptions as string[]).map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
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
                            <input
                              type="number"
                              min="0"
                              value={
                                draft.quantities.find(
                                  (value) =>
                                    value.componentId === component.id &&
                                    value.fieldKey === field.key,
                                )?.value ?? ''
                              }
                              onChange={(event) =>
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
                                )
                              }
                            />
                          </label>
                        ),
                      )}
                    {component.type === 'COMMENTS' && (
                      <textarea
                        aria-label={component.title}
                        value={
                          draft.comments.find((value) => value.componentId === component.id)
                            ?.value ?? ''
                        }
                        onChange={(event) =>
                          set(
                            'comments',
                            replace(draft.comments, (value) => value.componentId === component.id, {
                              componentId: component.id,
                              value: event.target.value,
                            }),
                          )
                        }
                      />
                    )}
                    {component.type === 'SIGNATURES' &&
                      rows(config.roles).map((role) => (
                        <label key={text(role.key)} className="block">
                          {text(role.label)}
                          <input
                            value={
                              draft.signoffs.find(
                                (value) =>
                                  value.componentId === component.id && value.roleKey === role.key,
                              )?.signatoryName ?? ''
                            }
                            onChange={(event) =>
                              set(
                                'signoffs',
                                replace(
                                  draft.signoffs,
                                  (value) =>
                                    value.componentId === component.id &&
                                    value.roleKey === role.key,
                                  {
                                    componentId: component.id,
                                    roleKey: text(role.key),
                                    signatoryName: event.target.value,
                                  },
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                    {component.type === 'INSPECTION_OUTCOME' && (
                      <div>
                        {(config.allowedOutcomes as string[]).map((outcome) => (
                          <label key={outcome}>
                            <input
                              type="radio"
                              name={`outcome-${component.id}`}
                              checked={draft.outcome?.value === outcome}
                              onChange={() =>
                                set('outcome', {
                                  componentId: component.id,
                                  value: outcome as 'PASS' | 'FAIL',
                                  remarks: draft.outcome?.remarks,
                                })
                              }
                            />
                            {outcome}
                          </label>
                        ))}
                        <textarea
                          aria-label="Outcome remarks"
                          value={draft.outcome?.remarks ?? ''}
                          onChange={(event) =>
                            draft.outcome &&
                            set('outcome', { ...draft.outcome, remarks: event.target.value })
                          }
                        />
                      </div>
                    )}
                    {component.type === 'ATTACHMENTS' &&
                      rows(config.requirements).map((requirement) => (
                        <div key={text(requirement.key)}>
                          <label>
                            {text(requirement.label)}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file && props.onUpload)
                                  void props.onUpload(component.id, text(requirement.key), file);
                              }}
                            />
                          </label>
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
      {error && <p role="alert">{error}</p>}
      {execution.status === 'DRAFT' && (
        <footer className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void props.onSave({ ...draft, expectedVersion: execution.version })}
          >
            Save draft
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void props.onFinalize({ ...draft, expectedVersion: execution.version })}
          >
            Finalize
          </button>
        </footer>
      )}
    </form>
  );
}
