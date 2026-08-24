import type { QualityCoverageView } from '@erve/types';
import { TextField, ValidationMessage } from '@erve/primitives';

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
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid grid-cols-[minmax(4rem,1fr)_repeat(4,minmax(4.5rem,auto))] gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Size</span>
        <span className="text-right">Prepared</span>
        <span className="text-right">Allocated</span>
        <span className="text-right">Available</span>
        <span className="text-right">This batch</span>
      </div>
      {sizes.map((size) => (
        <div
          key={size.jobOrderLineSizeId}
          className="grid grid-cols-[minmax(4rem,1fr)_repeat(4,minmax(4.5rem,auto))] items-center gap-2 text-sm"
        >
          <span>{size.sizeLabel}</span>
          <span className="text-right tabular-nums">{size.preparedQuantity}</span>
          <span className="text-right tabular-nums">{size.allocatedQuantity}</span>
          <span className="text-right tabular-nums">{size.availableQuantity}</span>
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
        </div>
      ))}
      <div className="flex justify-end border-t border-border pt-2 text-sm font-medium">
        Total: <span className="ml-2 tabular-nums">{total}</span>
      </div>
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
    </div>
  );
}
