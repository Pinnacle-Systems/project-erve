import { useState } from 'react';
import type { ApiSuccessResponse } from '@erve/types';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useServerLookup } from '../../lib/use-server-lookup.js';
import type { PriceListStyleCandidate } from './types.js';

// Same bounds as the Order Sheet Style lookup (P1L1).
export const PRICE_LIST_STYLE_LOOKUP_MIN_LENGTH = 2;
export const PRICE_LIST_STYLE_LOOKUP_LIMIT = 20;

function getStyleLabel(style: PriceListStyleCandidate): string {
  return [style.styleNumber, style.lmixNumber, style.styleName].filter(Boolean).join(' · ');
}

function StyleOptionRow({ style }: { style: PriceListStyleCandidate }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="truncate font-semibold">{style.styleNumber}</span>
        {style.lmixNumber ? (
          <span className="shrink-0 font-medium tabular-nums">{style.lmixNumber}</span>
        ) : null}
      </div>
      <div className="truncate text-muted-foreground">{style.styleName}</div>
    </div>
  );
}

export interface PriceListStyleLookupFieldProps {
  priceListId: string;
  label?: string;
  width?: LookupFieldWidth;
  value: PriceListStyleCandidate | null;
  onChange: (style: PriceListStyleCandidate | null) => void;
}

// Price List "Add Style" lookup: bounded server search over the Styles this
// price list can still add (GET /price-lists/:id/style-options — ACTIVE and
// not already priced here, filtered server-side before the limit). Keyed
// under ['price-list', id] so refreshing the price list after a line change
// also refreshes these results.
export function PriceListStyleLookupField({
  priceListId,
  label = 'Style',
  width = 'full',
  value,
  onChange,
}: PriceListStyleLookupFieldProps) {
  const [searchText, setSearchText] = useState('');
  const lookup = useServerLookup<PriceListStyleCandidate>({
    queryKey: ['price-list', priceListId, 'style-options', 'search'],
    searchText,
    minLength: PRICE_LIST_STYLE_LOOKUP_MIN_LENGTH,
    fetchOptions: async (search, signal) => {
      const res = await apiClient.get<ApiSuccessResponse<PriceListStyleCandidate[]>>(
        `/price-lists/${priceListId}/style-options`,
        { params: { search, limit: PRICE_LIST_STYLE_LOOKUP_LIMIT }, signal },
      );
      return res.data.data;
    },
  });

  return (
    <LookupField<PriceListStyleCandidate>
      label={label}
      width={width}
      placeholder="Search LMIX, Style No. or Style Name…"
      selectedOption={value}
      onSelect={onChange}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={lookup.options}
      getOptionKey={(style) => style.id}
      getOptionLabel={getStyleLabel}
      renderOption={(style) => <StyleOptionRow style={style} />}
      loading={lookup.loading}
      searchError={
        lookup.error ? getApiErrorMessage(lookup.error, 'Unable to search styles') : null
      }
      prompt={lookup.belowMinLength ? 'Type to search by LMIX, Style No. or Style Name' : null}
      emptyMessage="No active, unpriced Styles match — try another LMIX, Style No. or name"
      loadingMessage="Searching Styles…"
    />
  );
}
