import { useState } from 'react';
import type { ApiSuccessResponse, OrderSheetStyleOption } from '@erve/types';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useServerLookup } from '../../lib/use-server-lookup.js';

// Two characters is enough for a useful LMIX/Style No. fragment while
// keeping single keystrokes from matching most of the master.
export const STYLE_LOOKUP_MIN_LENGTH = 2;
export const STYLE_LOOKUP_LIMIT = 20;

// What the field needs to display a value. A saved Order Sheet line carries
// only id/styleNumber/styleName, so LMIX/status/season are optional until
// the selected Style's own record has loaded.
export type StyleLookupValue = Pick<OrderSheetStyleOption, 'id' | 'styleNumber' | 'styleName'> &
  Partial<Pick<OrderSheetStyleOption, 'lmixNumber' | 'status' | 'season'>>;

function isInactive(style: StyleLookupValue): boolean {
  return style.status !== undefined && style.status !== 'ACTIVE';
}

function getStyleLabel(style: StyleLookupValue): string {
  const parts = [style.styleNumber, style.lmixNumber, style.styleName].filter(Boolean);
  return `${parts.join(' · ')}${isInactive(style) ? ' (inactive)' : ''}`;
}

// Style No. and LMIX lead: real Style names repeat (e.g. five "Boy's T-
// Shirt"s), so the name alone can't tell matches apart.
function StyleOptionRow({ style }: { style: StyleLookupValue }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="truncate font-semibold">{style.styleNumber}</span>
        {style.lmixNumber ? (
          <span className="shrink-0 font-medium tabular-nums">{style.lmixNumber}</span>
        ) : null}
      </div>
      <div className="truncate text-muted-foreground">
        {[style.styleName, style.season?.displayName].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

export interface StyleLookupFieldProps {
  label?: string;
  width?: LookupFieldWidth;
  value: StyleLookupValue | null;
  onChange: (style: OrderSheetStyleOption | null) => void;
}

// Order Sheet Style lookup: bounded server search over ACTIVE Styles by
// LMIX, Style No. or Style Name (GET /purchase-orders/style-options). The
// current value is shown from `value`, never looked up in the results, so a
// saved Style displays even when it has since become inactive.
export function StyleLookupField({
  label = 'Style *',
  width = 'lg',
  value,
  onChange,
}: StyleLookupFieldProps) {
  const [searchText, setSearchText] = useState('');
  const lookup = useServerLookup<OrderSheetStyleOption>({
    queryKey: ['purchase-orders', 'style-options', 'search'],
    searchText,
    minLength: STYLE_LOOKUP_MIN_LENGTH,
    fetchOptions: async (search, signal) => {
      const res = await apiClient.get<ApiSuccessResponse<OrderSheetStyleOption[]>>(
        '/purchase-orders/style-options',
        { params: { search, limit: STYLE_LOOKUP_LIMIT }, signal },
      );
      return res.data.data;
    },
  });

  return (
    <LookupField<StyleLookupValue>
      label={label}
      width={width}
      placeholder="Search LMIX, Style No. or Style Name…"
      selectedOption={value}
      // Anything selectable came from `lookup.options`, i.e. a full option.
      onSelect={(style) => onChange(style as OrderSheetStyleOption | null)}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={lookup.options}
      getOptionKey={(style) => style.id}
      getOptionLabel={getStyleLabel}
      renderOption={(style) => <StyleOptionRow style={style} />}
      loading={lookup.loading}
      searchError={
        lookup.error ? getApiErrorMessage(lookup.error, 'Unable to search Styles.') : null
      }
      prompt={lookup.belowMinLength ? 'Type to search by LMIX, Style No. or Style Name' : null}
      emptyMessage="No active Styles match — try another LMIX, Style No. or name"
      loadingMessage="Searching Styles…"
      helpText={
        value && isInactive(value)
          ? 'This Style is no longer active — choose an active Style to save.'
          : undefined
      }
    />
  );
}
