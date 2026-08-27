import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse, PurchaseOrderDetail, PurchaseOrderStatus } from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import { Button, TextField } from '@erve/primitives';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  PARTIALLY_JOB_ORDERED: 'Partially Job Ordered',
  FULLY_JOB_ORDERED: 'Fully Job Ordered',
  PARTIALLY_FULFILLED: 'Partially Fulfilled',
  FULLY_FULFILLED: 'Fully Fulfilled',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

function statusTone(status: PurchaseOrderStatus) {
  if (status === 'DRAFT') return 'draft';
  if (status === 'SUBMITTED') return 'submitted';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'CLOSED') return 'posted';
  if (status.includes('FULFILLED')) return 'success';
  if (status.includes('JOB_ORDERED')) return 'info';
  return 'pending';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export interface PurchaseOrderLookupValue {
  id: string;
  poNumber: string;
}

export interface PurchaseOrderLookupFieldProps {
  label?: string;
  selected: PurchaseOrderLookupValue | null;
  onSelect: (purchaseOrder: PurchaseOrderLookupValue) => void;
  onClear: () => void;
}

export function PurchaseOrderLookupField({
  label = 'Purchase Order',
  selected,
  onSelect,
  onClear,
}: PurchaseOrderLookupFieldProps) {
  const [searchText, setSearchText] = useState('');
  const debouncedSearchText = useDebouncedValue(searchText, 300);
  const trimmedSearch = debouncedSearchText.trim();

  const searchQuery = useQuery({
    queryKey: ['purchase-orders-lookup', trimmedSearch],
    enabled: !selected && trimmedSearch.length > 0,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<PurchaseOrderDetail>>>(
        '/purchase-orders',
        { params: { search: trimmedSearch, limit: 8 } },
      );
      return res.data.data;
    },
  });

  if (selected) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--erp-form-label-color)]">{label}</span>
        <div className="flex h-control items-center justify-between rounded-control border border-[var(--erp-form-field-border)] bg-surface-raised px-[var(--erp-control-padding-x)]">
          <span className="text-control text-foreground">
            {selected.poNumber || 'Loading purchase order…'}
          </span>
          <Button
            type="button"
            variant="secondary"
            density="compact"
            onClick={() => {
              setSearchText('');
              onClear();
            }}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <TextField
        label={label}
        placeholder="Search by PO number..."
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        autoComplete="off"
        width="fill"
      />
      {trimmedSearch.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-popover">
          {searchQuery.isLoading && (
            <LoadingState density="compact" label="Searching purchase orders" />
          )}
          {searchQuery.isError && (
            <ErrorState
              title="Unable to search purchase orders"
              description={
                searchQuery.error instanceof Error
                  ? searchQuery.error.message
                  : 'Please try again.'
              }
            />
          )}
          {searchQuery.data && searchQuery.data.items.length === 0 && (
            <EmptyState
              density="compact"
              title="No matches"
              description={`No purchase orders match "${trimmedSearch}"`}
            />
          )}
          {searchQuery.data && searchQuery.data.items.length > 0 && (
            <div className="max-h-72 overflow-y-auto py-1">
              {searchQuery.data.items.map((po) => (
                <button
                  key={po.id}
                  type="button"
                  onClick={() => {
                    onSelect({ id: po.id, poNumber: po.poNumber });
                    setSearchText('');
                  }}
                  className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left hover:bg-[var(--erp-surface-hover)] focus:bg-[var(--erp-surface-hover)] focus:outline-hidden"
                >
                  <span className="text-sm font-medium text-foreground">{po.poNumber}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{po.distributor.name}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(po.poDate)}</span>
                    <StatusBadge label={STATUS_LABELS[po.status]} tone={statusTone(po.status)} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
