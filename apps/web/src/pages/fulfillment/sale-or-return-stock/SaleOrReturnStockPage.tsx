import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, SaleOrReturnStockStylesResponse, SaleOrReturnStockStyleSummary } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, TextField } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../../auth/AuthContext.js';
import {
  canSubmitDistributorReturns,
  canSubmitDistributorSalesReports,
  canSubmitRetailStoreFifoAction,
  canViewSaleOrReturnPositions,
} from '../../../auth/permissions.js';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { LoadMoreFooter } from '../../../lib/cursor-list.js';
import { useDebouncedValue } from '../../../lib/use-debounced-value.js';
import { StyleThumbnailCell } from '../../../components/style/StyleThumbnailCell.js';
import { DistributorLookupField } from '../../master-data/DistributorLookupField.js';
import { formatQuantity } from '../retail-store-inventory/measures.js';
import { StockFlagList, StockStatGrid } from './StockParts.js';
import { useStockDistributorFilter } from './useStockDistributorFilter.js';

const FILTER_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;
export const BY_DISPATCH_PATH = '/fulfillment/sale-or-return/by-dispatch';

const plural = (n: number, one: string, many: string) => `${formatQuantity(n)} ${n === 1 ? one : many}`;

function StyleSummaryCard({ style, distributorId }: { style: SaleOrReturnStockStyleSummary; distributorId: string | undefined }) {
  const to = `/fulfillment/sale-or-return/styles/${encodeURIComponent(style.styleId)}${
    distributorId ? `?distributorId=${encodeURIComponent(distributorId)}` : ''
  }`;
  return (
    <li className="min-w-0 rounded-md border border-border-subtle bg-surface p-3" data-testid="stock-style" aria-label={style.styleNumber}>
      <div className="mb-3 flex min-w-0 flex-wrap items-start gap-3">
        <StyleThumbnailCell styleId={style.styleId} image={style.primaryImage} size={48} viewerTitle={style.styleNumber} />
        <div className="min-w-0 flex-1">
          <Link to={to} className="text-sm font-semibold text-foreground underline-offset-2 hover:underline">
            {style.styleNumber}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{style.styleName}</p>
          <p className="text-xs text-muted-foreground">
            {plural(style.distributorCount, 'Distributor', 'Distributors')} · {plural(style.storeCount, 'store', 'stores')} ·{' '}
            {plural(style.measures.sourceCount, 'dispatch line', 'dispatch lines')}
          </p>
        </div>
        <Link
          to={to}
          aria-label={`Open ${style.styleNumber} stock detail`}
          className="shrink-0 text-sm font-medium underline underline-offset-2"
        >
          View detail
        </Link>
      </div>
      <StockStatGrid measures={style.measures} />
      <StockFlagList measures={style.measures} />
    </li>
  );
}

/**
 * Sale-or-Return Stock, Style first. One row per Style, consolidated across every relevant Dispatch
 * (aggregated and paginated by PostgreSQL on the Styles themselves, so a Style that appears in 100+
 * Dispatches is one row with complete totals). The Style opens into its native Size matrix, then
 * Distributor -> Retail Store -> contributing Dispatches (SaleOrReturnStyleDetailPage). This screen
 * is read-only; Report Sold / Request Return stay on the Dispatch-wise screen and the Store-level
 * Retail Store Inventory screen.
 */
export function SaleOrReturnStockPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const allowed = canViewSaleOrReturnPositions(user);
  const canReport = canSubmitDistributorSalesReports(user);
  const canReturn = canSubmitDistributorReturns(user);
  const canFifo = canSubmitRetailStoreFifoAction(user);
  const filter = useStockDistributorFilter();

  const [styleText, setStyleText] = useState('');
  const style = useDebouncedValue(styleText.trim(), FILTER_DEBOUNCE_MS);

  const params = useMemo(
    () => ({
      ...(filter.distributorId ? { distributorId: filter.distributorId } : {}),
      ...(style ? { style } : {}),
      limit: PAGE_SIZE,
    }),
    [filter.distributorId, style],
  );

  const query = useInfiniteQuery({
    queryKey: ['sale-or-return-stock-styles', params],
    enabled: allowed && filter.queryAllowed,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<ApiSuccessResponse<SaleOrReturnStockStylesResponse>>('/sale-or-return-stock/styles', {
          params: { ...params, cursor: pageParam },
        })
      ).data.data,
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
  });
  const styles = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  // Totals come from the first page's summary; they cover every matching Style, not the loaded ones.
  const summary = query.data?.pages[0]?.summary;

  if (!allowed) return <ErrorState title="Sale-or-Return stock access unavailable" />;

  const byDispatchTo = `${BY_DISPATCH_PATH}${filter.distributorId ? `?distributorId=${encodeURIComponent(filter.distributorId)}` : ''}`;
  const hasFilters = Boolean(filter.distributor || style);

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        wrapActions
        title="Sale-or-Return Stock"
        subtitle="Consignment stock consolidated by Style across all Dispatches. Open a Style for its sizes, Distributors, Stores and the Dispatches behind the numbers."
        secondaryActions={
          <>
            {(canReport || canReturn) && (
              <Button variant="secondary" onClick={() => navigate(byDispatchTo)}>
                Report Sold / Request Return by Dispatch
              </Button>
            )}
            {!(canReport || canReturn) && (
              <Button variant="secondary" onClick={() => navigate(byDispatchTo)}>
                Dispatch-wise positions
              </Button>
            )}
            {canReport && (
              <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-sales-reports')}>
                Report History
              </Button>
            )}
            {canReturn && (
              <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-returns')}>
                Return History
              </Button>
            )}
          </>
        }
      />

      <Panel title="Filters">
        <div className="grid gap-3 sm:grid-cols-2">
          {filter.canPick && (
            <div className="min-w-0 space-y-1">
              <DistributorLookupField
                label="Distributor"
                placeholder="All Distributors"
                value={filter.distributor}
                onChange={filter.setDistributor}
                width="full"
                disabled={filter.state === 'loading'}
              />
              {filter.distributor && (
                <Button variant="secondary" density="compact" onClick={() => filter.setDistributor(null)}>
                  Clear Distributor filter (show all Distributors)
                </Button>
              )}
            </div>
          )}
          <TextField
            label="Style"
            placeholder="Style number or name"
            value={styleText}
            onChange={(event) => setStyleText(event.target.value)}
            width="full"
          />
        </div>
      </Panel>

      {filter.state === 'invalid' && (
        <EmptyState
          tone="error"
          title="Select a valid Distributor"
          description="The Distributor in this link is unknown or no longer available. Clear the filter to see every Distributor."
          action={<Button onClick={() => filter.setDistributor(null)}>Clear Distributor filter</Button>}
        />
      )}
      {filter.state === 'error' && (
        <ErrorState title="Unable to load Distributor" description="Could not load the Distributor in this link." />
      )}
      {filter.state === 'loading' && <LoadingState label="Loading Distributor" />}

      {filter.queryAllowed &&
        (query.isPending ? (
          <LoadingState label="Loading Sale-or-Return stock" />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load Sale-or-Return stock"
            description={getApiErrorMessage(query.error, 'Unable to load Sale-or-Return stock')}
          />
        ) : (
          <>
            {summary && (
              <Panel title={hasFilters ? 'All matching Styles' : 'All Styles'}>
                <p className="mb-2 text-sm" role="status">
                  {plural(summary.styleCount, 'Style', 'Styles')} · {plural(summary.distributorCount, 'Distributor', 'Distributors')} ·{' '}
                  {plural(summary.storeCount, 'store', 'stores')} · {plural(summary.measures.sourceCount, 'dispatch line', 'dispatch lines')}
                </p>
                <StockStatGrid measures={summary.measures} />
                <StockFlagList measures={summary.measures} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Totals cover every matching Style, not only the Styles loaded below. n/r = not recorded (no evidence yet, not zero).
                </p>
                {canFifo && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    To report sales or request returns by Store, use{' '}
                    <Link className="underline" to="/fulfillment/retail-store-inventory">
                      Retail Store Inventory
                    </Link>
                    .
                  </p>
                )}
              </Panel>
            )}

            {styles.length === 0 ? (
              <EmptyState
                title={hasFilters ? 'No Styles match these filters' : 'No Sale-or-Return stock'}
                description={
                  hasFilters
                    ? 'Try a different Style search, or clear the Distributor filter.'
                    : 'No dispatched consignment stock to show yet.'
                }
              />
            ) : (
              <ul className="space-y-3" aria-label="Styles">
                {styles.map((row) => (
                  <StyleSummaryCard key={row.styleId} style={row} distributorId={filter.distributorId} />
                ))}
              </ul>
            )}

            <LoadMoreFooter
              count={styles.length}
              noun={['Style', 'Styles']}
              hasNextPage={Boolean(query.hasNextPage)}
              isFetchingNextPage={query.isFetchingNextPage}
              isFetchNextPageError={query.isFetchNextPageError}
              onLoadMore={() => void query.fetchNextPage()}
            />
          </>
        ))}
    </div>
  );
}
