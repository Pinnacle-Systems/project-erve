import { useState } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  CloseEwayBillDemoAttemptRequest,
  CloseEwayBillDemoAttemptResponse,
  EwayBillAttemptView,
  EwayBillAuditEvent,
  EwayBillHistoryResponse,
  EwayBillReadinessResponse,
  LinkEwayBillRequest,
  LinkEwayBillResponse,
} from '@erve/types';
import { AuditTrail } from '@erve/app-components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  ValidationMessage,
} from '@erve/primitives';
import { Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { AttemptOutcomeBadge, ModeBadge, VerificationBadge } from './EwayBillBadges.js';
import { EwayBillCallout } from './EwayBillCallout.js';
import { EwayBillLinkDialog } from './EwayBillLinkDialog.js';
import { ewayBillAuditTitle, formatDateTime } from './eway-bill-ui.js';

const MIN_REASON = 10;
const MAX_REASON = 500;

interface Props {
  invoiceStatus: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  canManage: boolean;
  query: UseQueryResult<EwayBillHistoryResponse>;
  linkage: EwayBillReadinessResponse['linkage'] | undefined;
  link: UseMutationResult<LinkEwayBillResponse, unknown, LinkEwayBillRequest>;
  closeDemo: UseMutationResult<
    CloseEwayBillDemoAttemptResponse,
    unknown,
    CloseEwayBillDemoAttemptRequest & { attemptId: string }
  >;
}

function auditDescription(event: EwayBillAuditEvent): string {
  const metadata = event.metadata ?? {};
  const parts: string[] = [];
  if (typeof metadata.ewayBillNumber === 'string') parts.push(`E-Way Bill ${metadata.ewayBillNumber}`);
  if (typeof metadata.reason === 'string') parts.push(`Reason: ${metadata.reason}`);
  if (metadata.changes && typeof metadata.changes === 'object') {
    const fields = Object.keys(metadata.changes);
    if (fields.length > 0) parts.push(`Changed: ${fields.join(', ')}`);
  }
  return parts.join(' · ');
}

export function EwayBillHistorySection({
  invoiceStatus,
  canManage,
  query,
  linkage,
  link,
  closeDemo,
}: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkedNumber, setLinkedNumber] = useState<string | null>(null);
  const [closing, setClosing] = useState<EwayBillAttemptView | null>(null);
  const [reason, setReason] = useState('');
  const [closeError, setCloseError] = useState('');
  const [closedNotice, setClosedNotice] = useState(false);

  const history = query.data;
  const liveBill = linkage?.ewayBill ?? linkage?.unverifiedReference ?? null;
  const linkBlockedReason = !canManage
    ? null
    : invoiceStatus !== 'FINALIZED'
      ? 'An E-Way Bill can be linked only to a finalized Tax Invoice.'
      : liveBill
        ? 'An E-Way Bill is already linked to this invoice.'
        : linkage?.state === 'UNRECONCILED_ATTEMPT'
          ? 'A live request for this invoice is unfinished and must be reconciled first.'
          : null;

  function openClose(attempt: EwayBillAttemptView) {
    setClosing(attempt);
    setReason('');
    setCloseError('');
    setClosedNotice(false);
  }
  function dismissClose() {
    if (closeDemo.isPending) return;
    setClosing(null);
    setReason('');
    setCloseError('');
  }
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= MIN_REASON;

  async function submitClose() {
    if (!closing || !reasonValid || closeDemo.isPending) return;
    setCloseError('');
    try {
      await closeDemo.mutateAsync({
        attemptId: closing.id,
        expectedOutcome: closing.outcome as CloseEwayBillDemoAttemptRequest['expectedOutcome'],
        reason: trimmedReason,
      });
      setClosing(null);
      setReason('');
      setClosedNotice(true);
    } catch (caught) {
      setCloseError(getApiErrorMessage(caught, 'Unable to close this Demo attempt.'));
    }
  }

  let body;
  if (query.isPending) body = <LoadingState label="Loading E-Way Bill history" />;
  else if (!history)
    body = (
      <ErrorState
        title="Unable to load E-Way Bill history"
        description={getApiErrorMessage(query.error, 'Try again.')}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  else {
    const billsById = new Map(history.ewayBills.map((bill) => [bill.id, bill]));
    body = (
      <div className="space-y-5">
        <section className="space-y-2" aria-label="E-Way Bills on record">
          <h3 className="text-sm font-semibold">E-Way Bills on record</h3>
          {history.ewayBills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No E-Way Bill is recorded for this invoice.</p>
          ) : (
            <ul className="space-y-2">
              {history.ewayBills.map((bill) => (
                <li
                  key={bill.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm"
                >
                  <span className="font-medium tabular-nums">{bill.ewayBillNumber}</span>
                  <ModeBadge mode={bill.integrationMode} />
                  <VerificationBadge status={bill.verificationStatus} />
                  <span className="text-muted-foreground">
                    {bill.source === 'EXTERNALLY_LINKED' ? 'Linked' : 'Generated'} by{' '}
                    {bill.createdBy.name} · {formatDateTime(bill.createdAt)}
                    {bill.status === 'CANCELLED' ? ' · Cancelled' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-label="Attempt history">
          <h3 className="text-sm font-semibold">Attempt history</h3>
          {closedNotice && (
            <div role="status">
              <ValidationMessage tone="success">
                Demo attempt closed. Nothing was retried.
              </ValidationMessage>
            </div>
          )}
          {history.attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No generation attempts yet.</p>
          ) : (
            <ul className="space-y-3">
              {history.attempts.map((attempt) => {
                const bill = attempt.ewayBillId ? billsById.get(attempt.ewayBillId) : undefined;
                const closable = canManage && attempt.integrationMode === 'DEMO' && attempt.open;
                return (
                  <li key={attempt.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <ModeBadge mode={attempt.integrationMode} />
                      <AttemptOutcomeBadge outcome={attempt.outcome} />
                      <span className="text-muted-foreground">
                        {formatDateTime(attempt.createdAt)} · {attempt.actor.name}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      Document {attempt.document.type} {attempt.document.number}
                    </p>
                    {attempt.failureMessage && (
                      <p className="break-words">
                        {attempt.failureMessage}
                        {attempt.failureCode && (
                          <span className="text-muted-foreground"> ({attempt.failureCode})</span>
                        )}
                      </p>
                    )}
                    {attempt.open && (
                      <p className={attempt.requiresReview ? 'font-medium' : 'text-muted-foreground'}>
                        {attempt.requiresReview
                          ? 'Needs review by a person.'
                          : 'May still be in progress.'}
                        {attempt.reviewAfter &&
                          ` Review ${attempt.requiresReview ? 'due since' : 'after'} ${formatDateTime(attempt.reviewAfter)}.`}
                      </p>
                    )}
                    {bill && (
                      <p className="flex flex-wrap items-center gap-2">
                        <span>Associated E-Way Bill:</span>
                        <span className="font-medium tabular-nums">{bill.ewayBillNumber}</span>
                        <VerificationBadge status={bill.verificationStatus} />
                      </p>
                    )}
                    {attempt.resolution && (
                      <p className="text-muted-foreground">
                        Closed by {attempt.resolution.by.name} on{' '}
                        {formatDateTime(attempt.resolution.at)}. Reason: {attempt.resolution.reason}
                      </p>
                    )}
                    {closable && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!attempt.requiresReview}
                          onClick={() => openClose(attempt)}
                        >
                          Close Demo Attempt
                        </Button>
                        {!attempt.requiresReview && (
                          <span className="text-muted-foreground">
                            Available once the review time has passed.
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2" aria-label="E-Way Bill audit events">
          <h3 className="text-sm font-semibold">Audit events</h3>
          <AuditTrail
            items={history.events.map((event) => ({
              id: event.id,
              title: ewayBillAuditTitle(event.action),
              actor: event.actor?.name ?? 'System',
              timestamp: formatDateTime(event.createdAt),
              description: auditDescription(event),
            }))}
            emptyState="No E-Way Bill events recorded."
          />
        </section>
      </div>
    );
  }

  return (
    <Panel
      title="Existing E-Way Bill and history"
      description="Link a bill generated outside ERVE India, and review every generation attempt."
      actions={
        canManage ? (
          <Button
            type="button"
            variant="secondary"
            disabled={linkBlockedReason !== null}
            onClick={() => {
              setLinkedNumber(null);
              setLinkOpen(true);
            }}
          >
            Link Existing E-Way Bill
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {linkBlockedReason && <p className="text-sm text-muted-foreground">{linkBlockedReason}</p>}
        {linkedNumber && (
          <EwayBillCallout tone="warning" role="status" title="Linked as an unverified reference">
            <p>
              E-Way Bill {linkedNumber} is recorded for this invoice. It was generated outside ERVE
              India and has not been verified; it is not statutory clearance.
            </p>
          </EwayBillCallout>
        )}
        {body}
      </div>
      <EwayBillLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        link={link}
        onLinked={setLinkedNumber}
      />
      <Dialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) dismissClose();
        }}
      >
        <DialogContent aria-busy={closeDemo.isPending || undefined}>
          <DialogHeader>
            <DialogTitle>Close this Demo attempt?</DialogTitle>
            <DialogDescription>
              Closing is an administrative recovery action. It does not prove whether the provider
              processed the request, and it does not create, remove or verify any E-Way Bill.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitClose();
            }}
          >
            <p className="text-sm">
              The invoice is then released for another Demo test. Nothing is retried automatically.
            </p>
            {closeError && <ValidationMessage tone="error">{closeError}</ValidationMessage>}
            <Textarea
              label="Reason"
              value={reason}
              maxLength={MAX_REASON}
              rows={3}
              disabled={closeDemo.isPending}
              onChange={(event) => setReason(event.target.value)}
              helpText={`At least ${MIN_REASON} characters.`}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={closeDemo.isPending} onClick={dismissClose}>
                Keep attempt open
              </Button>
              <Button
                type="submit"
                loading={closeDemo.isPending}
                disabled={!reasonValid || closeDemo.isPending}
              >
                Confirm closure
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
