import { Link } from 'react-router-dom';
import {
  PageHeader,
  StatusBadge,
  type JobOrderOperationalPresentation,
} from '@erve/app-components';
import { Button } from '@erve/primitives';
import type { UsePdfActionResult } from '../../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../../lib/pdf/components/PdfActionButtons.js';
import { StyleThumbnailCell } from '../../../components/style/StyleThumbnailCell.js';
import { StyleIdentityUnavailable } from '../../../components/style/StyleIdentityUnavailable.js';
import { resolveJobOrderSeasonSnapshot } from './resolveJobOrderSeasonSnapshot.js';
import type { JobOrder } from '../types.js';
import { IDENTITY_HEADER_IMAGE_SIZE } from '../../../components/style/identity-header-image-size.js';
import {
  resolveJobOrderPrimaryStyle,
  type JobOrderPrimaryStyle,
} from '../resolveJobOrderPrimaryStyle.js';

export interface JobOrderHeaderActions {
  canSend: boolean;
  onSend: () => void;
  sendError: string;
  canConfirm: boolean;
  onConfirm: () => void;
  confirmPending: boolean;
  confirmDisabled: boolean;
  confirmError: string;
  canCancelJobOrder: boolean;
  onCancel: () => void;
}

export interface JobOrderPageHeaderProps {
  jobOrderNumber: string;
  factoryName: string;
  lines: JobOrderPrimaryStyle[];
  pdfAction: UsePdfActionResult;
  seasonSnapshots: JobOrder['seasonSnapshots'];
  isDelayed: boolean;
  operationalPresentation: JobOrderOperationalPresentation;
  actions: JobOrderHeaderActions;
}

/** One identity, operational context and action location for the Job Order. */
export function JobOrderPageHeader({
  jobOrderNumber,
  factoryName,
  lines,
  pdfAction,
  seasonSnapshots,
  isDelayed,
  operationalPresentation,
  actions,
}: JobOrderPageHeaderProps) {
  // A Job Order is exactly one Style by business rule — same as an Order
  // Sheet — regardless of how many source Order Sheets or Size/allocation
  // lines it has. resolveJobOrderPrimaryStyle's "inconsistent" branch is a
  // defensive check against legacy data that violates that rule, never a
  // legitimate "this Job Order has several Styles" case, so it's never
  // rendered as if nothing were wrong.
  const primaryStyle = resolveJobOrderPrimaryStyle(lines);
  const season = resolveJobOrderSeasonSnapshot(seasonSnapshots);
  return (
    <PageHeader
      title={jobOrderNumber}
      className="job-order-header"
      wrapActions
      subtitle={
        primaryStyle.consistent
          ? `${primaryStyle.style.styleNumber} / ${primaryStyle.style.styleName}`
          : 'Style identity unavailable'
      }
      status={isDelayed ? <StatusBadge label="Delayed" tone="warning" /> : undefined}
      details={
        <div className="mt-1 space-y-1 text-xs">
          <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span className="min-w-0 break-words">Factory: {factoryName}</span>
            <span className="min-w-0 break-words">Season: {season.label}</span>
          </div>
          <div
            aria-label="Current Job Order operational state"
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
          >
            <span className="min-w-0 break-words font-medium text-foreground">
              {operationalPresentation.heading}: {operationalPresentation.name}
            </span>
            {operationalPresentation.stateLabel && (
              <StatusBadge
                label={operationalPresentation.stateLabel}
                tone={operationalPresentation.tone}
              />
            )}
            {operationalPresentation.secondaryLanes.map((lane) => (
              <span key={lane.domain} className="min-w-0 break-words text-muted-foreground">
                {lane.heading}: {lane.name !== lane.heading ? `${lane.name} / ` : ''}
                {lane.stateLabel}
              </span>
            ))}
          </div>
        </div>
      }
      leadingVisual={
        primaryStyle.consistent ? (
          <StyleThumbnailCell
            styleId={primaryStyle.style.styleId}
            image={primaryStyle.style.primaryImage}
            size={IDENTITY_HEADER_IMAGE_SIZE}
            viewerTitle={primaryStyle.style.styleNumber}
          />
        ) : (
          <StyleIdentityUnavailable
            size={IDENTITY_HEADER_IMAGE_SIZE}
            reason="Style identity unavailable — this Job Order's lines disagree on Style, which should never happen. Reported for investigation, not guessed."
          />
        )
      }
      secondaryActions={
        <>
          {actions.canSend && (
            <div className="flex flex-col items-end gap-1">
              <Button variant="default" onClick={actions.onSend}>
                Send to Factory
              </Button>
              {actions.sendError ? (
                <p
                  className="max-w-md text-right text-xs text-[var(--erp-form-field-error-text-color)]"
                  role="alert"
                >
                  {actions.sendError}
                </p>
              ) : null}
            </div>
          )}
          {actions.canConfirm && (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="default"
                disabled={actions.confirmDisabled}
                onClick={actions.onConfirm}
                loading={actions.confirmPending}
              >
                Confirm
              </Button>
              {actions.confirmError ? (
                <p
                  className="max-w-md text-right text-xs text-[var(--erp-form-field-error-text-color)]"
                  role="alert"
                >
                  {actions.confirmError}
                </p>
              ) : actions.confirmDisabled ? (
                <p className="max-w-xs text-right text-xs text-muted-foreground">
                  Review and acknowledge the disclaimer in Production before confirming.
                </p>
              ) : null}
            </div>
          )}
          {actions.canCancelJobOrder && (
            <Button variant="destructive" onClick={actions.onCancel}>
              Cancel Job Order
            </Button>
          )}

          <PdfActionButtons
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        </>
      }
    />
  );
}
