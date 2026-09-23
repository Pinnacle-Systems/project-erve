import { FormGrid, FormSection } from '@erve/layout';
import { SelectField, SelectItem, TextField } from '@erve/primitives';
import type { Season, Status } from '../types.js';
import {
  fieldLabels,
  identityFieldLayout,
  styleFieldErrorMessage,
  type StyleFieldKey,
  type StyleFormFields,
} from './style-form-state.js';

export interface StyleIdentitySectionProps {
  form: StyleFormFields;
  onFieldChange: (key: StyleFieldKey, value: string) => void;
  seasonId: string;
  onSeasonChange: (value: string) => void;
  seasons: Season[];
  /** Truthy once a save attempt has failed validation — same "error &&" gating the pre-restructure form used to decide whether to surface field-level errors. */
  error: string;
}

export function StyleIdentitySection({
  form,
  onFieldChange,
  seasonId,
  onSeasonChange,
  seasons,
  error,
}: StyleIdentitySectionProps) {
  const hasError = Boolean(error);

  return (
    <FormSection title="Identity & Classification">
      <FormGrid layout="content">
        {identityFieldLayout.map(({ key, width }) => {
          if (key === 'season') {
            return (
              <SelectField
                key="season"
                label="Season *"
                value={seasonId || 'NONE'}
                onValueChange={(value) => onSeasonChange(value === 'NONE' ? '' : value)}
                errorMessage={hasError && !seasonId ? 'Season is required.' : undefined}
                width={width}
              >
                <SelectItem value="NONE">Select season</SelectItem>
                {seasons
                  .filter((season) => season.status === 'ACTIVE' || season.id === seasonId)
                  .map((season) => (
                    <SelectItem key={season.id} value={season.id}>
                      {season.displayName} — {season.name}
                      {season.status === 'INACTIVE' ? ' (inactive)' : ''}
                    </SelectItem>
                  ))}
              </SelectField>
            );
          }
          if (key === 'status') {
            return (
              <SelectField
                key={key}
                label="Status"
                value={form.status}
                onValueChange={(value) => onFieldChange('status', value as Status)}
                width={width}
              >
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectField>
            );
          }
          const fieldKey = key as StyleFieldKey;
          return (
            <TextField
              key={fieldKey}
              label={fieldLabels[fieldKey]}
              type="text"
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
