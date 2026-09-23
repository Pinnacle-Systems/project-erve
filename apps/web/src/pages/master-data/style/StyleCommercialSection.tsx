import { FormGrid, FormSection } from '@erve/layout';
import { TextField } from '@erve/primitives';
import {
  commercialFieldLayout,
  fieldLabels,
  styleFieldErrorMessage,
  type StyleFieldKey,
  type StyleFormFields,
} from './style-form-state.js';

export interface StyleCommercialSectionProps {
  form: StyleFormFields;
  onFieldChange: (key: StyleFieldKey, value: string) => void;
  /** Truthy once a save attempt has failed validation — same "error &&" gating the pre-restructure form used to decide whether to surface field-level errors. */
  error: string;
}

export function StyleCommercialSection({ form, onFieldChange, error }: StyleCommercialSectionProps) {
  const hasError = Boolean(error);

  return (
    <FormSection title="Commercial & Tax">
      <FormGrid layout="content">
        {commercialFieldLayout.map(({ key, width }) => {
          const fieldKey = key as StyleFieldKey;
          return (
            <TextField
              key={fieldKey}
              label={fieldLabels[fieldKey]}
              type={fieldKey.includes('Mrp') || fieldKey.includes('Percentage') ? 'number' : 'text'}
              value={form[fieldKey]}
              width={width}
              maxLength={fieldKey === 'hsnCode' ? 8 : undefined}
              errorMessage={styleFieldErrorMessage(fieldKey, form, hasError)}
              onChange={(event) => onFieldChange(fieldKey, event.target.value)}
            />
          );
        })}
      </FormGrid>
    </FormSection>
  );
}
