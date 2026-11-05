import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CartonDeliveryInput, PublicCartonDeliveryView } from '@erve/types';
import { confirmCartonDelivery, resolveCartonDelivery } from './public-delivery-client.js';

function localNow() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const fieldClass = 'mt-1 w-full rounded border border-input bg-background p-3 text-base';
const buttonClass =
  'rounded bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50';

export function PublicCartonDeliveryPage() {
  // Read without side effects: StrictMode invokes initializers twice before effects.
  const [capture, setCapture] = useState(() => ({
    token: window.location.hash.slice(1),
    generation: 0,
  }));
  useEffect(() => {
    const captureNext = () => {
      const token = window.location.hash.slice(1);
      if (token) setCapture((previous) => ({ token, generation: previous.generation + 1 }));
    };
    window.addEventListener('hashchange', captureNext);
    window.addEventListener('popstate', captureNext);
    return () => {
      window.removeEventListener('hashchange', captureNext);
      window.removeEventListener('popstate', captureNext);
    };
  }, []);
  // Generation is nonsecret. A new scan resets every draft/result and cancels
  // the previous resolver effect, even for same-document browser navigation.
  return <CartonDeliveryCapture key={capture.generation} token={capture.token} />;
}

function CartonDeliveryCapture({ token }: { token: string }) {
  const [carton, setCarton] = useState<PublicCartonDeliveryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recipient, setRecipient] = useState('');
  const [deliveryTime, setDeliveryTime] = useState(localNow);
  const [remarks, setRemarks] = useState('');
  const [review, setReview] = useState<CartonDeliveryInput | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const submittingRef = useRef(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    window.history.replaceState(window.history.state, '', '/delivery/carton');
    let cancelled = false;
    async function resolve() {
      try {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token))
          throw new Error('Scan the QR on the carton label to open this page.');
        const result = await resolveCartonDelivery(token);
        if (!cancelled) setCarton(result);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : 'Carton delivery link is unavailable.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function prepareReview(event: FormEvent) {
    event.preventDefault();
    setError('');
    const instant = new Date(deliveryTime);
    if (
      !recipient.trim() ||
      recipient.trim().length > 120 ||
      remarks.trim().length > 2000 ||
      !Number.isFinite(instant.getTime())
    ) {
      setError('Enter a recipient and a valid delivery date and time.');
      return;
    }
    const offsetMinutes = -instant.getTimezoneOffset();
    const absolute = Math.abs(offsetMinutes);
    const offset = `${offsetMinutes < 0 ? '-' : '+'}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
    setReview({
      recipientName: recipient.trim(),
      deliveredAt: `${deliveryTime}:00${offset}`,
      timezone,
      offsetMinutes,
      remarks: remarks.trim(),
      confirmed: true,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  async function submit() {
    if (!review || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      await confirmCartonDelivery(token, review);
      setSuccess(true);
      setReview(null);
      setRecipient('');
      setRemarks('');
    } catch (caught) {
      setError(
        `Submission could not be confirmed. ${caught instanceof Error ? caught.message : 'Try again.'} Retrying these same details is safe.`,
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-5 bg-background p-5 text-foreground">
      <header>
        <p className="text-sm font-semibold">ERVE INDIA</p>
        <h1 className="mt-2 text-2xl font-semibold">Carton delivery</h1>
      </header>
      {loading && <p role="status">Checking carton…</p>}
      {error && (
        <p role="alert" className="rounded border border-destructive p-3">
          {error}
        </p>
      )}
      {carton && (
        <div className="rounded border p-4">
          <h2 className="text-xl font-semibold">Carton {carton.cartonNumber}</h2>
          <p className="break-all text-sm">Label reference: {carton.labelReference}</p>
        </div>
      )}
      {success ? (
        <p role="status">
          Delivery recorded. Scan the next carton to record its delivery individually.
        </p>
      ) : carton?.state === 'CONFIRMED' ? (
        <p role="status">Delivery already recorded for this carton.</p>
      ) : carton?.state === 'AWAITING_DISPATCH' ? (
        <p role="status">
          Delivery recording is not available yet. Try scanning again after the physical Dispatch is
          recorded.
        </p>
      ) : (
        carton?.state === 'READY' &&
        (review ? (
          <section className="space-y-4" aria-label="Review delivery">
            <h2 className="text-xl font-semibold">Review delivery</h2>
            <dl className="space-y-2 break-words">
              <dt>Recipient name</dt>
              <dd>{review.recipientName}</dd>
              <dt>Actual delivery time</dt>
              <dd>
                {review.deliveredAt} ({review.timezone})
              </dd>
              <dt>Delivery remarks</dt>
              <dd className="whitespace-pre-wrap">{review.remarks || 'None'}</dd>
            </dl>
            <p>
              Confirm that this physical carton was delivered. Accepted details cannot be edited.
            </p>
            <div className="flex flex-wrap gap-3">
              <button className={buttonClass} disabled={submitting} onClick={() => void submit()}>
                Confirm delivery of this carton
              </button>
              <button
                className="rounded border px-4 py-3"
                disabled={submitting}
                onClick={() => {
                  setReview(null);
                  setError('');
                }}
              >
                Back to details
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={prepareReview} className="space-y-4">
            <label className="block">
              Recipient name
              <input
                className={fieldClass}
                name="recipientName"
                autoComplete="name"
                required
                maxLength={120}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
            </label>
            <label className="block">
              Actual delivery date and time
              <input
                className={fieldClass}
                name="deliveredAt"
                type="datetime-local"
                required
                value={deliveryTime}
                onChange={(event) => setDeliveryTime(event.target.value)}
              />
            </label>
            <p>
              Timezone: <strong>{timezone}</strong>. Date and time use this device’s timezone; the
              UTC offset will be shown for review.
            </p>
            <label className="block">
              Delivery remarks (optional)
              <textarea
                className={fieldClass}
                name="remarks"
                maxLength={2000}
                rows={4}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
              />
            </label>
            <button className={buttonClass} type="submit">
              Review delivery
            </button>
          </form>
        ))
      )}
    </main>
  );
}
