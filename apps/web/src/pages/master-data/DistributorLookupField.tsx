import { useState } from 'react';
import type { ApiSuccessResponse, DistributorOption } from '@erve/types';
import type { Density } from '@erve/theme';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useServerLookup } from '../../lib/use-server-lookup.js';

export const DISTRIBUTOR_LOOKUP_LIMIT = 20;
// Every option endpoint's maximum `limit` (/distributors/options,
// /price-lists/distributor-options, /sale-orders/distributor-options).
export const DISTRIBUTOR_LOOKUP_MAX_LIMIT = 50;
export const DISTRIBUTOR_OPTIONS_PATH = '/distributors/options';

// What the field needs to display a value. A saved record often embeds only
// id/name (plus code), so status/purchaseMode are optional until known.
export type DistributorLookupValue = Pick<DistributorOption, 'id' | 'name'> &
  Partial<Pick<DistributorOption, 'code' | 'status' | 'purchaseMode'>>;

// The least a search result must carry. Module-specific option endpoints
// (Price Lists, Dispatch Order filters) return this without purchaseMode.
export type DistributorLookupOption = Pick<DistributorOption, 'id' | 'code' | 'name' | 'status'>;

function isInactive(distributor: DistributorLookupValue): boolean {
  return distributor.status !== undefined && distributor.status !== 'ACTIVE';
}

function getDistributorLabel(distributor: DistributorLookupValue): string {
  return `${distributor.name}${isInactive(distributor) ? ' (inactive)' : ''}`;
}

function DistributorOptionRow({ distributor }: { distributor: DistributorLookupOption }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-semibold">{distributor.name}</span>
      <span className="shrink-0 text-muted-foreground">{distributor.code}</span>
      {distributor.status !== 'ACTIVE' ? (
        <span className="shrink-0 text-muted-foreground">(inactive)</span>
      ) : null}
    </div>
  );
}

export interface DistributorLookupFieldProps<
  T extends DistributorLookupOption = DistributorOption,
> {
  label?: string;
  'aria-label'?: string;
  id?: string;
  placeholder?: string;
  width?: LookupFieldWidth;
  density?: Density;
  value: DistributorLookupValue | null;
  // T is set explicitly for a module endpoint; otherwise it stays DistributorOption.
  onChange: (distributor: NoInfer<T> | null) => void;
  // Distributors that may not be picked here (e.g. already chosen by another
  // group on the same form). The server still validates.
  excludeIds?: ReadonlySet<string>;
  // A module-specific search endpoint with the same contract
  // (?search=&limit= → T[]) when that module's authorization or eligibility
  // differs from the Distributor master's.
  searchPath?: string;
  // Extra fixed query parameters for `searchPath` (e.g. a module endpoint's
  // own status filter).
  searchParams?: Readonly<Record<string, string>>;
  // Shown when the open panel has no rows for an empty search.
  emptyMessage?: string;
  // Shown when a typed search matches nothing.
  noMatchMessage?: string;
  errorMessage?: string;
  disabled?: boolean;
  required?: boolean;
}

// Distributor lookup: bounded server search over ACTIVE Distributors by name
// or code (GET /distributors/options by default). Opening the panel with no
// text shows the first eligible Distributors; typing searches. Nothing is
// requested until the panel opens. The current value is shown from `value`,
// never looked up in the results, so a saved Distributor displays even when
// it has since become inactive.
export function DistributorLookupField<T extends DistributorLookupOption = DistributorOption>({
  label,
  'aria-label': ariaLabel,
  id,
  placeholder = 'Search distributor name or code…',
  width = 'md',
  density,
  value,
  onChange,
  excludeIds,
  searchPath = DISTRIBUTOR_OPTIONS_PATH,
  searchParams,
  emptyMessage = 'No active distributors available',
  noMatchMessage = 'No distributors match your search',
  errorMessage,
  disabled,
  required,
}: DistributorLookupFieldProps<T>) {
  const [searchText, setSearchText] = useState('');
  const [open, setOpen] = useState(false);
  // Excluded ids are filtered here, after the server's limit, so over-fetch
  // by that many to still offer up to DISTRIBUTOR_LOOKUP_LIMIT usable rows.
  const excludedCount = excludeIds
    ? [...excludeIds].filter((excludedId) => excludedId && excludedId !== value?.id).length
    : 0;
  const limit = Math.min(DISTRIBUTOR_LOOKUP_LIMIT + excludedCount, DISTRIBUTOR_LOOKUP_MAX_LIMIT);
  const lookup = useServerLookup<T>({
    queryKey: ['distributor-lookup', searchPath, searchParams ?? {}, limit],
    searchText,
    minLength: 0,
    enabled: open,
    fetchOptions: async (search, signal) => {
      const res = await apiClient.get<ApiSuccessResponse<T[]>>(searchPath, {
        params: { ...searchParams, search, limit },
        signal,
      });
      return res.data.data;
    },
  });
  const options = excludeIds
    ? lookup.options
        .filter((option) => !excludeIds.has(option.id) || option.id === value?.id)
        .slice(0, DISTRIBUTOR_LOOKUP_LIMIT)
    : lookup.options;

  return (
    <LookupField<DistributorLookupValue>
      label={label}
      aria-label={ariaLabel}
      id={id}
      width={width}
      density={density}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      errorMessage={errorMessage}
      selectedOption={value}
      // Anything selectable came from `lookup.options`, i.e. a full option.
      onSelect={(distributor) => onChange(distributor as T | null)}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={options}
      getOptionKey={(distributor) => distributor.id}
      getOptionLabel={getDistributorLabel}
      renderOption={(distributor) => <DistributorOptionRow distributor={distributor as T} />}
      loading={lookup.loading}
      searchError={
        lookup.error ? getApiErrorMessage(lookup.error, 'Unable to search distributors') : null
      }
      emptyMessage={searchText.trim() ? noMatchMessage : emptyMessage}
      loadingMessage="Searching distributors…"
      onOpenChange={setOpen}
    />
  );
}
