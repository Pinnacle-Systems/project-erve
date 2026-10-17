import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import { TextField } from '@erve/primitives';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { StyleThumbnailCell } from '../../components/style/StyleThumbnailCell.js';
import type { PurchaseOrder } from '../purchase-orders/types.js';

function formatDate(iso: string | null) {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export interface OrderSheetMultiSelectFieldProps {
  label?: string;
  // The Job Order's fixed Style, once the first Order Sheet has been
  // selected — candidates outside this Style are filtered out server-side
  // (one Job Order = one Style, §5/§6/§18).
  styleId?: string;
  excludeIds: string[];
  onSelect: (orderSheet: PurchaseOrder) => void;
}

export function OrderSheetMultiSelectField({
  label = 'Add Order Sheet',
  styleId,
  excludeIds,
  onSelect,
}: OrderSheetMultiSelectFieldProps) {
  const [searchText, setSearchText] = useState('');
  const debouncedSearchText = useDebouncedValue(searchText, 300);
  const trimmedSearch = debouncedSearchText.trim();

  const searchQuery = useQuery({
    queryKey: ['order-sheets-lookup', trimmedSearch, styleId],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<PurchaseOrder>>>(
        '/purchase-orders',
        { params: { search: trimmedSearch || undefined, planningState: 'AVAILABLE', styleId, limit: 10 } },
      );
      return res.data.data;
    },
  });

  const results = (searchQuery.data?.items ?? []).filter((po) => !excludeIds.includes(po.id));

  return (
    <div className="relative flex flex-col gap-1.5">
      <TextField
        label={label}
        placeholder="Search by Order Sheet number..."
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        autoComplete="off"
        width="fill"
      />
      <div className="w-full overflow-hidden rounded-md border border-border bg-surface">
        {searchQuery.isLoading && <LoadingState density="compact" label="Loading Order Sheets" />}
        {searchQuery.isError && (
          <ErrorState
            title="Unable to search Order Sheets"
            description={searchQuery.error instanceof Error ? searchQuery.error.message : 'Please try again.'}
          />
        )}
        {searchQuery.data && results.length === 0 && (
          <EmptyState
            density="compact"
            title="No eligible Order Sheets"
            description={
              styleId
                ? 'No other available Order Sheets match this Job Order’s Style.'
                : 'No available Order Sheets match this search.'
            }
          />
        )}
        {results.length > 0 && (
          <div className="max-h-72 overflow-y-auto py-1">
            {results.map((po) => (
              <div
                key={po.id}
                className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--erp-surface-hover)]"
              >
                {po.lines[0] && (
                  <div className="shrink-0">
                    <StyleThumbnailCell
                      styleId={po.lines[0].styleId}
                      image={po.lines[0].primaryImage ?? null}
                      viewerTitle={po.lines[0].styleNumber}
                      size={32}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onSelect(po);
                    setSearchText('');
                  }}
                  className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left focus:bg-[var(--erp-surface-hover)] focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <span className="text-sm font-medium text-foreground">{po.poNumber}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{po.distributor.name}</span>
                    <span aria-hidden="true">·</span>
                    <StatusBadge
                      label={po.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale Return'}
                      tone={po.purchaseMode === 'OUTRIGHT' ? 'info' : 'pending'}
                    />
                    <span aria-hidden="true">·</span>
                    <span>Required: {formatDate(po.requiredDeliveryDate)}</span>
                    {po.lines[0] && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {po.lines[0].styleNumber} {po.lines[0].styleName}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
