import type { ReactNode } from 'react';
import { SelectField, SelectItem } from '@erve/primitives';

export interface QualityChoice {
  value: string;
  label: string;
}

export const usesCompactQualityChoices = (choices: QualityChoice[]) =>
  choices.length >= 2 &&
  choices.length <= 3 &&
  choices.every((choice) => choice.label.trim().length <= 10) &&
  choices.reduce((length, choice) => length + choice.label.trim().length, 0) <= 20;

export interface QualityChoiceGroupProps {
  label: string;
  choices: QualityChoice[];
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  id?: string;
}

export type QualityChecklistResultTone = 'positive' | 'negative' | 'neutral';

export interface QualityChecklistResultProps {
  label: string;
  value: string;
  choices?: QualityChoice[];
  tone?: QualityChecklistResultTone;
  emptyLabel?: string;
}

const resultTone = (value: string): QualityChecklistResultTone => {
  const normalized = value.trim().toUpperCase();
  if (['YES', 'PASS', 'PASSED', 'OK', 'ACCEPTED'].includes(normalized)) return 'positive';
  if (['NO', 'FAIL', 'FAILED', 'REJECTED'].includes(normalized)) return 'negative';
  return 'neutral';
};

export function QualityChecklistResult({
  label,
  value,
  choices = [],
  tone = resultTone(value),
  emptyLabel = 'Not answered',
}: QualityChecklistResultProps) {
  const displayValue =
    choices.find((choice) => choice.value === value)?.label ??
    choices.find((choice) => choice.value.toLowerCase() === value.toLowerCase())?.label ??
    value;
  const marker = tone === 'positive' ? '\u2713' : tone === 'negative' ? '\u2715' : '\u2022';

  return (
    <output
      aria-label={`${label}: ${displayValue || emptyLabel}`}
      data-quality-checklist-result="true"
      className={`inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold ${
        tone === 'positive'
          ? 'text-success'
          : tone === 'negative'
            ? 'text-danger'
            : 'text-foreground'
      }`}
    >
      {displayValue ? (
        <>
          <span aria-hidden="true">{marker}</span>
          <span>{displayValue}</span>
        </>
      ) : (
        <span className="font-normal text-muted-foreground">{emptyLabel}</span>
      )}
    </output>
  );
}

export interface QualityChecklistRemarkProps {
  value?: string | null;
  emptyLabel?: string;
}

export function QualityChecklistRemark({
  value,
  emptyLabel = '\u2014',
}: QualityChecklistRemarkProps) {
  return (
    <span
      data-quality-checklist-remark="true"
      className={`block break-words text-sm ${value ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      {value || emptyLabel}
    </span>
  );
}

const unsetValue = '__QUALITY_CHECKLIST_UNSET__';

export function QualityChoiceGroup({
  label,
  choices,
  value,
  onChange,
  disabled,
  required,
  error,
  id,
}: QualityChoiceGroupProps) {
  if (!usesCompactQualityChoices(choices)) {
    return (
      <SelectField
        id={id}
        aria-label={label}
        density="compact"
        width="full"
        disabled={disabled}
        required={required}
        value={value || unsetValue}
        errorMessage={error}
        onValueChange={(next) => onChange(next === unsetValue ? '' : next)}
      >
        <SelectItem value={unsetValue}>Select</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectField>
    );
  }

  const errorId = id && error ? `${id}-error` : undefined;
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className="flex min-w-0 flex-wrap gap-1 rounded-control bg-surface-muted p-1"
      >
        {choices.map((choice, index) => {
          const checked = value === choice.value;
          return (
            <label key={choice.value} className="min-w-0 flex-1 cursor-pointer">
              <input
                id={index === 0 ? id : undefined}
                className="peer sr-only"
                type="radio"
                name={`${id ?? label}-quality-choice`}
                value={choice.value}
                checked={checked}
                disabled={disabled}
                required={required}
                onChange={() => onChange(choice.value)}
              />
              <span className="flex min-h-10 items-center justify-center gap-1 rounded-control border border-transparent px-2 text-center text-sm font-medium text-foreground transition peer-checked:border-[var(--erp-form-field-focus-border)] peer-checked:bg-surface-raised peer-checked:shadow-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--erp-focus-ring)] peer-disabled:cursor-not-allowed">
                {checked ? (
                  <span aria-hidden="true" className="font-bold">
                    &#10003;
                  </span>
                ) : null}
                {choice.label}
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface QualityChecklistProps {
  children: ReactNode;
  resultHeading?: string;
  supplementaryHeading?: string;
}

export function QualityChecklist({
  children,
  resultHeading = 'Result',
  supplementaryHeading,
}: QualityChecklistProps) {
  return (
    <div data-quality-checklist="true" className="min-w-0 overflow-x-hidden">
      <div
        aria-hidden="true"
        className={`hidden border-b border-border-subtle pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
          supplementaryHeading
            ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_14rem_minmax(12rem,18rem)] lg:gap-4'
            : 'md:grid md:grid-cols-[minmax(0,1fr)_14rem] md:gap-4'
        }`}
      >
        <span>Inspection point</span>
        <span>{resultHeading}</span>
        {supplementaryHeading ? <span>{supplementaryHeading}</span> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

export interface QualityChecklistRowProps {
  label: string;
  control: ReactNode;
  supplementary?: ReactNode;
  required?: boolean;
  error?: string;
}

export function QualityChecklistRow({
  label,
  control,
  supplementary,
  required,
  error,
}: QualityChecklistRowProps) {
  return (
    <div
      data-quality-checklist-row="true"
      className={`grid min-w-0 grid-cols-1 gap-1.5 border-b border-border-subtle py-2.5 last:border-b-0 md:items-center md:gap-4 ${
        supplementary
          ? 'lg:grid-cols-[minmax(0,1fr)_14rem_minmax(12rem,18rem)]'
          : 'md:grid-cols-[minmax(0,1fr)_14rem]'
      }`}
    >
      <div className="min-w-0 text-sm leading-5 text-foreground">
        {label}
        {required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{control}</div>
      {supplementary ? <div className="min-w-0">{supplementary}</div> : null}
    </div>
  );
}
