import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type {
  ApiSuccessResponse,
  SaleOrReturnStockDistributorBreakdown,
  SaleOrReturnStockSource,
  SaleOrReturnStockSourcesResponse,
  SaleOrReturnStockStoreBreakdown,
  SaleOrReturnStockStoresResponse,
  SaleOrReturnStockStyleDetail,
} from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Badge, Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../../auth/AuthContext.js';
import { canViewSaleOrReturnPositions } from '../../../auth/permissions.js';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { StyleThumbnailCell } from '../../../components/style/StyleThumbnailCell.js';
import { DistributorLookupField } from '../../master-data/DistributorLookupField.js';
import { formatQuantity, ledgerSourceLabel } from '../retail-store-inventory/measures.js';
import { StockFlagList, StockStatGrid, StockStyleMatrix } from './StockParts.js';
import { NOT_RECORDED, displayQuantity } from './stock-measures.js';
import { useStockDistributorFilter } from './useStockDistributorFilter.js';

const SOURCE_PAGE_SIZE = 25;
const LIST_PATH = '/fulfillment/sale-or-return';

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

interface SourceFilter {
  distributorId?: string;
  distributorName?: string;
  storeKey?: string;
  storeName?: string;
  sizeId?: string;
  sizeCode?: string;
}

const hasSourceFilter = (f: SourceFilter) => Boolean(f.distributorId || f.storeKey || f.sizeId);

function storeLabel(source: SaleOrReturnStockSource): string {
  const d = source.orderDestination;
  const label = d.label ?? source.dispatchDestination.label;
  const code = d.storeCode ?? source.dispatchDestination.storeCode;
  const place = [d.city, d.state].filter(Boolean).join(', ');
  return [[label, code ? `(${code})` : null].filter(Boolean).join(' ') || 'Unnamed destination', place]
    .filter(Boolean)
    .join(' — ');
}

function NotRecorded() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden="true">{NOT_RECORDED}</span>
      <span className="sr-only">Not recorded</span>
    </span>
  );
}

// ----- Level 4 ---------------------------------------------------------------

function SourcesTable({
  styleId,
  scopeDistributorId,
  filter,
  onClear,
}: {
  styleId: string;
  /** The page-level Distributor filter (internal roles); a Distributor row narrows it no further than itself. */
  scopeDistributorId: string | undefined;
  filter: SourceFilter;
  onClear: () => void;
}) {
  const distributorId = filter.distributorId ?? scopeDistributorId;
  const params = useMemo(
    () => ({
      ...(distributorId ? { distributorId } : {}),
      ...(filter.storeKey ? { storeKey: filter.storeKey } : {}),
      ...(filter.sizeId ? { sizeId: filter.sizeId } : {}),
      limit: SOURCE_PAGE_SIZE,
    }),
    [distributorId, filter.storeKey, filter.sizeId],
  );
  const query = useInfiniteQuery({
    queryKey: ['sale-or-return-stock-sources', styleId, params],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<ApiSuccessResponse<SaleOrReturnStockSourcesResponse>>(
          `/sale-or-return-stock/styles/${encodeURIComponent(styleId)}/sources`,
          { params: { ...params, cursor: pageParam } },
        )
      ).data.data,
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return (
    <div className="space-y-3">
      {hasSourceFilter(filter) && (
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Dispatch filters">
          <span className="text-muted-foreground">Showing dispatches for:</span>
          {filter.distributorName && <Badge variant="info">Distributor {filter.distributorName}</Badge>}
          {filter.storeName && <Badge variant="info">Store {filter.storeName}</Badge>}
          {filter.sizeCode && <Badge variant="info">Size {filter.sizeCode}</Badge>}
          <Button variant="secondary" density="compact" onClick={onClear}>
            Show all dispatches
          </Button>
        </div>
      )}
      {query.isPending ? (
        <LoadingState label="Loading contributing dispatches" />
      ) : query.isError ? (
        <ErrorState
          title="Unable to load contributing dispatches"
          description={getApiErrorMessage(query.error, 'Unable to load contributing dispatches')}
        />
      ) : items.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No contributing dispatches found.</p>
      ) : (
        <>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-sm" aria-label="Contributing dispatches">
              <thead>
                <tr className="border-b border-border-subtle text-xs font-semibold text-muted-foreground">
                  <th scope="col" className="px-2 py-2 text-left">Dispatch</th>
                  <th scope="col" className="px-2 py-2 text-left">Sale Order</th>
                  <th scope="col" className="px-2 py-2 text-left">Distributor · Store</th>
                  <th scope="col" className="px-2 py-2 text-left">Size</th>
                  <th scope="col" className="px-2 py-2 text-right">Dispatched</th>
                  <th scope="col" className="px-2 py-2 text-right">Distributor receipt</th>
                  <th scope="col" className="px-2 py-2 text-right">Received ledger</th>
                  <th scope="col" className="px-2 py-2 text-right">Sold</th>
                  <th scope="col" className="px-2 py-2 text-right">Returned</th>
                  <th scope="col" className="px-2 py-2 text-right">Pending</th>
                  <th scope="col" className="px-2 py-2 text-right">Approved awaiting receipt</th>
                  <th scope="col" className="px-2 py-2 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {items.map((source) => {
                  const sr = source.saleReturn;
                  return (
                    <tr key={`${source.erveDispatchId}:${source.saleOrderLineId}`} data-testid="stock-source" className="align-top">
                      <td className="px-2 py-2">
                        <Link
                          className="font-medium underline"
                          to={`/fulfillment/erve-dispatches/${encodeURIComponent(source.erveDispatchId)}`}
                        >
                          {source.erveDispatchNumber}
                        </Link>
                        <div className="text-xs text-muted-foreground">{dateText(source.dispatchDate)}</div>
                      </td>
                      <td className="px-2 py-2">{source.saleOrderNumber}</td>
                      <td className="max-w-[16rem] px-2 py-2">
                        <div className="truncate">{source.distributor.name}</div>
                        <div className="break-words text-xs text-muted-foreground">{storeLabel(source)}</div>
                      </td>
                      <td className="px-2 py-2">{source.sizeCode}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(source.shippedQuantity)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {source.receipt.status === 'ATTESTED' ? (
                          <>
                            {formatQuantity(source.receipt.receivedQuantity ?? 0)}
                            {source.discrepancy && <div className="text-xs text-danger">differs from ledger</div>}
                          </>
                        ) : (
                          <Badge variant="warning">Awaiting receipt</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {source.ledger.quantity === null ? (
                          <NotRecorded />
                        ) : (
                          <>
                            {formatQuantity(source.ledger.quantity)}
                            <div className="text-xs text-muted-foreground">{ledgerSourceLabel(source.ledger.source)}</div>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{displayQuantity(sr?.actualSoldQuantity ?? null)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{displayQuantity(sr?.returnedQuantity ?? null)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{displayQuantity(sr?.pendingRequestedQuantity ?? null)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {displayQuantity(sr?.approvedAwaitingReceiptQuantity ?? null)}
                      </td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">
                        {displayQuantity(sr?.remainingWithDistributor ?? null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              Showing {items.length.toLocaleString()} {items.length === 1 ? 'dispatch line' : 'dispatch lines'}
              {query.hasNextPage ? '' : ' (all loaded)'}
            </span>
            {query.hasNextPage && (
              <Button variant="secondary" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Newest first. Each line is one original (Dispatch, Sale Order line); totals above are the sum of every such line,
            whether or not it is loaded here.
          </p>
        </>
      )}
    </div>
  );
}

// ----- Level 3 ---------------------------------------------------------------

function StoreRows({
  styleId,
  distributor,
  onShowDispatches,
}: {
  styleId: string;
  distributor: SaleOrReturnStockDistributorBreakdown['distributor'];
  onShowDispatches: (store: SaleOrReturnStockStoreBreakdown) => void;
}) {
  const query = useQuery({
    queryKey: ['sale-or-return-stock-stores', styleId, distributor.id],
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<SaleOrReturnStockStoresResponse>>(
          `/sale-or-return-stock/styles/${encodeURIComponent(styleId)}/stores`,
          { params: { distributorId: distributor.id } },
        )
      ).data.data,
  });
  if (query.isPending) return <LoadingState label="Loading stores" />;
  if (query.isError) {
    return <ErrorState title="Unable to load stores" description={getApiErrorMessage(query.error, 'Unable to load stores')} />;
  }
  if (query.data.items.length === 0) return <p className="py-2 text-sm text-muted-foreground">No stores found.</p>;
  return (
    <ul className="space-y-2" aria-label={`Stores of ${distributor.name}`}>
      {query.data.items.map((store) => (
        <li key={store.storeKey} className="min-w-0 rounded-md bg-surface-muted p-3" data-testid="stock-store">
          <div className="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">
                {store.name}
                {store.code ? <span className="font-normal text-muted-foreground"> ({store.code})</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {[store.city, store.state].filter(Boolean).join(', ') || 'Location not recorded'}
                {!store.mapped && ' · Unmapped historical destination'}
                {store.status === 'INACTIVE' && ' · Inactive store'}
              </p>
            </div>
            <Button variant="secondary" density="compact" onClick={() => onShowDispatches(store)}>
              Show dispatches
            </Button>
          </div>
          <StockStatGrid measures={store.measures} />
          <StockFlagList measures={store.measures} />
        </li>
      ))}
    </ul>
  );
}

function DistributorSection({
  styleId,
  row,
  defaultOpen,
  onShowDispatches,
}: {
  styleId: string;
  row: SaleOrReturnStockDistributorBreakdown;
  defaultOpen: boolean;
  onShowDispatches: (target: { distributor: SaleOrReturnStockDistributorBreakdown['distributor']; store?: SaleOrReturnStockStoreBreakdown }) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `stores-${row.distributor.id}`;
  return (
    <li className="min-w-0 rounded-md border border-border-subtle bg-surface p-3" data-testid="stock-distributor">
      <div className="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">
            {row.distributor.name} <span className="font-normal text-muted-foreground">({row.distributor.code})</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            {row.storeCount.toLocaleString('en-IN')} {row.storeCount === 1 ? 'store' : 'stores'} ·{' '}
            {row.measures.sourceCount.toLocaleString('en-IN')} dispatch {row.measures.sourceCount === 1 ? 'line' : 'lines'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" density="compact" onClick={() => onShowDispatches({ distributor: row.distributor })}>
            Show dispatches
          </Button>
          <Button
            variant="secondary"
            density="compact"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide stores' : 'Show stores'}
          </Button>
        </div>
      </div>
      <StockStatGrid measures={row.measures} />
      <StockFlagList measures={row.measures} />
      {open && (
        <div id={panelId} className="mt-3">
          <StoreRows
            styleId={styleId}
            distributor={row.distributor}
            onShowDispatches={(store) => onShowDispatches({ distributor: row.distributor, store })}
          />
        </div>
      )}
    </li>
  );
}

// ----- Page ------------------------------------------------------------------

/**
 * One Style's consolidated Sale-or-Return stock: native Size matrix (Level 2), Distributor-wise
 * totals with Store breakdown (Level 3) and the paginated contributing Dispatches (Level 4). Each
 * level is its own bounded request; the Store and Dispatch levels load only when opened/shown.
 */
export function SaleOrReturnStyleDetailPage() {
  const { styleId = '' } = useParams();
  const { user } = useAuth();
  const allowed = canViewSaleOrReturnPositions(user);
  const filter = useStockDistributorFilter();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>({});
  const sourcesRef = useRef<HTMLDivElement | null>(null);

  const detail = useQuery({
    queryKey: ['sale-or-return-stock-style', styleId, filter.distributorId ?? 'all'],
    enabled: allowed && filter.queryAllowed && Boolean(styleId),
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<SaleOrReturnStockStyleDetail>>(
          `/sale-or-return-stock/styles/${encodeURIComponent(styleId)}`,
          { params: filter.distributorId ? { distributorId: filter.distributorId } : undefined },
        )
      ).data.data,
  });

  if (!allowed) return <ErrorState title="Sale-or-Return stock access unavailable" />;

  const backTo = `${LIST_PATH}${filter.distributorId ? `?distributorId=${encodeURIComponent(filter.distributorId)}` : ''}`;
  const notFound = detail.isError && isAxiosError(detail.error) && detail.error.response?.status === 404;

  const showDispatches = (next: SourceFilter) => {
    setSourceFilter(next);
    sourcesRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const card = detail.data?.card;

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        wrapActions
        title={card ? `${card.styleNumber} — ${card.styleName}` : 'Sale-or-Return Stock'}
        subtitle="Consolidated across every Dispatch. Native sizes, then Distributor, Store and the Dispatches behind each number."
        secondaryActions={
          <Button variant="secondary" asChild>
            <Link to={backTo}>All Styles</Link>
          </Button>
        }
      />

      {filter.canPick && (
        <Panel padding="sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <DistributorLookupField
                label="Distributor"
                placeholder="All Distributors"
                value={filter.distributor}
                onChange={(next) => {
                  setSourceFilter({});
                  filter.setDistributor(next);
                }}
                width="full"
                disabled={filter.state === 'loading'}
              />
            </div>
            {filter.distributor && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSourceFilter({});
                  filter.setDistributor(null);
                }}
              >
                Clear Distributor filter (show all Distributors)
              </Button>
            )}
          </div>
        </Panel>
      )}

      {filter.state === 'invalid' && (
        <EmptyState
          tone="error"
          title="Select a valid Distributor"
          description="The Distributor in this link is unknown or no longer available."
          action={<Button onClick={() => filter.setDistributor(null)}>Clear Distributor filter</Button>}
        />
      )}
      {filter.state === 'error' && (
        <ErrorState title="Unable to load Distributor" description="Could not load the Distributor in this link." />
      )}
      {filter.state === 'loading' && <LoadingState label="Loading Distributor" />}

      {filter.queryAllowed &&
        (detail.isPending ? (
          <LoadingState label="Loading Style stock" />
        ) : notFound ? (
          <EmptyState
            title="No Sale-or-Return stock for this Style"
            description={
              filter.distributor
                ? `${filter.distributor.name} has no Sale-or-Return stock of this Style. Clear the Distributor filter to see all Distributors.`
                : 'This Style has no dispatched Sale-or-Return stock in your scope.'
            }
            action={
              filter.distributor ? (
                <Button onClick={() => filter.setDistributor(null)}>Clear Distributor filter</Button>
              ) : undefined
            }
          />
        ) : detail.isError ? (
          <ErrorState title="Unable to load Style stock" description={getApiErrorMessage(detail.error, 'Unable to load Style stock')} />
        ) : card ? (
          <>
            <Panel>
              <div className="mb-3 flex min-w-0 flex-wrap items-start gap-3">
                <StyleThumbnailCell styleId={card.styleId} image={card.primaryImage} size={64} viewerTitle={card.styleNumber} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{card.styleNumber}</p>
                  <p className="text-xs text-muted-foreground">{card.styleName}</p>
                  <p className="text-xs text-muted-foreground">
                    {filter.canPick
                      ? `${filter.distributor ? `Distributor: ${filter.distributor.name}` : 'All Distributors'} · ${detail.data!.distributors.length.toLocaleString('en-IN')} ${detail.data!.distributors.length === 1 ? 'Distributor' : 'Distributors'}`
                      : 'Your Sale-or-Return stock'}
                  </p>
                </div>
              </div>
              <StockStatGrid measures={card.total} />
              <StockFlagList measures={card.total} />
            </Panel>

            <Panel title="Stock by size">
              <StockStyleMatrix
                card={card}
                onDrill={(size) => showDispatches(size ? { sizeId: size.sizeId, sizeCode: size.sizeCode } : {})}
              />
            </Panel>

            <Panel title="By Distributor">
              <ul className="space-y-3" aria-label="Distributors">
                {detail.data!.distributors.map((row, index) => (
                  <DistributorSection
                    key={row.distributor.id}
                    styleId={styleId}
                    row={row}
                    defaultOpen={detail.data!.distributors.length === 1 && index === 0}
                    onShowDispatches={({ distributor, store }) =>
                      showDispatches({
                        distributorId: distributor.id,
                        distributorName: distributor.name,
                        ...(store ? { storeKey: store.storeKey, storeName: store.name } : {}),
                      })
                    }
                  />
                ))}
              </ul>
            </Panel>

            <div ref={sourcesRef}>
              <Panel title="Contributing dispatches">
                <SourcesTable
                  styleId={styleId}
                  scopeDistributorId={filter.distributorId}
                  filter={sourceFilter}
                  onClear={() => setSourceFilter({})}
                />
              </Panel>
            </div>
          </>
        ) : null)}
    </div>
  );
}
