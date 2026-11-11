import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  RetailStoreInventoryMeasures,
  RetailStoreInventoryPurchaseMode,
  RetailStoreInventoryStoreGroup,
  RetailStoreInventoryStyleCard,
  StoreFifoAction,
} from '@erve/types';
import { Badge } from '@erve/primitives';
import { StyleInventoryCard, type DrillTarget } from './StyleInventoryCard.js';
import { PURCHASE_MODE_LABEL, formatQuantity } from './measures.js';

const quantityOrNotRecorded = (value: number | null) => (value === null ? 'not recorded' : formatQuantity(value));

/** One compact line of headline figures for a purchase mode; Outright never reports a stock position. */
export function ModeTotals({ mode, totals }: { mode: RetailStoreInventoryPurchaseMode; totals: RetailStoreInventoryMeasures }) {
  const parts = [
    `Shipped ${formatQuantity(totals.shippedQuantity)}`,
    `Awaiting confirmation ${formatQuantity(totals.awaitingConfirmationQuantity)}`,
    `Distributor received ${quantityOrNotRecorded(totals.attestedReceivedQuantity)}`,
    `Shortage ${quantityOrNotRecorded(totals.shortageQuantity)}`,
  ];
  if (totals.saleReturn) {
    parts.push(
      `Sold ${formatQuantity(totals.saleReturn.actualSoldQuantity)}`,
      `Returned ${formatQuantity(totals.saleReturn.returnedQuantity)}`,
      `Remaining ${formatQuantity(totals.saleReturn.remainingWithDistributor)}`,
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{PURCHASE_MODE_LABEL[mode]}:</span> {parts.join(' · ')}
      {mode === 'OUTRIGHT' && ' · Store stock not available'}
    </p>
  );
}

interface Props {
  store: RetailStoreInventoryStoreGroup;
  expanded: boolean;
  onToggle: () => void;
  onDrill: (target: DrillTarget) => void;
  /** Present for a Distributor only; never offered on an unmapped historical destination. */
  onFifoAction?: (
    action: StoreFifoAction,
    target: { store: RetailStoreInventoryStoreGroup; card: RetailStoreInventoryStyleCard; size: { sizeId: string; sizeCode: string } },
  ) => void;
}

/**
 * One Retail Store group. The styles are only mounted while the group is
 * expanded, so a long page keeps its DOM (and Style image requests) small.
 */
export function StoreSection({ store, expanded, onToggle, onDrill, onFifoAction }: Props) {
  const place = [store.city, store.state].filter(Boolean).join(', ');
  const panelId = `store-panel-${store.storeKey}`;
  return (
    <section className="min-w-0 rounded-md border border-border bg-surface" aria-label={`Retail Store ${store.name}`}>
      <h3 className="m-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex w-full min-w-0 items-start gap-2 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2"
        >
          {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-words text-base font-semibold text-foreground">{store.name}</span>
              {store.code && <span className="text-sm text-muted-foreground">{store.code}</span>}
              {!store.mapped && (
                <Badge
                  variant="warning"
                  className="max-w-full whitespace-normal text-left leading-snug"
                  title="Historical destination with no Retail Store link. Kept as its own group under its original destination identity; never merged by name or address."
                >
                  Unmapped historical destination
                </Badge>
              )}
              {store.status === 'INACTIVE' && <Badge variant="muted">Inactive store</Badge>}
            </span>
            <span className="block text-xs text-muted-foreground">
              {[place, `${store.dispatchCount} ${store.dispatchCount === 1 ? 'dispatch' : 'dispatches'}`].filter(Boolean).join(' · ')}
            </span>
            <span className="mt-1 block space-y-0.5">
              {(Object.entries(store.totalsByMode) as Array<[RetailStoreInventoryPurchaseMode, RetailStoreInventoryMeasures]>).map(
                ([mode, totals]) => (
                  <ModeTotals key={mode} mode={mode} totals={totals} />
                ),
              )}
            </span>
          </span>
        </button>
      </h3>
      {expanded && (
        <div id={panelId} className="space-y-3 border-t border-border-subtle p-3">
          {store.styles.map((card) => (
            <StyleInventoryCard
              key={card.cardKey}
              storeKey={store.storeKey}
              storeName={store.name}
              distributorId={store.distributor.id}
              card={card}
              onDrill={onDrill}
              onFifoAction={
                onFifoAction && store.mapped
                  ? (action, size) => onFifoAction(action, { store, card, size })
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
