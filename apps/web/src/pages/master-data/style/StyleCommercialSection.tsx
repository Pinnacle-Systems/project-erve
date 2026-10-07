import { FormGrid, FormSection } from '@erve/layout';
import { SelectField, SelectItem, TextField } from '@erve/primitives';
import type { HsnOption } from '../types.js';
import {
  commercialFieldLayout,
  fieldLabels,
  styleFieldErrorMessage,
  type StyleFieldKey,
  type StyleFormFields,
} from './style-form-state.js';

const NO_HSN = 'NONE';

export interface StyleCommercialSectionProps {
  form: StyleFormFields;
  onFieldChange: (key: StyleFieldKey, value: string) => void;
  hsnId: string;
  onHsnChange: (value: string) => void;
  hsns: HsnOption[];
  /** Truthy once a save attempt has failed validation — same "error &&" gating the pre-restructure form used to decide whether to surface field-level errors. */
  error: string;
}

export function StyleCommercialSection({
  form,
  onFieldChange,
  hsnId,
  onHsnChange,
  hsns,
  error,
}: StyleCommercialSectionProps) {
  const hasError = Boolean(error);

  return (
    <FormSection title="Commercial & Tax">
      <FormGrid layout="content">
        {commercialFieldLayout.map(({ key, width }) => {
          if (key === 'hsn') {
            // ACTIVE options plus this Style's currently assigned HSN even
            // if it has since gone INACTIVE (INV-002 review correction) —
            // same pattern as the Season select above: an inactive master
            // must remain visible/selected on an existing Style without
            // being offered for a new assignment.
            return (
              <SelectField
                key="hsn"
                label="HSN"
                value={hsnId || NO_HSN}
                onValueChange={(value) => onHsnChange(value === NO_HSN ? '' : value)}
                width={width}
              >
                <SelectItem value={NO_HSN}>No HSN selected</SelectItem>
                {hsns
                  .filter((hsn) => hsn.status === 'ACTIVE' || hsn.id === hsnId)
                  .map((hsn) => (
                    <SelectItem key={hsn.id} value={hsn.id}>
                      {hsn.code}
                      {hsn.description ? ` — ${hsn.description}` : ''}
                      {hsn.status === 'INACTIVE' ? ' (inactive)' : ''}
                    </SelectItem>
                  ))}
              </SelectField>
            );
          }
          const fieldKey = key as StyleFieldKey;
          return (
            <TextField
              key={fieldKey}
              label={fieldLabels[fieldKey]}
              required={fieldKey === 'finalMrp'}
              type={fieldKey.includes('Mrp') || fieldKey.includes('Percentage') ? 'number' : 'text'}
              value={form[fieldKey]}
              width={width}
              errorMessage={styleFieldErrorMessage(fieldKey, form, hasError)}
              onChange={(event) => onFieldChange(fieldKey, event.target.value)}
            />
          );
        })}
      </FormGrid>
    </FormSection>
  );
}
