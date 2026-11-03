import { useEffect, useState } from 'react';
import { isValidGstinFormat, normalizeGstin } from '@erve/shared';
import type { GstVerificationSource, GstVerificationTarget, GstVerificationView } from '@erve/types';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { GstinLiveConfirmDialog, GstinVerificationHistory } from './GstinVerificationParts.js';
import { atExpiry, useGstinVerification, useGstVerificationPolicy } from './useGstinVerification.js';

const UNAVAILABLE = 'Information unavailable';
export function formatFiledPeriod(period: string | null): string {
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return UNAVAILABLE;
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`));
}
export const stamp = (value: string) => new Date(value).toLocaleString('en-IN');

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
        <div>
          <dt className="text-muted-foreground">Registration date</dt>
          <dd>{field('registration_date', evidence.registrationDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Business constitution</dt>
          <dd>{field('business_constitution', evidence.businessConstitution)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Registered address</dt>
          <dd>{field('address', evidence.registeredAddress)}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground">
        {evidence.mode === 'DEMO' ? 'Sample retrieved' : 'Last verified'} on{' '}
        {stamp(evidence.retrievedAt)}
        {stale ? ' — information may be outdated.' : ''}
      </p>
      {view.level === 'COMPLETE' && evidence.level === 'BASIC' && (
        <p>Fresh Complete Profile information is unavailable.</p>
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
/**
 * Standalone, saved-record panel. The editable forms use GstinVerificationField;
 * this remains the Accountant lookup utility in GST Compliance Settings.
 */
export function GstinVerificationPanel(props: Props) {
  const policy = useGstVerificationPolicy();
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
  const verification = useGstinVerification(target);
  const { view, busy, error, confirmation } = verification;
  if (verification.isPending)
    return <p className="text-xs text-muted-foreground">Loading saved verification…</p>;
  if (verification.isError)
    return (
      <ValidationMessage tone="warning">
        Saved verification is unavailable. Saving remains available.{' '}
        <Button type="button" variant="ghost" onClick={() => void verification.refetch()}>
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
            onClick={(event) => void verification.verify(false, event.currentTarget)}
          >
            {view.level === 'COMPLETE' ? 'Retrieve Complete Profile' : 'Verify GSTIN'}
          </Button>
        )}
        {!readOnly && view.canRefresh && view.evidence && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !!confirmation}
            onClick={(event) => void verification.verify(true, event.currentTarget)}
          >
            Reverify GSTIN
          </Button>
        )}
      </div>
      {view.evidence && <GstinVerificationHistory target={target} />}
      <GstinLiveConfirmDialog verification={verification} />
    </section>
  );
}

export function AccountantGstinLookup() {
  const [gstin, setGstin] = useState('');
  const [requested, setRequested] = useState('');
  return (
    <Panel title="GSTIN verification">
      <div className="flex flex-wrap items-center gap-2">
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
