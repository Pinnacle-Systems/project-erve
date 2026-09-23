import { Checkbox, FieldGroup } from '@erve/primitives';
import type { Size } from '../types.js';

export interface StyleSizesFieldProps {
  sizes: Size[];
  selectedSizeIds: string[];
  onChange: (sizeIds: string[]) => void;
}

export function StyleSizesField({ sizes, selectedSizeIds, onChange }: StyleSizesFieldProps) {
  return (
    <FieldGroup label="Valid Sizes">
      <div className="grid gap-2 md:grid-cols-4">
        {sizes.map((size) => (
          <label
            key={size.id}
            className="flex items-center gap-2 rounded-control border border-border-subtle bg-surface-muted p-2 text-sm text-foreground"
          >
            <Checkbox
              checked={selectedSizeIds.includes(size.id)}
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
        ))}
      </div>
    </FieldGroup>
  );
}
