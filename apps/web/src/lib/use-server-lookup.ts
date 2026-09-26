import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from './use-debounced-value.js';

export const LOOKUP_DEBOUNCE_MS = 300;

export interface ServerLookupOptions<T> {
  // Query-key prefix for this lookup; the debounced search text is appended.
  queryKey: readonly unknown[];
  // Raw (un-debounced) text from the lookup textbox.
  searchText: string;
  fetchOptions: (search: string, signal: AbortSignal) => Promise<T[]>;
  // Below this many (trimmed) characters no request is made and
  // `belowMinLength` is reported instead. 0 makes the empty text a real
  // search (the bounded initial options) — pair it with `enabled` tied to
  // the panel being open so nothing is fetched merely on mount.
  minLength?: number;
  debounceMs?: number;
  enabled?: boolean;
}

export interface ServerLookupResult<T> {
  options: T[];
  // A search for the current text is pending (debouncing or in flight). The
  // `options` shown meanwhile are the previous search's and must not be
  // committed by keyboard.
  loading: boolean;
  error: Error | null;
  belowMinLength: boolean;
}

// Debounced, bounded server search for a LookupField. Entity-agnostic: the
// caller supplies the endpoint call. Only the debounced text reaches the
// query key, TanStack's AbortSignal cancels superseded requests, and each
// result set is cached under its own text — so typing never produces a
// request storm and a late response can't overwrite a newer search's rows.
export function useServerLookup<T>({
  queryKey,
  searchText,
  fetchOptions,
  minLength = 1,
  debounceMs = LOOKUP_DEBOUNCE_MS,
  enabled = true,
}: ServerLookupOptions<T>): ServerLookupResult<T> {
  const trimmed = searchText.trim();
  const debounced = useDebouncedValue(trimmed, debounceMs);
  const belowMinLength = trimmed.length < minLength;
  const debouncedSearchable = debounced.length >= minLength;
  // With minLength 0, typing the first characters would otherwise run the
  // empty-text search the debounce still holds — a request nobody asked for.
  const staleEmptySearch = debounced === '' && trimmed !== '';

  const query = useQuery({
    queryKey: [...queryKey, debounced],
    enabled: enabled && debouncedSearchable && !staleEmptySearch,
    queryFn: ({ signal }) => fetchOptions(debounced, signal),
    // Keep the previous rows visible (flagged as loading) while the next
    // search runs, instead of flashing an empty panel on every keystroke.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  if (belowMinLength || !enabled) {
    return { options: [], loading: false, error: null, belowMinLength };
  }

  const debouncing = trimmed !== debounced;
  const loading = debouncing || query.isPending || query.isPlaceholderData;
  return {
    options: query.data ?? [],
    loading,
    error: !loading && query.isError ? query.error : null,
    belowMinLength,
  };
}
