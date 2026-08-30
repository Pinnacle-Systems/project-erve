import { Fragment } from 'react';
import type { QualityCoverageView } from '@erve/types';
import { TextField, ValidationMessage } from '@erve/primitives';

const ALLOCATION_GRID_COLS = 'grid-cols-[minmax(4rem,1fr)_repeat(4,minmax(4.5rem,auto))]';

export interface FinalBatchAllocationFormProps {
  coverage: QualityCoverageView;
  values: Record<string, string>;
  onChange(jobOrderLineSizeId: string, value: string): void;
  error?: string;
  disabled?: boolean;
}

export function FinalBatchAllocationForm({
  coverage,
  values,
  onChange,
  error,
  disabled = false,
}: FinalBatchAllocationFormProps) {
  const sizes = coverage.availableBySize ?? [];
  const total = sizes.reduce(
    (sum, size) => sum + Math.max(0, Number(values[size.jobOrderLineSizeId] || 0)),
    0,
  );
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className={`grid ${ALLOCATION_GRID_COLS} items-center gap-x-2 gap-y-3`}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Size</span>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Prepared
        </span>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Allocated
        </span>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Available
        </span>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
          This batch
        </span>
        {sizes.map((size) => (
          <Fragment key={size.jobOrderLineSizeId}>
            <span className="text-sm">{size.sizeLabel}</span>
            <span className="text-right text-sm tabular-nums">{size.preparedQuantity}</span>
            <span className="text-right text-sm tabular-nums">{size.allocatedQuantity}</span>
            <span className="text-right text-sm tabular-nums">{size.availableQuantity}</span>
            <TextField
              aria-label={`Final batch quantity for size ${size.sizeLabel}`}
              type="number"
              min={0}
              max={size.availableQuantity}
              step={1}
              density="compact"
              width="xs"
              disabled={disabled || size.availableQuantity === 0}
              value={values[size.jobOrderLineSizeId] ?? ''}
              onChange={(event) => onChange(size.jobOrderLineSizeId, event.target.value)}
            />
          </Fragment>
        ))}
      </div>
      <div className="mt-3 flex justify-end border-t border-border pt-2 text-sm font-medium">
        Total: <span className="ml-2 tabular-nums">{total}</span>
      </div>
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
    </div>
  );
}
