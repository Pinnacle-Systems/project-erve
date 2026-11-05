import { useRef, useState } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  EwayBillGenerateResponse,
  EwayBillGenerationPreviewResponse,
  EwayBillHistoryResponse,
  GenerateEwayBillDemoRequest,
} from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { EwayBillCallout } from './EwayBillCallout.js';
import {
  DISPATCH_FROM_LABEL,
  SHIP_TO_LABEL,
  groupBlockers,
  hasOpenAttempt,
  isOutcomeUnknownError,
  isVerifiedRead,
  isStaleVersionError,
} from './eway-bill-ui.js';

const TRANSACTION_TYPE_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: 'Regular',
  2: 'Bill To – Ship To',
  3: 'Bill From – Dispatch From',
  4: 'Combination of Bill To – Ship To and Bill From – Dispatch From',
};

type GenerationResult =
  | { kind: 'response'; data: EwayBillGenerateResponse }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown' };

interface Props {
  query: UseQueryResult<EwayBillGenerationPreviewResponse>;
  canManage: boolean;
  history: UseQueryResult<EwayBillHistoryResponse>;
  /** When the latest generation request began; reads older than this are unverified. */
  requestStartedAt: number | null;
  onRequestStart: () => void;
  /** Re-reads preview, history and readiness. */
  onRefreshStatus: () => void;
  generate: UseMutationResult<EwayBillGenerateResponse, unknown, GenerateEwayBillDemoRequest>;
}

export function EwayBillGenerationSection({
  query,
  canManage,
  history,
  requestStartedAt,
  onRequestStart,
  onRefreshStatus,
  generate,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const submitting = useRef(false);
  const preview = query.data;

  async function confirmGeneration() {
    if (submitting.current || !preview || preview.movementVersion === null) return;
    submitting.current = true;
    setResult(null);
    // From here on, only reads completed after this moment describe the outcome.
    onRequestStart();
    try {
      // Only the movement version and the acknowledgement are sent: mode,
      // test_mode and credentials are decided by the server, never the browser.
      const data = await generate.mutateAsync({
        expectedMovementVersion: preview.movementVersion,
        ...(preview.acknowledgementRequired && acknowledged
          ? { acknowledgeApplicabilityUndetermined: true }
          : {}),
      });
      setResult({ kind: 'response', data });
    } catch (caught) {
      setResult(
        isOutcomeUnknownError(caught)
          ? { kind: 'unknown' }
          : {
              kind: 'refused',
              message: isStaleVersionError(caught)
                ? 'The movement information changed after this preview was loaded. Nothing was sent. The preview has been refreshed; review it and try again.'
                : getApiErrorMessage(caught, 'The request was not accepted. Nothing was sent.'),
            },
      );
    } finally {
      submitting.current = false;
      setDialogOpen(false);
      setAcknowledged(false);
    }
  }

  let body;
  if (query.isPending) body = <LoadingState label="Loading generation preview" />;
  else if (!preview)
    body = (
      <ErrorState
        title="Unable to load generation preview"
        description={getApiErrorMessage(query.error, 'Try again.')}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  else {
    const { request, demo, linkage } = preview;
    const demoBill = linkage.syntheticRecords.demoBill;
    // Cached data may only block; it never proves that nothing is open.
    const openDemoAttempt =
      linkage.syntheticRecords.openDemoAttempts > 0 ||
      hasOpenAttempt(history.data?.attempts ?? []);
    const refreshing = query.isFetching || history.isFetching;
    const verified =
      isVerifiedRead(query, requestStartedAt) &&
      isVerifiedRead(history, requestStartedAt) &&
      !refreshing;
    const groups = groupBlockers(request.blockers, demo.blockers);
    const canGenerate =
      canManage &&
      preview.invoiceStatus === 'FINALIZED' &&
      demo.available &&
      request.ready &&
      !openDemoAttempt &&
      !demoBill &&
      preview.movementVersion !== null &&
      !generate.isPending &&
      verified;

    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={request.ready ? 'Request ready' : 'Request blocked'}
            tone={request.ready ? 'success' : 'warning'}
          />
          <span className="text-sm text-muted-foreground">
            {request.ready
              ? 'No known blocker among the verified requirements. This does not guarantee that the portal will accept the request.'
              : 'Resolve the items below, then refresh the preview.'}
          </span>
        </div>
        <DescriptionList columns={3}>
          <DescriptionList.Item
            label="Document"
            value={
              request.document
                ? `${request.document.type} ${request.document.number} · ${request.document.date}`
                : 'Not available until the request is ready'
            }
          />
          <DescriptionList.Item label="Items" value={String(request.itemCount)} />
          <DescriptionList.Item
            label="Transaction classification"
            value={
              request.classification
                ? `${TRANSACTION_TYPE_LABEL[request.classification.transactionType]} · Ship-to: ${SHIP_TO_LABEL[request.classification.shipTo]} · Dispatch-from: ${DISPATCH_FROM_LABEL[request.classification.dispatchFrom]}`
                : 'Not available until the request is ready'
            }
          />
        </DescriptionList>
        {groups.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Items to resolve</h3>
            {groups.map((group) => (
              <div key={group.source}>
                <h4 className="text-sm font-medium">{group.label}</h4>
                <ul className="mt-1 list-disc space-y-1 break-words pl-5 text-sm">
                  {group.blockers.map((blocker) => (
                    <li key={`${blocker.code}:${blocker.field}`}>
                      {blocker.message}{' '}
                      <span className="text-muted-foreground">({blocker.code})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {request.warnings.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Warnings</h3>
            <ul className="mt-1 list-disc space-y-1 break-words pl-5 text-sm">
              {request.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          </div>
        )}
        {request.assumptions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Unverified assumptions</h3>
            <p className="text-sm text-muted-foreground">
              These requirements could not be verified from an official source and are not
              enforced.
            </p>
            <ul className="mt-1 list-disc space-y-1 break-words pl-5 text-sm">
              {request.assumptions.map((assumption) => (
                <li key={assumption.code}>
                  {assumption.message}{' '}
                  <span className="text-muted-foreground">Basis: {assumption.basis}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Live (statutory) E-Way Bill generation is not available in ERVE India.
        </p>
        {!verified && !refreshing && !generate.isPending && (
          <EwayBillCallout tone="warning" role="alert" title="Latest status could not be confirmed">
            <p>
              The preview or the attempt history could not be read after the last request, so what
              is shown may be out of date. Generation stays disabled until both are read again.
            </p>
            <Button type="button" variant="secondary" onClick={onRefreshStatus}>
              Refresh status
            </Button>
          </EwayBillCallout>
        )}
        {result && <GenerationOutcome result={result} reconciled={verified} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={query.isFetching && !query.isPending}
            onClick={() => void query.refetch()}
          >
            Refresh preview
          </Button>
          {canManage ? (
            <Button
              type="button"
              disabled={!canGenerate}
              onClick={() => {
                setResult(null);
                setAcknowledged(false);
                setDialogOpen(true);
              }}
            >
              Generate Demo E-Way Bill
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              View only — an Accountant performs E-Way Bill operations.
            </span>
          )}
        </div>
        {canManage && !canGenerate && !generate.isPending && (
          <p className="text-sm text-muted-foreground">
            {!verified
              ? refreshing
                ? 'Refreshing the latest state…'
                : 'Generation is disabled until the latest status has been read.'
              : demoBill
              ? 'A Demo E-Way Bill already exists for this invoice.'
              : openDemoAttempt
                ? 'An earlier request is unfinished. Resolve it in the attempt history before generating again.'
                : refreshing
                  ? 'Refreshing the latest state…'
                  : preview.invoiceStatus !== 'FINALIZED'
                    ? 'Demo generation needs a finalized Tax Invoice.'
                    : 'Demo generation is not available until the items above are resolved.'}
          </p>
        )}
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!generate.isPending) setDialogOpen(open);
          }}
        >
          <DialogContent aria-busy={generate.isPending || undefined}>
            <DialogHeader>
              <DialogTitle>Generate a Demo E-Way Bill?</DialogTitle>
              <DialogDescription>
                This sends a request to the GSTINAPI Demo service.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <ul className="list-disc space-y-1 pl-5">
                <li>The resulting E-Way Bill is synthetic.</li>
                <li>It has no statutory validity.</li>
                <li>It is not a government filing.</li>
              </ul>
              {preview.acknowledgementRequired && (
                <Checkbox
                  id="eway-ack-applicability"
                  checked={acknowledged}
                  onCheckedChange={(checked) => setAcknowledged(checked === true)}
                  disabled={generate.isPending}
                  label="Applicability has not been automatically determined, and I have determined it myself."
                />
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={generate.isPending}
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                loading={generate.isPending}
                disabled={generate.isPending || (preview.acknowledgementRequired && !acknowledged)}
                onClick={() => void confirmGeneration()}
              >
                Confirm Demo generation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <Panel
      title="Generation preview"
      description="What would be sent to the provider, and what still blocks it."
    >
      {body}
    </Panel>
  );
}

function GenerationOutcome({
  result,
  reconciled,
}: {
  result: GenerationResult;
  reconciled: boolean;
}) {
  if (result.kind === 'unknown') {
    return (
      <EwayBillCallout tone="warning" role="alert" title="Request status unknown">
        <p>
          The request did not complete normally and may have reached the provider. It has not been
          retried, and it is not assumed to have failed.
        </p>
        <p>
          {reconciled
            ? 'The attempt history and preview have been reloaded. Check the attempt history below before doing anything else.'
            : 'The latest state has not been confirmed yet. Refresh the status and check the attempt history before doing anything else.'}
        </p>
      </EwayBillCallout>
    );
  }
  if (result.kind === 'refused') {
    return (
      <EwayBillCallout tone="danger" role="alert" title="Demo generation was not started">
        <p>{result.message}</p>
      </EwayBillCallout>
    );
  }
  const { data } = result;
  if (data.outcome === 'SUCCEEDED' && data.ewayBill) {
    return (
      <EwayBillCallout tone="info" role="status" title="Demo E-Way Bill — Test only">
        <p className="text-lg font-semibold tabular-nums">{data.ewayBill.ewayBillNumber}</p>
        <p>
          This is a synthetic test record. It has no statutory validity and is not a government
          filing.
        </p>
        {data.alreadyExisted && (
          <p>The provider reported that this synthetic bill already existed.</p>
        )}
      </EwayBillCallout>
    );
  }
  if (data.outcome === 'UNCERTAIN') {
    return (
      <EwayBillCallout tone="warning" role="alert" title="Generation outcome unknown">
        <p>
          {data.failure?.message ??
            'The provider did not give a definite answer, so the outcome is unknown.'}
        </p>
        <p>
          Do not retry. The attempt stays open until a person reviews it and closes it from the
          attempt history below.
        </p>
      </EwayBillCallout>
    );
  }
  return (
    <EwayBillCallout tone="danger" role="alert" title="Rejected by provider">
      <p>{data.failure?.message ?? 'The provider refused the request.'}</p>
      {data.failure?.code && <p className="text-muted-foreground">Code: {data.failure.code}</p>}
      <p>Another attempt is offered once the latest state has been reloaded.</p>
    </EwayBillCallout>
  );
}
