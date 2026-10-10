import {
  forwardRef,
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
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    commit();
    onBlur?.(event);
  };

  const inputMode = mode === 'integer' ? ('numeric' as const) : ('decimal' as const);
  const hasError = Boolean(rangeError || errorMessage);

  if (variant === 'cell') {
    return (
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
        {...rest}
      />
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
