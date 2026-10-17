import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { GridCellInput } from './grid-cell-input';
import { TextField, type TextFieldDensity, type TextFieldWidth } from './text-field';
import {
  commitNumericDraft,
  extractNumericSubstring,
  formatNumericValue,
  isNumericDraft,
  type NumericFieldConstraints,
  type NumericMode,
} from '../lib/numeric';

export type { NumericMode };

export interface NumericFieldProps
  extends NumericFieldConstraints,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'size'> {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Fires on every commit (blur) with whether the committed draft is in-range. Does not replace onChange. */
  onValidationChange?: (isValid: boolean) => void;
  label?: string;
  density?: TextFieldDensity;
  width?: TextFieldWidth;
  helpText?: ReactNode;
  errorMessage?: ReactNode;
  /** 'field' (default) renders as a labeled TextField; 'cell' renders via GridCellInput for grid contexts. */
  variant?: 'field' | 'cell';
}

/**
 * A general-purpose numeric input: integer/decimal/currency/percentage modes,
 * precision/min/max/negative rules, paste handling, and no native spinner
 * arrows (it's `type="text"` with `inputMode` for the mobile keyboard, never
 * `type="number"`).
 *
 * Deliberately NOT for identifier-shaped fields (Style codes, LMIX numbers,
 * barcodes, phone numbers) or free-text measurement fields — those stay on
 * `TextField`.
 *
 * Validation model: while typing, any syntactically valid partial draft
 * ("12.", "-", "") is accepted as-is — nothing is coerced mid-entry. On
 * commit (blur), an out-of-range value is never silently rewritten; the
 * user's draft stays on screen and `errorMessage` surfaces the problem
 * instead, exactly like any other form field's validation error.
 */
export const NumericField = forwardRef<HTMLInputElement, NumericFieldProps>((props, ref) => {
  const {
    value,
    onChange,
    onValidationChange,
    mode = 'decimal',
    min,
    max,
    precision,
    allowNegative = false,
    variant = 'field',
    density,
    width = 'md',
    label,
    helpText,
    errorMessage,
    disabled,
    readOnly,
    onFocus,
    onBlur,
    ...rest
  } = props;

  const constraints: NumericFieldConstraints = { mode, min, max, precision, allowNegative };

  const [draft, setDraft] = useState(() => formatNumericValue(value, constraints));
  const [rangeError, setRangeError] = useState<string | undefined>(undefined);
  const isFocusedRef = useRef(false);
  const lastExternalValue = useRef(value);

  // Resync the draft from an externally-changed `value` (e.g. parent reset
  // or reload) — but only while the field isn't being actively edited, so
  // this never fights the user mid-keystroke.
  if (!isFocusedRef.current && lastExternalValue.current !== value) {
    lastExternalValue.current = value;
    setDraft(formatNumericValue(value, constraints));
    setRangeError(undefined);
  }

  const handleRawChange = (raw: string) => {
    if (!isNumericDraft(raw, constraints)) return;
    setDraft(raw);
    if (rangeError) setRangeError(undefined);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (isNumericDraft(pasted, constraints)) return; // let the default paste happen
    event.preventDefault();
    const recovered = extractNumericSubstring(pasted, constraints);
    if (recovered !== null) {
      handleRawChange(recovered);
    }
  };

  const commit = () => {
    const result = commitNumericDraft(draft, constraints);
    if (result.outOfRange) {
      setRangeError(result.rangeMessage);
      onValidationChange?.(false);
      return;
    }
    setRangeError(undefined);
    onValidationChange?.(true);
    setDraft(formatNumericValue(result.value, constraints));
    lastExternalValue.current = result.value;
    if (result.value !== value) {
      onChange(result.value);
    }
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    // Grid cells only: a lone "0" is the common starting value for a
    // not-yet-entered quantity — select it on focus so typing replaces it
    // instead of producing "010". Mirrors the field this replaced
    // (JobOrderProductionTab's pre-PR2A Prepared Quantity input, ISS-020).
    if (variant === 'cell' && event.currentTarget.value === '0') {
      event.currentTarget.select();
    }
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    commit();
    onBlur?.(event);
  };

  const inputMode = mode === 'integer' ? ('numeric' as const) : ('decimal' as const);
  const hasError = Boolean(rangeError || errorMessage);
  // `errorMessage` is typed ReactNode for the labeled-field variant, but a
  // cell's title/aria-describedby need a plain string — `rangeError` always
  // is one; fall back to `errorMessage` only when it already is too.
  const cellMessage = rangeError ?? (typeof errorMessage === 'string' ? errorMessage : undefined);
  const cellErrorId = useId();

  if (variant === 'cell') {
    // A grid cell has no room for TextField's own inline error row, but a
    // red border alone ("error={hasError}") doesn't say WHAT is wrong — so
    // the specific message (e.g. "Must be at most 10.") still needs a home:
    // a hover/focus title tooltip for sighted users, and aria-describedby
    // for assistive tech. Mirrors the specificity the pre-PR2A
    // Prepared Quantity field had via TextField's errorMessage.
    return (
      <span className="relative block w-full" title={cellMessage || undefined}>
        <GridCellInput
          ref={ref}
          type="text"
          inputMode={inputMode}
          numeric
          error={hasError}
          disabled={disabled}
          readOnly={readOnly}
          value={draft}
          onChange={(event) => handleRawChange(event.target.value)}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-invalid={hasError || undefined}
          aria-describedby={cellMessage ? cellErrorId : undefined}
          {...rest}
        />
        {cellMessage && (
          <span id={cellErrorId} className="sr-only">
            {cellMessage}
          </span>
        )}
      </span>
    );
  }

  return (
    <TextField
      ref={ref}
      type="text"
      inputMode={inputMode}
      label={label}
      density={density}
      width={width}
      disabled={disabled}
      readOnly={readOnly}
      error={hasError}
      errorMessage={rangeError ?? errorMessage}
      helpText={helpText}
      value={draft}
      onChange={(event) => handleRawChange(event.target.value)}
      onPaste={handlePaste}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

NumericField.displayName = 'NumericField';
