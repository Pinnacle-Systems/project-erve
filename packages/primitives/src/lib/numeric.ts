export type NumericMode = 'integer' | 'decimal' | 'currency' | 'percentage';

export interface NumericFieldConstraints {
  mode?: NumericMode;
  min?: number;
  max?: number;
  /** Max decimal places. Defaults by mode: integer=0, decimal/currency/percentage=2. */
  precision?: number;
  allowNegative?: boolean;
}

const DEFAULT_PRECISION: Record<NumericMode, number> = {
  integer: 0,
  decimal: 2,
  currency: 2,
  percentage: 2,
};

export function resolvePrecision(constraints?: NumericFieldConstraints): number {
  const mode = constraints?.mode ?? 'decimal';
  return constraints?.precision ?? DEFAULT_PRECISION[mode];
}

/**
 * True for "", a bare sign, or any syntactically valid *unfinished* numeric
 * draft under these constraints (e.g. "12.", "-", "0.5"). Used to decide
 * whether a keystroke/paste is allowed into the field at all — this is the
 * mechanism that lets a user type "12." without it being treated as invalid
 * mid-entry.
 */
export function isNumericDraft(raw: string, constraints?: NumericFieldConstraints): boolean {
  if (raw === '') return true;
  const allowNegative = constraints?.allowNegative ?? false;
  if (raw === '-') return allowNegative;
  const precision = resolvePrecision(constraints);
  const sign = allowNegative ? '-?' : '';
  const body = precision > 0 ? `\\d*(\\.\\d{0,${precision}})?` : '\\d*';
  const pattern = new RegExp(`^${sign}${body}$`);
  return pattern.test(raw);
}

export interface NumericCommitResult {
  /** Parsed value, or null when the draft carries no digits (an intentional "no value"). */
  value: number | null;
  outOfRange: boolean;
  rangeMessage?: string;
}

/**
 * Parses a draft at commit time (blur / explicit submit). Never silently
 * rewrites an out-of-range value — callers must keep showing the user's
 * draft and surface `rangeMessage` as a validation error instead of
 * replacing it with a clamped number.
 */
export function commitNumericDraft(raw: string, constraints?: NumericFieldConstraints): NumericCommitResult {
  const trimmed = raw.trim();

  // Drafts with no digits at all ("", "-", ".", "-.") represent "no value",
  // not zero and not an error.
  if (!/\d/.test(trimmed)) {
    return { value: null, outOfRange: false };
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return { value: null, outOfRange: false };
  }

  const allowNegative = constraints?.allowNegative ?? false;
  if (!allowNegative && numeric < 0) {
    return { value: numeric, outOfRange: true, rangeMessage: 'Must not be negative.' };
  }
  if (typeof constraints?.min === 'number' && numeric < constraints.min) {
    return { value: numeric, outOfRange: true, rangeMessage: `Must be at least ${constraints.min}.` };
  }
  if (typeof constraints?.max === 'number' && numeric > constraints.max) {
    return { value: numeric, outOfRange: true, rangeMessage: `Must be at most ${constraints.max}.` };
  }
  return { value: numeric, outOfRange: false };
}

/** Formats a committed value back into draft text — trivial display formatting only, never a value correction. */
export function formatNumericValue(value: number | null | undefined, constraints?: NumericFieldConstraints): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  const precision = resolvePrecision(constraints);
  if (precision <= 0) return String(Math.trunc(value));
  const fixed = value.toFixed(precision);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/**
 * Best-effort recovery of a usable numeric substring from pasted text that
 * isn't itself a valid draft (e.g. pasted with currency symbols/whitespace).
 * Returns null when nothing usable is found, so the paste is ignored rather
 * than silently accepting garbage.
 */
export function extractNumericSubstring(text: string, constraints?: NumericFieldConstraints): string | null {
  const allowNegative = constraints?.allowNegative ?? false;
  const match = text.match(allowNegative ? /-?\d+(\.\d+)?/ : /\d+(\.\d+)?/);
  if (!match) return null;
  return isNumericDraft(match[0], constraints) ? match[0] : null;
}

/** Non-field convenience for places that just need "parse this string as a finite number, defaulting to 0" (e.g. summing a list of quantities). */
export function toFiniteNumber(raw: string | number | null | undefined): number {
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}
