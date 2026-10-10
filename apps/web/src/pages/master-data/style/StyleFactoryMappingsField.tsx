import { FormSection, Stack } from '@erve/layout';
import { Button, NumericField, SelectField, SelectItem } from '@erve/primitives';
import type { FactoryOption } from '../types.js';

export interface StyleFactoryMappingRow {
  /** Stable per-row id, generated once when the row is added — never the array index, so removing
   * a row in the middle doesn't cause React to reuse another row's DOM node/input focus. */
  rowId: string;
  factoryId: string;
  exFactoryPrice: string;
}

export interface StyleFactoryMappingsFieldProps {
  mappings: StyleFactoryMappingRow[];
  availableFactories: FactoryOption[];
  onChange: (mappings: StyleFactoryMappingRow[]) => void;
}

let rowIdCounter = 0;
export function nextFactoryMappingRowId(): string {
  rowIdCounter += 1;
  return `row-${rowIdCounter}-${Date.now()}`;
}

export function StyleFactoryMappingsField({
  mappings,
  availableFactories,
  onChange,
}: StyleFactoryMappingsFieldProps) {
  return (
    <FormSection
      title="Factory Mappings"
      actions={
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange([
              ...mappings,
              { rowId: nextFactoryMappingRowId(), factoryId: '', exFactoryPrice: '' },
            ])
          }
        >
          Add Factory
        </Button>
      }
    >
      <Stack gap="sm">
        {mappings.length > 0 && (
          <div className="grid gap-3 md:grid-cols-[1fr_160px_100px] text-xs font-semibold text-muted-foreground px-0.5">
            <span>Factory</span>
            <span>Ex-Factory Rate (₹)</span>
            <span>Action</span>
          </div>
        )}
        {mappings.map((mapping) => (
          <div key={mapping.rowId} className="grid gap-3 md:grid-cols-[1fr_160px_100px] items-center">
            <SelectField
              aria-label="Factory"
              value={mapping.factoryId || 'NONE'}
              onValueChange={(value) =>
                onChange(
                  mappings.map((item) =>
                    item.rowId === mapping.rowId
                      ? { ...item, factoryId: value === 'NONE' ? '' : value }
                      : item,
                  ),
                )
              }
              width="fill"
            >
              <SelectItem value="NONE">Select factory</SelectItem>
              {availableFactories.map((factory) => (
                <SelectItem key={factory.id} value={factory.id}>
                  {factory.name}
                </SelectItem>
              ))}
            </SelectField>
            <NumericField
              mode="currency"
              min={0}
              aria-label="Ex-Factory Rate (₹)"
              placeholder="0.00"
              // exFactoryPrice stays a string end-to-end (unchanged contract
              // with style-form-state.ts/StyleFormPage.tsx — both still do
              // their own Number()/String() conversion at their boundary);
              // NumericField only needs number|null at its own edge.
              value={mapping.exFactoryPrice === '' ? null : Number(mapping.exFactoryPrice)}
              onChange={(next) =>
                onChange(
                  mappings.map((item) =>
                    item.rowId === mapping.rowId
                      ? { ...item, exFactoryPrice: next === null ? '' : String(next) }
                      : item,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => onChange(mappings.filter((item) => item.rowId !== mapping.rowId))}
            >
              Remove
            </Button>
          </div>
        ))}
      </Stack>
    </FormSection>
  );
}
