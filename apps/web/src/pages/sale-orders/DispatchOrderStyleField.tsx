import { useState } from 'react';
import { LookupField, type LookupFieldWidth } from '@erve/primitives';
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

// DEMO-016/DEMO-003: the Factory's pooled inventory (already fetched for
// the page) is the sole source of "which Styles can this Dispatch Order
// actually allocate" — grouping it client-side here means the Style picker
// needs no separate network call or backend endpoint of its own.
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
  options: DispatchOrderStyleOption[];
  /** Styles already chosen elsewhere on this destination — excluded so the same Style can't be picked twice. */
  excludeStyleIds?: Set<string>;
  required?: boolean;
  errorMessage?: string;
}

// Client-side filtered (the Factory's pool is already loaded in full) —
// no server round trip, no separate style-options endpoint.
export function DispatchOrderStyleField({
  id,
  label = 'Style',
  width = 'lg',
  value,
  onChange,
  options,
  excludeStyleIds,
  required = true,
  errorMessage,
}: DispatchOrderStyleFieldProps) {
  const [searchText, setSearchText] = useState('');
  const available = excludeStyleIds ? options.filter((o) => !excludeStyleIds.has(o.styleId)) : options;
  const query = searchText.trim().toLowerCase();
  const filtered = query
    ? available.filter((o) => `${o.styleNumber} ${o.styleName}`.toLowerCase().includes(query))
    : available;

  return (
    <LookupField<DispatchOrderStyleOption>
      id={id}
      label={label}
      required={required}
      errorMessage={errorMessage}
      width={width}
      placeholder="Search Style Number or Name…"
      selectedOption={value}
      onSelect={onChange}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      options={filtered}
      getOptionKey={(style) => style.styleId}
      getOptionLabel={getStyleLabel}
      renderOption={(style) => <StyleOptionRow style={style} />}
      emptyMessage={
        available.length === 0
          ? 'No Styles with pooled stock at this Factory'
          : 'No Style matches your search'
      }
    />
  );
}
