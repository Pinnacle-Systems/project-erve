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
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="max-w-full overflow-x-auto">
        <table data-final-batch-allocation-table="true" className="w-full min-w-[36rem] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[30%]" />
          </colgroup>
          <thead>
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 text-left">Size</th>
              <th scope="col" className="pb-2 text-right">Prepared</th>
              <th scope="col" className="pb-2 text-right">Allocated</th>
              <th scope="col" className="pb-2 text-right">Available</th>
              <th scope="col" className="pb-2 pl-3 text-right">This batch</th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((size) => (
              <tr key={size.jobOrderLineSizeId} className="border-t border-border-subtle">
                <th scope="row" className="py-2 text-left font-medium">{size.sizeLabel}</th>
                <td className="py-2 text-right tabular-nums">{size.preparedQuantity}</td>
                <td className="py-2 text-right tabular-nums">{size.allocatedQuantity}</td>
                <td className="py-2 text-right tabular-nums">{size.availableQuantity}</td>
                <td className="py-2 pl-3">
                  <TextField
                    aria-label={`Final batch quantity for size ${size.sizeLabel}`}
                    type="number"
                    min={0}
                    max={size.availableQuantity}
                    step={1}
                    density="compact"
                    width="full"
                    className="text-right tabular-nums"
                    disabled={disabled || size.availableQuantity === 0}
                    value={values[size.jobOrderLineSizeId] ?? ''}
                    onChange={(event) => onChange(size.jobOrderLineSizeId, event.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end border-t border-border pt-2 text-sm font-medium">
        Total: <span className="ml-2 tabular-nums">{total}</span>
      </div>
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
    </div>
  );
}
