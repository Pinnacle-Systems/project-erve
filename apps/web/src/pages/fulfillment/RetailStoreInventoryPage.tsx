import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  RetailStoreInventoryPurchaseMode,
  RetailStoreInventoryResponse,
} from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { SelectField, SelectItem, TextField } from '@erve/primitives';
import { ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import {
  canPickRetailStoreInventoryDistributor,
  canSubmitRetailStoreFifoAction,
  canViewRetailStoreInventory,
} from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { LoadMoreFooter } from '../../lib/cursor-list.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { DistributorLookupField, type DistributorLookupValue } from '../master-data/DistributorLookupField.js';
import { SourcesDialog } from './retail-store-inventory/SourcesDialog.js';
import { StoreFifoActionDialog, type StoreFifoTarget } from './retail-store-inventory/StoreFifoActionDialog.js';
import { StoreSection } from './retail-store-inventory/StoreSection.js';
import { ModeTotals } from './retail-store-inventory/StoreSection.js';
import type { DrillTarget } from './retail-store-inventory/StyleInventoryCard.js';
import { OUTRIGHT_NOTE } from './retail-store-inventory/measures.js';

const FILTER_DEBOUNCE_MS = 300;
type ModeFilter = 'ALL' | RetailStoreInventoryPurchaseMode;

/**
 * A6 / ISS-088 — standalone Retail Store Inventory. Derived, read-only view of
 * what was physically shipped to each Retail Store across all Erve Dispatches,
 * with Distributor receipt evidence and (Sale-or-Return only) the consignment
 * position. Distributor -> Retail Store -> Style -> the Style's own Size columns.
 * The grid is derived and read-only. ISS-089 adds, for a Distributor only, Report sold /
 * Request return actions on Sale-or-Return Size cells of mapped Stores; the server allocates the
 * quantity FIFO across the original Dispatches. Dispatch-linked workflows stay where they are.
 */
export function RetailStoreInventoryPage() {
  const { user } = useAuth();
  const allowed = canViewRetailStoreInventory(user);
  const canPick = canPickRetailStoreInventoryDistributor(user);
  const canFifo = canSubmitRetailStoreFifoAction(user);

  const [distributor, setDistributor] = useState<DistributorLookupValue | null>(null);
  const [mode, setMode] = useState<ModeFilter>('ALL');
  const [storeText, setStoreText] = useState('');
  const [styleText, setStyleText] = useState('');
  const store = useDebouncedValue(storeText.trim(), FILTER_DEBOUNCE_MS);
  const style = useDebouncedValue(styleText.trim(), FILTER_DEBOUNCE_MS);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [fifo, setFifo] = useState<StoreFifoTarget | null>(null);

  const params = useMemo(
    () => ({
      ...(canPick && distributor ? { distributorId: distributor.id } : {}),
      ...(mode !== 'ALL' ? { purchaseMode: mode } : {}),
      ...(store ? { store } : {}),
      ...(style ? { style } : {}),
      limit: 10,
    }),
    [canPick, distributor, mode, store, style],
  );

  const query = useInfiniteQuery({
    queryKey: ['retail-store-inventory', params],
    enabled: allowed,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<ApiSuccessResponse<RetailStoreInventoryResponse>>('/retail-store-inventory', {
          params: { ...params, cursor: pageParam },
        })
      ).data.data,
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
  });
  const stores = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const summary = query.data?.pages[0]?.summary;

  if (!allowed) return <ErrorState title="Retail Store Inventory access unavailable" />;

  const firstKey = stores[0]?.storeKey;
  const isExpanded = (key: string) => overrides[key] ?? key === firstKey;

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Retail Store Inventory"
        subtitle="What was physically shipped to each Retail Store across all Erve Dispatches, with Distributor receipt evidence. Derived from existing records; it is not a separate stock ledger."
      />

      <Panel title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {canPick && (
            <DistributorLookupField
              label="Distributor"
              placeholder="All Distributors"
              value={distributor}
              onChange={setDistributor}
              width="full"
            />
          )}
          <SelectField label="Purchase mode" value={mode} onValueChange={(value) => setMode(value as ModeFilter)} width="full">
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="SALE_RETURN">Sale-or-Return</SelectItem>
            <SelectItem value="OUTRIGHT">Outright</SelectItem>
          </SelectField>
          <TextField
            label="Retail Store"
            placeholder="Store name or code"
            value={storeText}
            onChange={(event) => setStoreText(event.target.value)}
            width="full"
          />
          <TextField
            label="Style"
            placeholder="Style number or name"
            value={styleText}
            onChange={(event) => setStyleText(event.target.value)}
            width="full"
          />
        </div>
      </Panel>

      {query.isPending ? (
        <LoadingState label="Loading Retail Store Inventory" />
      ) : query.isError ? (
        <ErrorState
          title="Unable to load Retail Store Inventory"
          description={getApiErrorMessage(query.error, 'Unable to load Retail Store Inventory')}
        />
      ) : (
        <>
          {summary && (
            <Panel title="All matching shipments">
              <p className="mb-1 text-sm" role="status">
                {summary.storeCount.toLocaleString('en-IN')} {summary.storeCount === 1 ? 'store' : 'stores'} ·{' '}
                {summary.dispatchCount.toLocaleString('en-IN')} {summary.dispatchCount === 1 ? 'dispatch' : 'dispatches'}
              </p>
              <div className="space-y-0.5">
                {(['SALE_RETURN', 'OUTRIGHT'] as const).map((m) =>
                  summary.totalsByMode[m] ? <ModeTotals key={m} mode={m} totals={summary.totalsByMode[m]!} /> : null,
                )}
              </div>
              {summary.totalsByMode.OUTRIGHT && <p className="mt-1 text-xs text-muted-foreground">{OUTRIGHT_NOTE}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                {canFifo
                  ? 'Use Sold or Return under a Sale-or-Return size to report sales or request returns for that Store; Erve allocates them to the original Dispatches, oldest received first. To work Dispatch by Dispatch, use '
                  : 'To report sales or request returns, use '}
                <Link className="underline" to="/fulfillment/sale-or-return">
                  Sale-or-Return stock
                </Link>
                .
              </p>
            </Panel>
          )}

          {stores.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No dispatched shipments match these filters.
            </p>
          ) : (
            <div className="space-y-3">
              {stores.map((group, index) => (
                <Fragment key={group.storeKey}>
                  {group.distributor.id !== stores[index - 1]?.distributor.id && (
                    <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Distributor: {group.distributor.name}{' '}
                      <span className="font-normal normal-case">({group.distributor.code})</span>
                    </h2>
                  )}
                  <StoreSection
                    store={group}
                    expanded={isExpanded(group.storeKey)}
                    onToggle={() => setOverrides((prev) => ({ ...prev, [group.storeKey]: !isExpanded(group.storeKey) }))}
                    onDrill={setDrill}
                    onFifoAction={
                      canFifo
                        ? (action, t) =>
                            setFifo({ action, storeKey: t.store.storeKey, storeName: t.store.name, card: t.card, size: t.size })
                        : undefined
                    }
                  />
                </Fragment>
              ))}
            </div>
          )}

          <LoadMoreFooter
            count={stores.length}
            noun={['store', 'stores']}
            hasNextPage={Boolean(query.hasNextPage)}
            isFetchingNextPage={query.isFetchingNextPage}
            isFetchNextPageError={query.isFetchNextPageError}
            onLoadMore={() => void query.fetchNextPage()}
          />
        </>
      )}

      <SourcesDialog target={drill} onClose={() => setDrill(null)} />
      <StoreFifoActionDialog target={fifo} onClose={() => setFifo(null)} />
    </div>
  );
}
