import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isValidGstinFormat, normalizeGstin } from '@erve/shared';
import type {
  ApiSuccessResponse,
  GstVerificationPreparation,
  GstVerificationSource,
  GstVerificationTarget,
  GstVerificationView,
} from '@erve/types';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { ConfirmDialog, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';

const PATH = '/gst-compliance/verification';
const UNAVAILABLE = 'Information unavailable';
export function formatFiledPeriod(period: string | null): string {
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return UNAVAILABLE;
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`));
}
const stamp = (value: string) => new Date(value).toLocaleString('en-IN');

// Browser timers cap at ~24.8 days; policy permits 30 days. Reschedule long
// waits rather than treating a capped timer as the actual expiry instant.
function atExpiry(expiresAt: string, callback: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = Date.parse(expiresAt);
  const schedule = () => {
    timer = setTimeout(
      () => {
        if (Date.now() < expiry) schedule();
        else callback();
      },
      Math.min(2147483647, Math.max(0, expiry - Date.now()) + 10),
    );
  };
  schedule();
  return () => clearTimeout(timer);
}

export function GstinVerificationResult({ view }: { view: GstVerificationView }) {
  const evidence = view.evidence;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!evidence) return;
    return atExpiry(evidence.expiresAt, () => setNow(Date.now()));
  }, [evidence]);
  if (!evidence)
    return (
      <p className="text-sm text-muted-foreground">
        {view.latestFailure === 'NOT_FOUND'
          ? 'Not Found'
          : view.latestFailure
            ? 'Verification Unavailable'
            : 'Not Verified'}
      </p>
    );
  const stale = view.cacheState === 'STALE' || Date.parse(evidence.expiresAt) <= now;
  const field = (name: string, value: string | null) =>
    evidence.unavailable.includes(name) ? UNAVAILABLE : value || UNAVAILABLE;
  return (
    <div className="space-y-2 text-sm break-words">
      {evidence.mode === 'DEMO' && (
        <ValidationMessage tone="warning">
          Demo Result — Sample information only. The entered GSTIN has not been verified.
        </ValidationMessage>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          label={evidence.mode === 'DEMO' ? 'Demo sample' : 'Live evidence'}
          tone={evidence.mode === 'DEMO' ? 'draft' : 'approved'}
        />
        <StatusBadge
          label={`Government registration: ${evidence.governmentStatus === 'UNKNOWN' ? 'Unknown' : evidence.governmentStatus.charAt(0) + evidence.governmentStatus.slice(1).toLowerCase()}`}
          tone={evidence.governmentStatus === 'ACTIVE' ? 'success' : 'muted'}
        />
        {stale && <StatusBadge label="Stale" tone="warning" />}
        <span className="text-muted-foreground">Cached result</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">
            {evidence.mode === 'DEMO' ? 'Sample GSTIN' : 'GSTIN'}
          </dt>
          <dd>{evidence.returnedGstin}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Legal name</dt>
          <dd>{field('legal_name', evidence.legalName)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Trade name</dt>
          <dd>{field('trade_name', evidence.tradeName)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Taxpayer type</dt>
          <dd>{field('taxpayer_type', evidence.taxpayerType)}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        {evidence.mode === 'DEMO' ? 'Sample retrieved' : 'Last verified'} on{' '}
        {stamp(evidence.retrievedAt)}
        {stale ? ' — information may be outdated.' : ''}
      </p>
      {view.level === 'COMPLETE' && evidence.level === 'BASIC' && (
        <p>Complete Profile has not yet been retrieved.</p>
      )}
      {view.level === 'COMPLETE' && evidence.level === 'COMPLETE' && (
        <details className="rounded border border-border-subtle p-2">
          <summary className="cursor-pointer font-medium">Return Filing Information</summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <div>
              <dt>Filing Frequency</dt>
              <dd>{field('filing_frequency', evidence.filingFrequency)}</dd>
            </div>
            <div>
              <dt>GSTR-1 Filed Through</dt>
              <dd>{field('gstr1_filed_till', formatFiledPeriod(evidence.gstr1FiledTill))}</dd>
            </div>
            <div>
              <dt>GSTR-3B Filed Through</dt>
              <dd>{field('gstr3b_filed_till', formatFiledPeriod(evidence.gstr3bFiledTill))}</dd>
            </div>
            <div>
              <dt>Profile Retrieved On</dt>
              <dd>{stamp(evidence.retrievedAt)}</dd>
            </div>
            <div>
              <dt>Profile Completeness</dt>
              <dd>
                {evidence.partial
                  ? 'Partial — some filing information could not be retrieved.'
                  : 'Available profile retrieved'}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Filed-through values are return periods, not submission dates.
          </p>
        </details>
      )}
      {view.latestFailure && (
        <ValidationMessage tone="warning">
          {view.latestFailure === 'NOT_FOUND'
            ? 'Latest lookup: Not Found.'
            : 'Latest verification unavailable.'}{' '}
          Previous evidence is shown with its original timestamp.
        </ValidationMessage>
      )}
    </div>
  );
}

interface Props {
  gstin: string;
  source?: GstVerificationSource;
  savedGstin?: string | null;
  standalone?: boolean;
  readOnly?: boolean;
}
export function GstinVerificationPanel(props: Props) {
  const policy = useQuery({
    queryKey: ['gst-verification-policy'],
    staleTime: 30000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<{ enabled: boolean }>>(`${PATH}/policy`)).data.data,
  });
  if (!policy.data?.enabled) return null;
  const gstin = normalizeGstin(props.gstin);
  if (!gstin) return null;
  if (!isValidGstinFormat(gstin))
    return (
      <ValidationMessage tone="error">
        Enter a valid 15-character GSTIN. Saving follows the existing form validation.
      </ValidationMessage>
    );
  if (
    (!props.source && !props.standalone) ||
    (props.savedGstin !== undefined && normalizeGstin(props.savedGstin ?? '') !== gstin)
  )
    return (
      <p className="text-xs text-muted-foreground">
        Save this GSTIN, then open the saved record to verify it. Saving performs no online lookup.
      </p>
    );
  return (
    <SavedVerification
      key={`${props.source?.type}:${props.source?.id}:${gstin}`}
      target={{ gstin, source: props.source }}
      readOnly={props.readOnly}
    />
  );
}

function SavedVerification({
  target,
  readOnly,
}: {
  target: GstVerificationTarget;
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const key = ['gst-verification', target];
  const query = useQuery({
    queryKey: key,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<GstVerificationView>>(PATH, {
          params: {
            gstin: target.gstin,
            sourceType: target.source?.type,
            sourceId: target.source?.id,
          },
        })
      ).data.data,
  });
  const expiresAt = query.data?.evidence?.expiresAt;
  const refetch = query.refetch;
  useEffect(() => {
    if (!expiresAt) return;
    const delay = Date.parse(expiresAt) - Date.now();
    if (delay <= 0) return;
    return atExpiry(expiresAt, () => void refetch());
  }, [expiresAt, refetch]);
  const [confirmation, setConfirmation] = useState<Extract<
    GstVerificationPreparation,
    { kind: 'CONFIRMATION' }
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const invoker = useRef<HTMLButtonElement | null>(null);
  const history = useQuery({
    queryKey: ['gst-verification-history', target],
    enabled: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<import('@erve/types').GstVerificationAttempt[]>>(
          `${PATH}/history`,
          {
            params: {
              gstin: target.gstin,
              sourceType: target.source?.type,
              sourceId: target.source?.id,
            },
          },
        )
      ).data.data,
  });
  async function execute(intentId: string) {
    const result = (
      await apiClient.post<ApiSuccessResponse<GstVerificationView>>(`${PATH}/execute`, { intentId })
    ).data.data;
    client.setQueryData(key, result);
    void client.invalidateQueries({ queryKey: ['gst-verification-history', target] });
  }
  async function prepare(refresh: boolean, button: HTMLButtonElement) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    invoker.current = button;
    try {
      const result = (
        await apiClient.post<ApiSuccessResponse<GstVerificationPreparation>>(`${PATH}/prepare`, {
          target,
          refresh,
        })
      ).data.data;
      if (result.kind === 'RESULT') client.setQueryData(key, result.view);
      else if (result.mode === 'DEMO') await execute(result.intentId);
      else setConfirmation(result);
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to verify GSTIN. Saving remains available.'));
      void query.refetch();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!confirmation || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await execute(confirmation.intentId);
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to verify GSTIN. Saving remains available.'));
      void query.refetch();
    } finally {
      submitting.current = false;
      setBusy(false);
      setConfirmation(null);
    }
  }
  const view = query.data;
  if (query.isPending)
    return <p className="text-xs text-muted-foreground">Loading saved verification…</p>;
  if (query.isError)
    return (
      <ValidationMessage tone="warning">
        Saved verification is unavailable. Saving remains available.{' '}
        <Button type="button" variant="ghost" onClick={() => void query.refetch()}>
          Retry saved result
        </Button>
      </ValidationMessage>
    );
  if (!view?.enabled) return null;
  return (
    <section
      aria-label="GSTIN verification"
      className="min-w-0 space-y-2 rounded border border-border-subtle p-3"
    >
      <GstinVerificationResult view={view} />
      {error && (
        <div role="alert">
          <ValidationMessage tone="error">{error}</ValidationMessage>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!readOnly && view.canVerify && view.cacheState !== 'FRESH' && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !!confirmation}
            onClick={(event) => void prepare(false, event.currentTarget)}
          >
            {view.level === 'COMPLETE' ? 'Retrieve Complete Profile' : 'Verify GSTIN'}
          </Button>
        )}
        {!readOnly && view.canRefresh && view.evidence && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !!confirmation}
            onClick={(event) => void prepare(true, event.currentTarget)}
          >
            Reverify GSTIN
          </Button>
        )}
      </div>
      {view.evidence && (
        <details
          onToggle={(event) => {
            if (event.currentTarget.open && !history.data && !history.isFetching)
              void history.refetch();
          }}
        >
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Verification history
          </summary>
          {history.isError ? (
            <p className="text-xs">History unavailable.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {history.data?.map((attempt) => (
                <li key={attempt.id}>
                  {stamp(attempt.createdAt)} · {attempt.outcome.replaceAll('_', ' ')}
                  {attempt.refresh ? ' · Explicit refresh' : ''}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      <ConfirmDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!busy && !open) setConfirmation(null);
        }}
        loading={busy}
        title={
          confirmation?.refresh
            ? 'Reverify GSTIN'
            : confirmation?.level === 'COMPLETE'
              ? 'Retrieve Complete Profile'
              : 'Verify GSTIN — Basic'
        }
        description={
          confirmation
            ? `${confirmation.gstin} · ${confirmation.level === 'COMPLETE' ? 'Complete Profile' : 'Basic Verification'} · Live Mode. ${confirmation.refresh ? 'Cached information will be bypassed. ' : ''}Fresh cached information is ${confirmation.freshCacheAvailable ? 'available' : 'not available'}. This verification may consume ${confirmation.estimatedCredits} API credit${confirmation.estimatedCredits === 1 ? '' : 's'}. Proceed?`
            : ''
        }
        confirmLabel="Proceed"
        onConfirm={() => void confirm()}
        onCloseAutoFocus={(event) => {
          if (invoker.current?.isConnected && !invoker.current.disabled) {
            event.preventDefault();
            invoker.current.focus();
          }
        }}
      />
    </section>
  );
}

export function AccountantGstinLookup() {
  const [gstin, setGstin] = useState('');
  const [requested, setRequested] = useState('');
  return (
    <Panel title="GSTIN verification">
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          label="GSTIN to verify"
          value={gstin}
          onChange={(event) => {
            setGstin(event.target.value);
            setRequested('');
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!isValidGstinFormat(gstin)}
          onClick={() => setRequested(normalizeGstin(gstin))}
        >
          View saved verification
        </Button>
      </div>
      {requested && (
        <div className="mt-3">
          <GstinVerificationPanel gstin={requested} standalone />
        </div>
      )}
    </Panel>
  );
}
