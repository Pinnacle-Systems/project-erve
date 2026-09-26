import { useState } from 'react';
import type { ApiSuccessResponse, UserOption } from '@erve/types';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useServerLookup } from '../../lib/use-server-lookup.js';

export const USER_LOOKUP_LIMIT = 20;

// Query-key prefix of one candidate endpoint's cached searches. Invalidate it
// after an assignment so the cached initial (empty-search) set can't keep
// offering a user who is no longer eligible.
export function userLookupQueryKey(searchPath: string): readonly unknown[] {
  return ['user-lookup', searchPath];
}

function getUserLabel(user: UserOption): string {
  return `${user.name} (${user.email})`;
}

function UserOptionRow({ user }: { user: UserOption }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-semibold">{user.name}</span>
      <span className="truncate text-muted-foreground">{user.email}</span>
    </div>
  );
}

export interface UserLookupFieldProps {
  // The context-specific candidate endpoint (?search=&limit= → UserOption[]),
  // e.g. /distributors/:id/user-options — eligibility is the server's rule.
  searchPath: string;
  label?: string;
  placeholder?: string;
  width?: LookupFieldWidth;
  value: UserOption | null;
  onChange: (user: UserOption | null) => void;
  disabled?: boolean;
  // Shown when the open panel has no eligible users at all.
  emptyMessage?: string;
  // Shown when a typed search matches nothing.
  noMatchMessage?: string;
}

// User-assignment lookup: a transient candidate picker over a bounded,
// context-specific server search by name or email. Opening the panel with no
// text shows the first eligible users; typing searches. Nothing is requested
// until the panel opens. Current assignments are shown by the page's own
// mapped-users table, so no selected-user-by-id hydration is needed.
export function UserLookupField({
  searchPath,
  label = 'Assign user',
  placeholder = 'Search name or email…',
  width = 'md',
  value,
  onChange,
  disabled,
  emptyMessage = 'No eligible users available',
  noMatchMessage = 'No eligible users match your search',
}: UserLookupFieldProps) {
  const [searchText, setSearchText] = useState('');
  const [open, setOpen] = useState(false);
  const lookup = useServerLookup<UserOption>({
    queryKey: userLookupQueryKey(searchPath),
    searchText,
    minLength: 0,
    enabled: open,
    fetchOptions: async (search, signal) => {
      const res = await apiClient.get<ApiSuccessResponse<UserOption[]>>(searchPath, {
        params: { search, limit: USER_LOOKUP_LIMIT },
        signal,
      });
      return res.data.data;
    },
  });

  return (
    <LookupField<UserOption>
      label={label}
      width={width}
      placeholder={placeholder}
      disabled={disabled}
      selectedOption={value}
      onSelect={onChange}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={lookup.options}
      getOptionKey={(user) => user.id}
      getOptionLabel={getUserLabel}
      renderOption={(user) => <UserOptionRow user={user} />}
      loading={lookup.loading}
      searchError={lookup.error ? getApiErrorMessage(lookup.error, 'Unable to search users') : null}
      emptyMessage={searchText.trim() ? noMatchMessage : emptyMessage}
      loadingMessage="Searching users…"
      onOpenChange={setOpen}
    />
  );
}
