import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { createId } from '@erve/shared';
import { Panel } from '@erve/layout';
import { Button, NumericField, TextField, ValidationMessage } from '@erve/primitives';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { StyleSizeGrid } from '../../../components/style-size-grid/StyleSizeGrid.js';
import { StyleSizeMetricMatrix } from '../../../components/style-size-grid/StyleSizeMetricMatrix.js';
import { groupSourceLinesByStyle } from '../style-size-grouping.js';
import type { ErveDispatchView } from '../types.js';
import {
  buildReceiptEntryGroups,
  buildReceiptRequest,
  needsAllocation,
  receiptSizeColumns,
  validateReceiptEntries,
  type AllocationDrafts,
  type ReceivedEntries,
  type ReceiptEntryGroup,
} from './distributorReceiptModel.js';

const purchaseModeLabel = (mode: string | null) =>
  mode === 'SALE_RETURN' ? 'Sale or Return' : mode === 'OUTRIGHT' ? 'Outright' : 'Purchase mode not available';

/**
 * A4 (ISS-079/080): the Distributor's one final attestation of actual receipt.
 * Entry -> review -> explicit acknowledgement. Entries are never discarded on a
 * stale-version or network failure, and a single request key is reused for
 * retries of an unchanged submission so an uncertain outcome can be retried
 * without ever being recorded twice.
 */
export function DistributorReceiptForm({ dispatch }: { dispatch: ErveDispatchView }) {
  const queryClient = useQueryClient();
  const groups = useMemo(() => buildReceiptEntryGroups(dispatch.quantityLines ?? []), [dispatch.quantityLines]);
  const columns = useMemo(() => receiptSizeColumns(groups), [groups]);
  const styles = useMemo(() => {
    const byStyle = new Map<string, ReceiptEntryGroup[]>();
    for (const group of groups) byStyle.set(group.styleId, [...(byStyle.get(group.styleId) ?? []), group]);
    return [...byStyle.values()];
  }, [groups]);

  const [received, setReceived] = useState<ReceivedEntries>({});
  const [allocations, setAllocations] = useState<AllocationDrafts>({});
  const [invalidCells, setInvalidCells] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState('');
  const [step, setStep] = useState<'entry' | 'review'>('entry');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  // One key per distinct submission: reused for retries, replaced on any edit.
  const requestKey = useRef<string | null>(null);
  // Synchronous double-submit guard: React state would lag a same-tick second click.
  const inFlight = useRef(false);
  const edited = () => {
    requestKey.current = null;
    setError('');
  };

  const validation = validateReceiptEntries(groups, received, allocations);
  const remarksMissing = validation.hasShortage && remarks.trim() === '';
  const blockers: string[] = [];
  if (!validation.allEntered) blockers.push('Enter a received quantity for every Style and Size (use 0 if none arrived).');
  if (invalidCells.size > 0) blockers.push('Correct the highlighted quantities.');
  if (Object.keys(validation.groupErrors).length > 0) blockers.push('Complete the source-line allocation.');
  if (remarksMissing) blockers.push('Remarks are required when any quantity is short.');
  const canReview = blockers.length === 0;

  const submit = useMutation({
    mutationFn: async () => {
      requestKey.current ??= createId();
      const res = await apiClient.post<ApiSuccessResponse<ErveDispatchView>>(
        `/erve-dispatches/${dispatch.id}/distributor-receipt`,
        buildReceiptRequest(groups, received, allocations, { expectedVersion: dispatch.version, remarks }),
        { headers: { 'Idempotency-Key': requestKey.current } },
      );
      return res.data.data;
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (updated) => {
      setError('');
      queryClient.setQueryData(['erve-dispatch', dispatch.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['erve-dispatches'] });
    },
    onError: (caught) => {
      if (isAxiosError(caught) && caught.response?.status === 409) {
        setNeedsRefresh(true);
        setError(
          getApiErrorMessage(caught, 'This dispatch has changed.') +
            ' Refresh to review the latest details; your entries are kept.',
        );
      } else if (isAxiosError(caught) && !caught.response) {
        setError(
          'We could not confirm whether the receipt was recorded (network problem). Your entries are kept. ' +
            'Retry safely: the same request is reused, so it cannot be recorded twice.',
        );
      } else {
        setError(getApiErrorMessage(caught, 'Unable to submit the receipt.'));
      }
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      await queryClient.refetchQueries({ queryKey: ['erve-dispatch', dispatch.id] });
      if (queryClient.getQueryState(['erve-dispatch', dispatch.id])?.status === 'error') throw new Error('refresh failed');
    },
    onSuccess: () => {
      setNeedsRefresh(false);
      setError('');
    },
    onError: () => setError('Unable to refresh the dispatch. Check your connection and try again.'),
  });

  const setCell = (group: ReceiptEntryGroup, value: number | null) => {
    edited();
    setReceived((current) => ({ ...current, [group.key]: value }));
  };

  const fillAsDispatched = () => {
    edited();
    setReceived(Object.fromEntries(groups.map((group) => [group.key, group.dispatchedQuantity])));
    setInvalidCells(new Set());
  };

  const rows = styles.map((styleGroups) => {
    const first = styleGroups[0]!;
    return {
      styleId: first.styleId,
      styleNumber: first.styleNumber,
      styleName: first.styleName,
      primaryImage: first.primaryImage,
      values: Object.fromEntries(styleGroups.map((group) => [group.sizeId, received[group.key] ?? null])),
    };
  });
  const reviewMatrix = useMemo(() => groupSourceLinesByStyle(groups), [groups]);
  const groupBySize = (styleId: string, sizeId: string) => groups.find((g) => g.styleId === styleId && g.sizeId === sizeId);

  const ambiguous = groups.filter((group) => needsAllocation(group, received[group.key]));

  if (groups.length === 0) {
    return (
      <Panel title="Confirm Actual Receipt">
        <p className="text-sm text-muted-foreground">No dispatched Style / Size quantities are available to confirm.</p>
      </Panel>
    );
  }

  const alreadyConfirmed = dispatch.status === 'DELIVERED';

  return (
    <Panel title={step === 'entry' ? 'Confirm Actual Receipt' : 'Review and Confirm Receipt'}>
      <div className="space-y-4">
        {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
        {needsRefresh && (
          <div className="space-y-2" role="alert">
            <p className="text-sm">This dispatch has changed since you opened it. Refresh, then submit again.</p>
            <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending} loading={refresh.isPending}>
              Refresh Dispatch
            </Button>
          </div>
        )}

        {step === 'entry' ? (
          <>
            <p className="text-sm text-[var(--erp-muted-fg)]">
              Enter the quantity you actually received for each Style and Size. This is your final confirmation for
              this dispatch and cannot be changed or reopened afterwards. Enter 0 where nothing arrived.
            </p>
            {alreadyConfirmed && (
              <p className="text-sm" role="note">
                An earlier delivery confirmation already exists for this dispatch. Your receipt will be recorded as
                separate evidence and will not change the quantities currently used for Sales and Returns; any
                difference will be shown.
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="secondary" onClick={fillAsDispatched}>
                Fill as Dispatched
              </Button>
            </div>
            <StyleSizeGrid
              variant="editable"
              columns={columns}
              rows={rows}
              onCellChange={(styleId, sizeId, value) => {
                const group = groupBySize(styleId, sizeId);
                if (group) setCell(group, value);
              }}
              onCellValidationChange={(styleId, sizeId, valid) => {
                setInvalidCells((current) => {
                  const next = new Set(current);
                  const key = `${styleId}::${sizeId}`;
                  if (valid) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              cellOptions={(styleId, sizeId) => {
                const group = groupBySize(styleId, sizeId);
                if (!group) return {};
                const entered = received[group.key];
                const short = entered === null || entered === undefined ? 0 : group.dispatchedQuantity - entered;
                return {
                  max: group.dispatchedQuantity,
                  ariaLabel: `${group.styleNumber} ${group.sizeCode} received quantity`,
                  helpText: (
                    <>
                      Dispatched {group.dispatchedQuantity.toLocaleString()}
                      {short > 0 && <span className="font-medium text-danger"> · Short {short.toLocaleString()}</span>}
                    </>
                  ),
                  // Allocation problems are explained in the allocation block below the grid.
                  inlineError: needsAllocation(group, entered) ? undefined : validation.groupErrors[group.key],
                };
              }}
              emptyMessage="No dispatched Style / Size quantities are available."
            />

            {ambiguous.length > 0 && (
              <div className="space-y-3" aria-label="Source line allocation">
                <p className="text-sm font-medium">Allocate partial receipts to source lines</p>
                <p className="text-xs text-muted-foreground">
                  These Style / Size quantities were supplied by more than one order line. Say which line each received
                  unit belongs to; the allocation must total what you entered.
                </p>
                {ambiguous.map((group) => (
                  <div key={group.key} className="rounded border border-[var(--erp-border)] p-3">
                    <div className="mb-2 text-sm font-medium">
                      {group.styleNumber} / {group.sizeLabel} — received {received[group.key]} of{' '}
                      {group.dispatchedQuantity}
                    </div>
                    <div className="space-y-2">
                      {group.sources.map((source) => (
                        <div key={source.saleOrderLineId} className="flex flex-wrap items-center gap-3">
                          <span className="w-40 text-sm">{source.saleOrderNumber ?? 'Order not available'}</span>
                          <span className="w-36 text-sm text-[var(--erp-muted-fg)]">{purchaseModeLabel(source.purchaseMode)}</span>
                          <span className="w-28 text-sm text-[var(--erp-muted-fg)]">dispatched {source.dispatchedQuantity}</span>
                          <NumericField
                            mode="integer"
                            min={0}
                            max={source.dispatchedQuantity}
                            width="sm"
                            aria-label={`${group.styleNumber} ${group.sizeCode} ${source.saleOrderNumber ?? source.saleOrderLineId} allocated received quantity`}
                            value={
                              allocations[group.key]?.[source.saleOrderLineId] === undefined ||
                              allocations[group.key]?.[source.saleOrderLineId] === ''
                                ? null
                                : Number(allocations[group.key]![source.saleOrderLineId])
                            }
                            onChange={(value) => {
                              edited();
                              setAllocations((current) => ({
                                ...current,
                                [group.key]: { ...(current[group.key] ?? {}), [source.saleOrderLineId]: value === null ? '' : String(value) },
                              }));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    {validation.groupErrors[group.key] && (
                      <div role="alert" className="mt-2 text-xs text-danger">{validation.groupErrors[group.key]}</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <TextField
              label={`Receipt Remarks${validation.hasShortage ? ' (required — quantities are short)' : ' (required if any quantity is short)'}`}
              value={remarks}
              maxLength={1000}
              onChange={(event) => {
                edited();
                setRemarks(event.target.value);
              }}
            />
            {!canReview && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground" aria-label="Before you can review">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button
                disabled={!canReview}
                onClick={() => {
                  setAcknowledged(false);
                  setStep('review');
                }}
              >
                Review Receipt
              </Button>
            </div>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Dispatched</dt><dd className="font-medium">{validation.totalDispatched.toLocaleString()}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Received</dt><dd className="font-medium">{validation.totalReceived.toLocaleString()}</dd></div>
              <div>
                <dt className="text-xs text-muted-foreground">Short</dt>
                <dd className={validation.totalShortage > 0 ? 'font-medium text-danger' : 'font-medium'}>{validation.totalShortage.toLocaleString()}</dd>
              </div>
            </dl>
            <StyleSizeMetricMatrix
              label="Receipt summary"
              columns={reviewMatrix.columns}
              rows={reviewMatrix.rows}
              metrics={[
                { key: 'dispatched', label: 'Dispatched', value: (group) => group.dispatchedQuantity },
                { key: 'received', label: 'Received', value: (group) => received[group.key] ?? 0 },
                {
                  key: 'short',
                  label: 'Short',
                  value: (group) => group.dispatchedQuantity - (received[group.key] ?? 0),
                  tone: (total) => (total > 0 ? 'danger' : undefined),
                },
              ]}
              detail={(row) => {
                // Source-line allocations of a partial receipt, exactly as entered above.
                const allocated = row.sources.filter((group) => needsAllocation(group, received[group.key] ?? 0));
                if (allocated.length === 0) return null;
                return (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {allocated.flatMap((group) =>
                      group.sources.map((source) => {
                        const quantity = Number(allocations[group.key]?.[source.saleOrderLineId] ?? 0);
                        return (
                          <li key={`${group.key}:${source.saleOrderLineId}`}>
                            {group.sizeCode} · {source.saleOrderNumber ?? 'Order'} · {purchaseModeLabel(source.purchaseMode)}:
                            dispatched {source.dispatchedQuantity}, received {quantity}, short{' '}
                            {source.dispatchedQuantity - quantity}
                          </li>
                        );
                      }),
                    )}
                  </ul>
                );
              }}
            />
            {remarks.trim() && (
              <p className="text-sm"><span className="text-muted-foreground">Remarks: </span>{remarks.trim()}</p>
            )}
            {validation.totalReceived === 0 && (
              <p className="text-sm font-medium text-danger" role="alert">
                You are confirming that nothing was received. The dispatch will remain &ldquo;Dispatched&rdquo; and
                no received stock will be recorded.
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I confirm these are the quantities actually received. This confirmation is final and cannot be changed
                or reopened.
              </span>
            </label>
            <div className="flex justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep('entry')} disabled={submit.isPending}>
                Back to Edit
              </Button>
              <Button
                disabled={!acknowledged || submit.isPending || needsRefresh}
                loading={submit.isPending}
                onClick={() => {
                  if (inFlight.current || submit.isPending || needsRefresh) return;
                  inFlight.current = true;
                  submit.mutate();
                }}
              >
                Confirm Receipt
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
