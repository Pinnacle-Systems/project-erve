import type { JobOrderOperationalPresentation } from '@erve/app-components';
import { StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import type { JobOrderStyleSummary } from './job-order-detail-utils.js';

export interface JobOrderStickyContextActions {
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

export interface JobOrderStickyContextProps {
  jobOrderNumber: string;
  style: JobOrderStyleSummary;
  factoryName: string;
  isDelayed: boolean;
  operationalPresentation: JobOrderOperationalPresentation;
  actions: JobOrderStickyContextActions;
}

/**
 * The page's single canonical location for Job Order identity/status and
 * the Send/Confirm/Cancel actions — sticky below the app shell header (via
 * --app-shell-header-height, published by AppShell from the header's real
 * measured height) so both stay visible while scrolling through a tab's
 * content. Deliberately compact: one row of identity/status, actions beside
 * it, no duplicate of this content anywhere else on the page.
 */
export function JobOrderStickyContext({
  jobOrderNumber,
  style,
  factoryName,
  isDelayed,
  operationalPresentation,
  actions,
}: JobOrderStickyContextProps) {
  return (
    <div
      className="sticky z-[100] flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-2 shadow-[var(--erp-shadow-xs)] md:px-8"
      style={{ top: 'var(--app-shell-header-height, 4rem)' }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{jobOrderNumber}</span>
          <span className="text-xs text-muted-foreground">
            {style.label} · {factoryName}
          </span>
        </div>
        <div
          className="min-w-0 max-w-xl border-l border-border-subtle pl-3"
          aria-label="Current Job Order operational state"
        >
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {operationalPresentation.heading}
          </p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-sm font-semibold text-foreground">
              {operationalPresentation.name}
            </span>
            {operationalPresentation.stateLabel && (
              <StatusBadge label={operationalPresentation.stateLabel} tone={operationalPresentation.tone} />
            )}
            {isDelayed && <StatusBadge label="Delayed" tone="warning" />}
          </div>
          {operationalPresentation.secondaryLanes.length > 0 && (
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1">
              {operationalPresentation.secondaryLanes.map((lane) => (
                <div key={lane.domain} className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-muted-foreground">{lane.heading}:</span>
                  {lane.name !== lane.heading && (
                    <span className="min-w-0 break-words font-medium text-foreground">{lane.name}</span>
                  )}
                  {lane.stateLabel && <span className="font-medium text-foreground">{lane.stateLabel}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {actions.canSend && (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={actions.onSend}>Send to Factory</Button>
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
            ) : null}
          </div>
        )}
        {actions.canCancelJobOrder && (
          <Button variant="destructive" onClick={actions.onCancel}>
            Cancel Job Order
          </Button>
        )}
      </div>
    </div>
  );
}
