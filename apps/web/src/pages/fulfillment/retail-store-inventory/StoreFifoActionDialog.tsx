import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { createId } from '@erve/shared';
import type {
  ApiSuccessResponse,
  DistributorReturnView,
  DistributorSalesReportView,
  RetailStoreInventoryStyleCard,
  StoreFifoAction,
  StoreFifoAvailability,
} from '@erve/types';
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  NumericField,
  TextareaField,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import { ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { formatQuantity } from './measures.js';

export interface StoreFifoTarget {
  action: StoreFifoAction;
  storeKey: string;
  storeName: string;
  card: RetailStoreInventoryStyleCard;
  size: { sizeId: string; sizeCode: string };
}

interface Confirmation {
  replayed: boolean;
  documentLabel: string;
  documentPath: string;
  lines: Array<{ id: string; dispatchNumber: string; quantity: number }>;
  total: number;
}

/** Today's calendar date in India (the business date the API validates against). */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const COPY = {
  SALE: {
    title: 'Report sold',
    verb: 'Report sold',
    quantity: 'Quantity sold',
    date: 'Sale date',
    availableLabel: 'Available to report as sold',
    done: 'Sales Report recorded',
  },
  RETURN: {
    title: 'Request return',
    verb: 'Request return',
    quantity: 'Quantity to return',
    date: 'Return date',
    availableLabel: 'Available to return',
    done: 'Return request submitted',
  },
} as const;

/**
 * ISS-089: Store-level Report Sold / Request Return for one Style x Size cell. The Distributor
 * never picks a Dispatch: the server allocates oldest-received-first and the confirmation shows
 * the resulting source-level split. A retry re-sends the same Idempotency-Key, so an uncertain
 * network outcome can never create a second document; editing any field starts a new request.
 */
export function StoreFifoActionDialog({ target, onClose }: { target: StoreFifoTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target && (
        <DialogContent variant="center" className="max-h-[90vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-y-auto p-4 sm:p-6">
          <DialogBody key={`${target.action}:${target.storeKey}:${target.card.cardKey}:${target.size.sizeId}`} target={target} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

function DialogBody({ target, onClose }: { target: StoreFifoTarget; onClose: () => void }) {
  const { action, storeKey, storeName, card, size } = target;
  const copy = COPY[action];
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayInIndia());
  const [quantity, setQuantity] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  // One key per distinct submission: reused for retries, replaced on any edit.
  const requestKey = useRef<string | null>(null);
  // Synchronous double-submit guard: React state would lag a same-tick second click.
  const inFlight = useRef(false);
  const edited = () => {
    requestKey.current = null;
    setError('');
  };

  const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const dateInFuture = dateIsValid && date > todayInIndia();
  const availabilityQuery = useQuery({
    queryKey: ['retail-store-fifo-availability', storeKey, card.styleId, size.sizeId, date],
    enabled: dateIsValid && !dateInFuture,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<StoreFifoAvailability>>('/retail-store-inventory/store-fifo/availability', {
          params: { storeKey, styleId: card.styleId, sizeId: size.sizeId, date },
        })
      ).data.data,
  });
  const availability = availabilityQuery.data;
  const available = availability ? (action === 'SALE' ? availability.availableForSale : availability.availableForReturn) : null;

  const quantityError =
    quantity === null || quantity < 1
      ? 'Enter a quantity of at least 1.'
      : available !== null && quantity > available
        ? `Only ${formatQuantity(available)} available on ${date}. Reduce the quantity or change the date.`
        : '';
  const dateError = !dateIsValid ? 'Enter a valid date.' : dateInFuture ? 'The date cannot be in the future.' : '';
  const reasonError = action === 'RETURN' && !reason.trim() ? 'A return reason is required.' : '';
  const blocked = Boolean(quantityError || dateError || reasonError);

  const submit = useMutation({
    mutationFn: async (): Promise<Confirmation> => {
      requestKey.current ??= createId();
      const headers = { 'Idempotency-Key': requestKey.current };
      const base = { storeKey, styleId: card.styleId, sizeId: size.sizeId, quantity: quantity!, remarks: remarks.trim() || null };
      if (action === 'SALE') {
        const res = await apiClient.post<ApiSuccessResponse<{ replayed: boolean; salesReport: DistributorSalesReportView }>>(
          '/retail-store-inventory/store-fifo/sales-reports',
          { ...base, reportDate: date },
          { headers },
        );
        const { replayed, salesReport } = res.data.data;
        return {
          replayed,
          documentLabel: 'Sales Report',
          documentPath: `/fulfillment/distributor-sales-reports/${encodeURIComponent(salesReport.id)}`,
          lines: salesReport.lines.map((l) => ({ id: l.id, dispatchNumber: l.erveDispatch.erveDispatchNumber, quantity: l.quantitySold })),
          total: salesReport.lines.reduce((sum, l) => sum + l.quantitySold, 0),
        };
      }
      const res = await apiClient.post<ApiSuccessResponse<{ replayed: boolean; distributorReturn: DistributorReturnView }>>(
        '/retail-store-inventory/store-fifo/returns',
        { ...base, returnDate: date, returnReason: reason.trim() },
        { headers },
      );
      const { replayed, distributorReturn } = res.data.data;
      return {
        replayed,
        documentLabel: `Return ${distributorReturn.returnNumber}`,
        documentPath: `/fulfillment/distributor-returns/${encodeURIComponent(distributorReturn.id)}`,
        lines: distributorReturn.lines.map((l) => ({ id: l.id, dispatchNumber: l.erveDispatch.erveDispatchNumber, quantity: l.requestedQuantity })),
        total: distributorReturn.lines.reduce((sum, l) => sum + l.requestedQuantity, 0),
      };
    },
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (result) => {
      setError('');
      setConfirmation(result);
      void queryClient.invalidateQueries({ queryKey: ['retail-store-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['retail-store-fifo-availability'] });
    },
    onError: (caught) => {
      if (isAxiosError(caught) && !caught.response) {
        setError(
          'We could not confirm whether this was recorded (network problem). Your entries are kept. Retry safely: the same request is reused, so it cannot be recorded twice.',
        );
      } else {
        // Entered values stay as they are; a rejected request can be corrected and re-sent.
        setError(getApiErrorMessage(caught, 'Unable to submit this request.'));
        if (isAxiosError(caught) && caught.response?.status === 400) void availabilityQuery.refetch();
      }
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (blocked || submit.isPending || inFlight.current) return;
    inFlight.current = true;
    submit.mutate();
  }

  if (confirmation) {
    return (
      <div role="status" className="space-y-4">
        <DialogHeader>
          <DialogTitle>{copy.done}</DialogTitle>
          <DialogDescription>
            {storeName} · {card.styleNumber} · Size {size.sizeCode}
            {confirmation.replayed ? ' · This request had already been recorded; nothing new was created.' : ''}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {formatQuantity(confirmation.total)} unit{confirmation.total === 1 ? '' : 's'} recorded in{' '}
          <Link className="font-semibold underline" to={confirmation.documentPath}>
            {confirmation.documentLabel}
          </Link>
          .
        </p>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Allocated to original Dispatches, oldest received first
          </h4>
          <ul className="space-y-1" aria-label="Allocation by Dispatch">
            {confirmation.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-3 rounded border border-border-subtle px-2 py-1 text-sm">
                <span className="min-w-0 break-words">{line.dispatchNumber}</span>
                <span className="tabular-nums">{formatQuantity(line.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Source allocation follows a first-received-first convention; it does not identify which physical garment was sold.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={copy.title}>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          You choose the Store, Style, Size, quantity and date. Erve allocates the quantity across the original Dispatches automatically.
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-3 rounded-md border border-border-subtle p-3">
        <Fact label="Retail Store">{storeName}</Fact>
        <Fact label="Style">{card.styleNumber}</Fact>
        <Fact label="Size">{size.sizeCode}</Fact>
        <Fact label={copy.availableLabel}>
          {availabilityQuery.isPending && dateIsValid && !dateInFuture ? (
            'Checking…'
          ) : available === null ? (
            '—'
          ) : (
            <span data-testid="store-fifo-available">{formatQuantity(available)}</span>
          )}
        </Fact>
      </dl>

      {availabilityQuery.isError && (
        <ErrorState
          title="Unable to check availability"
          description={getApiErrorMessage(availabilityQuery.error, 'Unable to check availability')}
        />
      )}
      {availabilityQuery.isPending && dateIsValid && !dateInFuture && <LoadingState label="Checking availability" />}
      {availability && (availability.excluded.receivedAfterDateUnits > 0 || availability.excluded.unverifiedReceiptUnits > 0) && (
        <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Excluded stock">
          {availability.excluded.receivedAfterDateUnits > 0 && (
            <li>
              {formatQuantity(availability.excluded.receivedAfterDateUnits)} unit(s) were received after {date} and are not included.
            </li>
          )}
          {availability.excluded.unverifiedReceiptUnits > 0 && (
            <li>
              {formatQuantity(availability.excluded.unverifiedReceiptUnits)} unit(s) have no verified receipt date (legacy records) and cannot be
              allocated here.
            </li>
          )}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <NumericField
          label={copy.quantity}
          mode="integer"
          min={1}
          width="full"
          value={quantity}
          onChange={(value) => {
            edited();
            setQuantity(value);
          }}
          errorMessage={touched || quantity !== null ? quantityError || undefined : undefined}
        />
        <DatePicker
          label={copy.date}
          width="full"
          value={date}
          onValueChange={(value) => {
            edited();
            setDate(value ?? '');
          }}
          error={dateError || undefined}
        />
      </div>

      {action === 'RETURN' && (
        <TextField
          label="Return reason"
          width="full"
          value={reason}
          maxLength={1000}
          placeholder="e.g. End of season unsold stock"
          onChange={(event) => {
            edited();
            setReason(event.target.value);
          }}
          errorMessage={touched ? reasonError || undefined : undefined}
        />
      )}
      <TextareaField
        label="Remarks (optional)"
        value={remarks}
        maxLength={1000}
        onChange={(event) => {
          edited();
          setRemarks(event.target.value);
        }}
      />

      {error && <ValidationMessage>{error}</ValidationMessage>}

      <DialogFooter className="flex-wrap">
        <Button type="button" variant="secondary" onClick={onClose} disabled={submit.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={submit.isPending} disabled={submit.isPending || (touched && blocked)}>
          {copy.verb}
        </Button>
      </DialogFooter>
    </form>
  );
}
