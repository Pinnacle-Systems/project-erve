import type { ReactNode } from 'react';

export interface SourceQuantityInputsProps<T> {
  /** Every original source line behind one Style x Size cell; each keeps its OWN input and identity. */
  sources: T[];
  idOf: (source: T) => string;
  valueOf: (source: T) => string;
  onChange: (source: T, value: string) => void;
  maxOf: (source: T) => number | undefined;
  ariaLabelOf: (source: T) => string;
  /** Visible caption that tells apart several source lines in one cell (e.g. the Sale Order). */
  captionOf: (source: T, index: number) => ReactNode;
  /** Return true for a source that takes no input (e.g. nothing left to report); renders a dash. */
  readOnlyOf?: (source: T) => boolean;
}

/**
 * Per-source-line numeric inputs for a grouped Style x Size cell. A cell backed by ONE source line
 * is a single plain input; a cell backed by several keeps one captioned input per source line, so
 * grouping is presentation only and two independent source quantities are never collapsed into one
 * ambiguous submitted value.
 */
export function SourceQuantityInputs<T>({
  sources,
  idOf,
  valueOf,
  onChange,
  maxOf,
  ariaLabelOf,
  captionOf,
  readOnlyOf,
}: SourceQuantityInputsProps<T>) {
  const split = sources.length > 1;
  return (
    <div className="flex flex-col items-end gap-1">
      {sources.map((source, index) =>
        readOnlyOf?.(source) ? (
          <span key={idOf(source)} className="text-muted-foreground">
            {split && <span className="mr-1 text-xs">{captionOf(source, index)}</span>}—
          </span>
        ) : (
          <label key={idOf(source)} className="flex flex-col items-end gap-0.5">
            {split && <span className="text-xs text-muted-foreground">{captionOf(source, index)}</span>}
            <input
              type="number"
              min={0}
              max={maxOf(source)}
              aria-label={ariaLabelOf(source)}
              className="w-20 rounded border border-[var(--erp-border)] px-2 py-1 text-right text-sm"
              value={valueOf(source)}
              onChange={(event) => onChange(source, event.target.value)}
            />
          </label>
        ),
      )}
    </div>
  );
}
