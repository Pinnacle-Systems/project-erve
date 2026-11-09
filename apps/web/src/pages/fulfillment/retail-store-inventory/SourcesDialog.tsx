import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  RetailStoreInventoryDestinationSnapshot,
  RetailStoreInventorySource,
  RetailStoreInventorySourcesResponse,
} from '@erve/types';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@erve/primitives';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import type { DrillTarget } from './StyleInventoryCard.js';
import { PURCHASE_MODE_LABEL, SALE_RETURN_FIELDS, ledgerSourceLabel, formatQuantity } from './measures.js';

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

function destinationText(d: RetailStoreInventoryDestinationSnapshot): string {
  const place = [d.city, d.state].filter(Boolean).join(', ');
  const head = [d.label, d.storeCode ? `(${d.storeCode})` : null].filter(Boolean).join(' ');
  return [head || 'Unnamed destination', place].filter(Boolean).join(' — ');
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

function SourceItem({ source }: { source: RetailStoreInventorySource }) {
  const { receipt, ledger } = source;
  return (
    <li className="min-w-0 rounded-md border border-border-subtle p-3" data-testid="inventory-source">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          className="text-sm font-semibold underline"
          to={`/fulfillment/erve-dispatches/${encodeURIComponent(source.erveDispatchId)}`}
        >
          {source.erveDispatchNumber}
        </Link>
        <span className="text-xs text-muted-foreground">
          {dateText(source.dispatchDate)} · Packing List {source.ervePackingListNumber} · Sale Order{' '}
          {source.saleOrderNumber} · Size {source.sizeCode}
        </span>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        Dispatched to: {destinationText(source.dispatchDestination)}
        {source.orderDestination.label !== source.dispatchDestination.label && (
          <> · Ordered for: {destinationText(source.orderDestination)}</>
        )}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
        <Fact label="Dispatched">{formatQuantity(source.shippedQuantity)}</Fact>
        <Fact label="Distributor receipt">
          {receipt.status === 'ATTESTED' ? (
            <>
              {formatQuantity(receipt.receivedQuantity ?? 0)}
              {receipt.receivedAt && (
                <span className="block text-xs font-normal text-muted-foreground">{dateText(receipt.receivedAt)}</span>
              )}
            </>
          ) : (
            <Badge variant="warning">Awaiting confirmation</Badge>
          )}
        </Fact>
        <Fact label="Shortage">
          {source.shortageQuantity === null ? (
            <span className="font-normal text-muted-foreground">Not recorded</span>
          ) : (
            formatQuantity(source.shortageQuantity)
          )}
        </Fact>
        <Fact label="Received ledger in use">
          {ledger.quantity === null ? (
            <span className="font-normal text-muted-foreground">Not recorded</span>
          ) : (
            <>
              {formatQuantity(ledger.quantity)}
              <span className="block text-xs font-normal text-muted-foreground">{ledgerSourceLabel(ledger.source)}</span>
            </>
          )}
        </Fact>
        <Fact label="Carton QR delivery">
          {source.qr.confirmedCartonCount} of {source.qr.cartonCount} cartons
          <span className="block text-xs font-normal text-muted-foreground">Physical delivery only, not accepted quantity</span>
        </Fact>
        {source.discrepancy && (
          <Fact label="Reconciliation">
            <Badge variant="danger">Receipt differs from ledger</Badge>
          </Fact>
        )}
      </dl>
      {source.saleReturn && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border-subtle pt-2 sm:grid-cols-4">
          {SALE_RETURN_FIELDS.map(([label, field]) => (
            <Fact key={field} label={label}>
              {formatQuantity(source.saleReturn![field])}
            </Fact>
          ))}
        </dl>
      )}
    </li>
  );
}

interface Props {
  target: DrillTarget | null;
  onClose: () => void;
}

/** Contributing Dispatch / Sale Order lines for one Store x Style (x Size) x purchase mode. */
export function SourcesDialog({ target, onClose }: Props) {
  const params = useMemo(
    () =>
      target
        ? {
            distributorId: target.distributorId,
            storeKey: target.storeKey,
            styleId: target.card.styleId,
            purchaseMode: target.card.purchaseMode,
            ...(target.size ? { sizeId: target.size.sizeId } : {}),
          }
        : null,
    [target],
  );
  const query = useInfiniteQuery({
    queryKey: ['retail-store-inventory-sources', params],
    enabled: params !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (
        await apiClient.get<ApiSuccessResponse<RetailStoreInventorySourcesResponse>>(
          '/retail-store-inventory/sources',
          { params: { ...params, cursor: pageParam, limit: 25 } },
        )
      ).data.data,
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {target ? `${target.card.styleNumber} — ${target.size ? `Size ${target.size.sizeCode}` : 'All sizes'}` : 'Sources'}
          </DialogTitle>
          <DialogDescription>
            {target
              ? `${target.storeName} · ${PURCHASE_MODE_LABEL[target.card.purchaseMode]}. Every contributing Erve Dispatch and Sale Order line, newest first.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState label="Loading source dispatches" />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load source dispatches"
            description={getApiErrorMessage(query.error, 'Unable to load source dispatches')}
          />
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No source dispatches found.</p>
        ) : (
          <>
            <ul className="space-y-3" aria-label="Source dispatches">
              {items.map((source) => (
                <SourceItem key={`${source.erveDispatchId}:${source.saleOrderLineId}`} source={source} />
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
        {target?.card.purchaseMode === 'SALE_RETURN' && (
          <p className="mt-3 flex flex-wrap gap-3 border-t border-border-subtle pt-3 text-sm">
            <Link className="underline" to="/fulfillment/sale-or-return">Sale-or-Return stock</Link>
            <Link className="underline" to="/fulfillment/distributor-sales-reports">Sales reports</Link>
            <Link className="underline" to="/fulfillment/distributor-returns">Distributor returns</Link>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
