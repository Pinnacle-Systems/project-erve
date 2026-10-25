import { useState } from 'react';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
import type { ApiSuccessResponse, PooledInventoryStylePage } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { usePaginatedServerLookup } from '../../lib/use-paginated-server-lookup.js';
import { StyleThumbnailCell } from '../../components/style/StyleThumbnailCell.js';
import type { PooledFactoryInventoryLine } from './types.js';

export interface DispatchOrderStyleSize {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sizeSortOrder: number;
  availableQuantity: number | null;
}

export interface DispatchOrderStyleOption {
  styleId: string;
  styleNumber: string;
  styleName: string;
  primaryImage: PooledFactoryInventoryLine['primaryImage'];
  sizes: DispatchOrderStyleSize[];
}

// Groups only the independently hydrated selected Style pools for previews.
export function groupPooledStylesForFactory(pool: PooledFactoryInventoryLine[]): DispatchOrderStyleOption[] {
  const byStyle = new Map<string, DispatchOrderStyleOption>();
  for (const row of pool) {
    let style = byStyle.get(row.styleId);
    if (!style) {
      style = {
        styleId: row.styleId,
        styleNumber: row.styleNumber,
        styleName: row.styleName,
        primaryImage: row.primaryImage,
        sizes: [],
      };
      byStyle.set(row.styleId, style);
    }
    style.sizes.push({
      sizeId: row.sizeId,
      sizeCode: row.sizeCode,
      sizeLabel: row.sizeLabel,
      sizeSortOrder: row.sizeSortOrder,
      availableQuantity: row.availableQuantity,
    });
  }
  for (const style of byStyle.values()) style.sizes.sort((a, b) => a.sizeSortOrder - b.sizeSortOrder);
  return [...byStyle.values()].sort((a, b) => a.styleNumber.localeCompare(b.styleNumber));
}

function getStyleLabel(style: DispatchOrderStyleOption): string {
  return [style.styleNumber, style.styleName].filter(Boolean).join(' · ');
}

// Style No. leads (names repeat across Styles), with a separate, accessible
// preview action on the thumbnail — clicking it inspects the full-resolution
// image without selecting the row (StyleThumbnailCell's own button stops
// propagation and never blurs/closes the panel).
function StyleOptionRow({ style }: { style: DispatchOrderStyleOption }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StyleThumbnailCell styleId={style.styleId} image={style.primaryImage} size={32} viewerTitle={style.styleNumber} />
      <div className="min-w-0">
        <div className="truncate font-semibold">{style.styleNumber}</div>
        <div className="truncate text-muted-foreground">{style.styleName}</div>
      </div>
    </div>
  );
}

export interface DispatchOrderStyleFieldProps {
  id?: string;
  label?: string;
  width?: LookupFieldWidth;
  value: DispatchOrderStyleOption | null;
  onChange: (style: DispatchOrderStyleOption | null) => void;
  factoryId: string;
  excludeSaleOrderId?: string;
  /** Styles already chosen elsewhere on this destination — excluded so the same Style can't be picked twice. */
  excludeStyleIds?: Set<string>;
  required?: boolean;
  errorMessage?: string;
}

export function DispatchOrderStyleField({
  factoryId,
  excludeSaleOrderId,
  ...props
}: DispatchOrderStyleFieldProps) {
  // A new context remount cancels the old observer and resets panel/search.
  return <ScopedDispatchOrderStyleField key={`${factoryId}:${excludeSaleOrderId ?? ''}`} factoryId={factoryId} excludeSaleOrderId={excludeSaleOrderId} {...props} />;
}

function ScopedDispatchOrderStyleField({
  id,
  label = 'Style',
  width = 'lg',
  value,
  onChange,
  factoryId,
  excludeSaleOrderId,
  excludeStyleIds,
  required = true,
  errorMessage,
}: DispatchOrderStyleFieldProps) {
  const [searchText, setSearchText] = useState('');
  const [open, setOpen] = useState(false);
  const lookup = usePaginatedServerLookup({
    queryKey: ['job-orders', 'pooled-inventory', 'style-options', factoryId, excludeSaleOrderId],
    searchText,
    enabled: open && Boolean(factoryId),
    getKey: (style: DispatchOrderStyleOption) => style.styleId,
    fetchPage: async (search, cursor, signal) => {
      const res = await apiClient.get<ApiSuccessResponse<PooledInventoryStylePage>>('/job-orders/pooled-inventory/style-options', {
        params: { factoryId, search, excludeSaleOrderId, limit: 20, cursor }, signal,
      });
      return { ...res.data.data, items: res.data.data.items.map(s => ({ ...s, sizes: [] })) };
    },
  });
  const filtered = lookup.options.filter(o => !excludeStyleIds?.has(o.styleId));

  return (
    <LookupField<DispatchOrderStyleOption>
      id={id}
      label={label}
      required={required}
      errorMessage={errorMessage}
      width={width}
      placeholder="Search Style Number, LMIX or Name…"
      selectedOption={value}
      onSelect={onChange}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={filtered}
      keepOpenOnDialogFocus
      onOpenChange={setOpen}
      loading={lookup.loading}
      searchError={lookup.isError && !lookup.isFetchNextPageError ? 'Unable to load Styles. Retry the search.' : null}
      panelActions={lookup.isError ? (
        <div>
          {lookup.isFetchNextPageError && <p role="alert">Unable to load more Styles. Retry to continue.</p>}
          <button type="button" onClick={() => { if (lookup.isFetchNextPageError) void lookup.fetchNextPage(); else void lookup.refetch(); }}>Retry</button>
        </div>
      ) : lookup.hasNextPage && !lookup.loading ? (
        <button type="button" aria-disabled={lookup.isFetchingNextPage} onClick={() => { if (!lookup.isFetchingNextPage) void lookup.fetchNextPage(); }}>
          {lookup.isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </button>
      ) : undefined}
      getOptionKey={(style) => style.styleId}
      getOptionLabel={getStyleLabel}
      renderOption={(style) => <StyleOptionRow style={style} />}
      emptyMessage="No eligible Styles match this search at this Factory"
    />
  );
}
