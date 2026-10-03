import { Checkbox, FieldGroup, TextField } from '@erve/primitives';
import type { SizeOption } from '../types.js';

export interface StyleSizesFieldProps {
  sizes: SizeOption[];
  selectedSizeIds: string[];
  onChange: (sizeIds: string[]) => void;
  /**
   * Barcode entry per Style + Size. Omit to hide it (the field is then just
   * the size picker). The server is authoritative: a blank value for a size
   * that has no barcode yet means "generate on save" - the web never computes it.
   */
  barcodes?: {
    /** Current input value by size id. */
    values: Record<string, string>;
    /** Barcode already persisted by size id (absent/null = none yet). */
    saved: Record<string, string | null>;
    onChange: (sizeId: string, value: string) => void;
    /** Size id -> inline error. */
    errors?: Record<string, string>;
  };
}

export function StyleSizesField({ sizes, selectedSizeIds, onChange, barcodes }: StyleSizesFieldProps) {
  return (
    <FieldGroup label="Valid Sizes">
      <div className="grid gap-2 md:grid-cols-4">
        {sizes.map((size) => {
          const selected = selectedSizeIds.includes(size.id);
          const saved = barcodes?.saved[size.id] ?? null;
          return (
            <div
              key={size.id}
              className="flex flex-col gap-2 rounded-control border border-border-subtle bg-surface-muted p-2 text-sm text-foreground"
            >
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked === true
                        ? [...selectedSizeIds, size.id]
                        : selectedSizeIds.filter((sizeId) => sizeId !== size.id),
                    )
                  }
                />
                {size.code}
              </label>
              {barcodes && selected ? (
                <TextField
                  label="Barcode"
                  density="compact"
                  width="full"
                  value={barcodes.values[size.id] ?? ''}
                  placeholder={saved ? undefined : 'Auto-generated on save'}
                  errorMessage={barcodes.errors?.[size.id]}
                  onChange={(event) => barcodes.onChange(size.id, event.target.value)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </FieldGroup>
  );
}
