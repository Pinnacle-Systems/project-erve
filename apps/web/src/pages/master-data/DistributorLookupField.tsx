import { useState } from 'react';
import type { ApiSuccessResponse, DistributorOption } from '@erve/types';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useServerLookup } from '../../lib/use-server-lookup.js';

export const DISTRIBUTOR_LOOKUP_MIN_LENGTH = 1;
export const DISTRIBUTOR_LOOKUP_LIMIT = 20;
export const DISTRIBUTOR_OPTIONS_PATH = '/distributors/options';

// What the field needs to display a value. A saved record often embeds only
// id/name (plus code), so status/purchaseMode are optional until known.
export type DistributorLookupValue = Pick<DistributorOption, 'id' | 'name'> &
  Partial<Pick<DistributorOption, 'code' | 'status' | 'purchaseMode'>>;

function isInactive(distributor: DistributorLookupValue): boolean {
  return distributor.status !== undefined && distributor.status !== 'ACTIVE';
}

function getDistributorLabel(distributor: DistributorLookupValue): string {
  return `${distributor.name}${isInactive(distributor) ? ' (inactive)' : ''}`;
}

function DistributorOptionRow({ distributor }: { distributor: DistributorOption }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-semibold">{distributor.name}</span>
      <span className="shrink-0 text-muted-foreground">{distributor.code}</span>
    </div>
  );
}

export interface DistributorLookupFieldProps {
  label?: string;
  'aria-label'?: string;
  id?: string;
  placeholder?: string;
  width?: LookupFieldWidth;
  value: DistributorLookupValue | null;
  onChange: (distributor: DistributorOption | null) => void;
  // Distributors that may not be picked here (e.g. already chosen by another
  // group on the same form). The server still validates.
  excludeIds?: ReadonlySet<string>;
  // A module-specific search endpoint with the same contract
  // (?search=&limit= → DistributorOption[]) when that module's authorization
  // or eligibility differs from the Distributor master's.
  searchPath?: string;
  errorMessage?: string;
  disabled?: boolean;
}

// Distributor lookup: bounded server search over ACTIVE Distributors by name
// or code (GET /distributors/options by default). The current value is shown
// from `value`, never looked up in the results, so a saved Distributor
// displays even when it has since become inactive.
export function DistributorLookupField({
  label,
  'aria-label': ariaLabel,
  id,
  placeholder = 'Search distributor name or code…',
  width = 'md',
  value,
  onChange,
  excludeIds,
  searchPath = DISTRIBUTOR_OPTIONS_PATH,
  errorMessage,
  disabled,
}: DistributorLookupFieldProps) {
  const [searchText, setSearchText] = useState('');
  const lookup = useServerLookup<DistributorOption>({
    queryKey: ['distributor-lookup', searchPath],
    searchText,
    minLength: DISTRIBUTOR_LOOKUP_MIN_LENGTH,
    fetchOptions: async (search, signal) => {
      const res = await apiClient.get<ApiSuccessResponse<DistributorOption[]>>(searchPath, {
        params: { search, limit: DISTRIBUTOR_LOOKUP_LIMIT },
        signal,
      });
      return res.data.data;
    },
  });
  const options = excludeIds
    ? lookup.options.filter((option) => !excludeIds.has(option.id) || option.id === value?.id)
    : lookup.options;

  return (
    <LookupField<DistributorLookupValue>
      label={label}
      aria-label={ariaLabel}
      id={id}
      width={width}
      placeholder={placeholder}
      disabled={disabled}
      errorMessage={errorMessage}
      selectedOption={value}
      // Anything selectable came from `lookup.options`, i.e. a full option.
      onSelect={(distributor) => onChange(distributor as DistributorOption | null)}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={options}
      getOptionKey={(distributor) => distributor.id}
      getOptionLabel={getDistributorLabel}
      renderOption={(distributor) => (
        <DistributorOptionRow distributor={distributor as DistributorOption} />
      )}
      loading={lookup.loading}
      searchError={
        lookup.error ? getApiErrorMessage(lookup.error, 'Unable to search distributors') : null
      }
      prompt={lookup.belowMinLength ? 'Type to search by distributor name or code' : null}
      emptyMessage="No active distributors match — try another name or code"
      loadingMessage="Searching distributors…"
      helpText={value && isInactive(value) ? 'This distributor is no longer active.' : undefined}
    />
  );
}
