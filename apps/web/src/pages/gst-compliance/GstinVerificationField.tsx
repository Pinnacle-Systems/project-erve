import {
  forwardRef,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { CircleCheck, FlaskConical, TriangleAlert } from 'lucide-react';
import { GST_DRAFT_SOURCE_ID, isValidGstinFormat, normalizeGstin } from '@erve/shared';
import type { GstSourceType, GstVerificationSource, GstVerificationTarget } from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
  type TextFieldProps,
} from '@erve/primitives';
import { deriveGstinFieldStatus, type GstinFieldStatus } from './gstinFieldStatus.js';
import { GstinVerificationResult } from './GstinVerificationPanel.js';
import { GstinLiveConfirmDialog, GstinVerificationHistory } from './GstinVerificationParts.js';
import {
  useGstinVerification,
  useGstVerificationPolicy,
  type GstinVerificationController,
} from './useGstinVerification.js';

/** The record kinds a GSTIN can belong to. `DISPATCH_ORDER` destinations are
 * display-only (the API refuses to start a lookup for them). */
export type GstVerifiableEntity = GstSourceType;

export const GSTIN_FORMAT_MESSAGE = 'Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)';

interface VerificationBinding {
  /** Master type for a record-bound GSTIN. Omitted for the standalone Accountant utility. */
  entity?: GstVerifiableEntity;
  /** Source-less Accountant lookup in GST Compliance Settings. Never grants permission itself. */
  standalone?: boolean;
  /** The saved record's id on edit/detail pages. Absent on create forms. */
  recordId?: string | null;
  /** The record's persisted GSTIN. Evidence is only attached to the saved record
   * while the input still equals it; any other value is verified as unsaved. */
  savedGstin?: string | null;
  /** Whether this input may offer a lookup. Defaults to true, except that a
   * `readOnly` field is display-only unless this is set to `true` explicitly
   * (a saved-record page where verifying is a deliberate, authorized action).
   * false: show existing evidence only and never offer a lookup. */
  allowVerify?: boolean;
}

function resolveSource(
  { entity, recordId, savedGstin }: VerificationBinding,
  gstin: string,
  allowVerify: boolean,
): GstVerificationSource | null {
  if (!entity) return null;
  if (recordId && (savedGstin === undefined || normalizeGstin(savedGstin ?? '') === gstin))
    return { type: entity, id: recordId };
  return allowVerify ? { type: entity, id: GST_DRAFT_SOURCE_ID } : null;
}

/**
 * All verification state for one GSTIN input. Reading evidence is cache-only;
 * nothing here starts a provider call except `verification.verify`, which the
 * controls call from a click.
 */
function useGstinFieldVerification(
  value: string,
  binding: VerificationBinding,
  { disabled, readOnly }: { disabled?: boolean; readOnly?: boolean },
) {
  const allowVerify = binding.allowVerify ?? !readOnly;
  // Standalone is only meaningful without a master entity. The API independently
  // enforces Accountant-only source-less read, prepare, history and execution.
  const standalone = binding.standalone === true && !binding.entity;
  const policy = useGstVerificationPolicy(!!binding.entity || standalone);
  const online = (!!binding.entity || standalone) && policy.data?.enabled === true;
  const gstin = normalizeGstin(value);
  const formatValid = isValidGstinFormat(gstin);
  const source = online && formatValid && !standalone ? resolveSource(binding, gstin, allowVerify) : null;
  const target: GstVerificationTarget | null =
    online && formatValid && (standalone || source)
      ? source
        ? { gstin, source }
        : { gstin }
      : null;
  const verification = useGstinVerification(target);
  const view = verification.view;
  const status: GstinFieldStatus = target
    ? deriveGstinFieldStatus(view, gstin)
    : { kind: 'none' };
  const canOfferVerify =
    !!target &&
    allowVerify &&
    !disabled &&
    !!view?.enabled &&
    view.canVerify &&
    view.cacheState !== 'FRESH';
  const verifyLabel =
    view?.cacheState === 'STALE'
      ? 'Reverify GSTIN'
      : view?.level === 'COMPLETE'
        ? 'Retrieve Complete Profile'
        : 'Verify GSTIN';
  return {
    online,
    gstin,
    formatValid,
    source,
    target,
    verification,
    status,
    canOfferVerify,
    verifyLabel,
    allowVerify,
    disabled,
    readOnly,
    note: fieldNote({ status, verification, allowVerify, hasTarget: !!target }),
  };
}
type FieldVerification = ReturnType<typeof useGstinFieldVerification>;

export interface GstinVerificationFieldProps
  extends Omit<TextFieldProps, 'value' | 'onChange' | 'endAdornment' | 'type'>,
    VerificationBinding {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Drop-in replacement for the GSTIN `TextField`.
 *
 * Online verification disabled (or unknown): renders as the TextField it
 * replaces and makes no verification requests. Enabled: validates the format
 * locally, offers an explicit Verify action once the format is valid, and shows
 * what the evidence on file permits for the GSTIN currently in the input.
 * Nothing here reads or writes any other form field.
 */
export function GstinVerificationField({
  value,
  onChange,
  onBlur,
  entity,
  recordId,
  savedGstin,
  standalone,
  allowVerify,
  errorMessage,
  helpText,
  disabled,
  readOnly,
  className,
  ...rest
}: GstinVerificationFieldProps) {
  const ui = useGstinFieldVerification(
    value,
    { entity, recordId, savedGstin, standalone, allowVerify },
    { disabled, readOnly },
  );
  const [touched, setTouched] = useState(false);
  const localError =
    ui.online && !readOnly && ui.gstin && !ui.formatValid && (touched || ui.gstin.length >= 15)
      ? GSTIN_FORMAT_MESSAGE
      : undefined;
  // Room for the adornments: the status icon and the compact Verify button.
  const hasIcon = ui.status.kind !== 'none';
  const padding =
    hasIcon && ui.canOfferVerify
      ? 'pr-[6.5rem]'
      : ui.canOfferVerify
        ? 'pr-[4.5rem]'
        : hasIcon
          ? 'pr-10'
          : '';
  return (
    <TextField
      {...rest}
      type="text"
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      onChange={onChange}
      onBlur={(event: FocusEvent<HTMLInputElement>) => {
        setTouched(true);
        onBlur?.(event);
      }}
      errorMessage={errorMessage ?? localError}
      helpText={ui.note ?? helpText}
      className={[className, padding].filter(Boolean).join(' ')}
      // Always an element: toggling "has adornment" would re-mount the <input>
      // and drop focus on the keystroke that completes a GSTIN.
      endAdornment={
        <div className="absolute inset-y-0 right-1 flex items-center gap-1">
          <GstinVerificationControls ui={ui} />
        </div>
      }
    />
  );
}

/**
 * Saved-record presentation for detail pages: the GSTIN as text with the same
 * badge, Verify action and profile modal as the field.
 */
export function GstinVerificationInline({
  gstin,
  entity,
  recordId,
  allowVerify,
}: {
  gstin: string | null | undefined;
  entity: GstVerifiableEntity;
  recordId: string;
  allowVerify?: boolean;
}) {
  const ui = useGstinFieldVerification(
    gstin ?? '',
    { entity, recordId, savedGstin: gstin, allowVerify },
    {},
  );
  if (!gstin) return <>—</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{gstin}</span>
      <GstinVerificationControls ui={ui} />
      {ui.note && <span className="w-full text-xs font-normal text-muted-foreground">{ui.note}</span>}
    </span>
  );
}

function GstinVerificationControls({ ui }: { ui: FieldVerification }) {
  const { verification, status, gstin, target } = ui;
  const [profileOpen, setProfileOpen] = useState(false);
  const statusButton = useRef<HTMLButtonElement | null>(null);
  const view = verification.view;
  return (
    <>
      {status.kind !== 'none' && (
        <StatusIconButton
          ref={statusButton}
          status={status}
          gstin={gstin}
          onClick={() => setProfileOpen(true)}
        />
      )}
      {ui.canOfferVerify && (
        <Button
          type="button"
          variant="secondary"
          density="compact"
          aria-label={ui.verifyLabel}
          title={ui.verifyLabel}
          loading={verification.busy}
          disabled={!!verification.confirmation}
          onClick={(event) => void verification.verify(false, event.currentTarget)}
        >
          Verify
        </Button>
      )}
      {target && view?.enabled && (
        <>
          <GstinProfileDialog
            open={profileOpen}
            onOpenChange={setProfileOpen}
            gstin={gstin}
            target={target}
            verification={verification}
            allowVerify={ui.allowVerify && !ui.disabled}
            returnFocusTo={statusButton}
            onReverify={() => {
              setProfileOpen(false);
              void verification.verify(true, statusButton.current);
            }}
          />
          <GstinLiveConfirmDialog verification={verification} />
        </>
      )}
    </>
  );
}

function fieldNote({
  status,
  verification,
  allowVerify,
  hasTarget,
}: {
  status: GstinFieldStatus;
  verification: GstinVerificationController;
  allowVerify: boolean;
  hasTarget: boolean;
}): ReactNode {
  if (!hasTarget) return null;
  if (verification.error)
    return (
      <span role="alert" className="text-warning">
        {verification.error}
      </span>
    );
  if (status.kind === 'demo')
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <StatusBadge label="Demo Sample" tone="draft" />
        <span>Sample data only. This GSTIN is not verified.</span>
      </span>
    );
  if (status.kind === 'attention') return <span className="text-warning">{status.message}</span>;
  const view = verification.view;
  if (allowVerify && view?.enabled && !view.canVerify && view.cacheState !== 'FRESH')
    return view.mode === 'LIVE' ? <span>Live verification requires an Accountant.</span> : null;
  if (allowVerify && verification.isError)
    return <span>Verification status is unavailable. Saving remains available.</span>;
  return null;
}

const StatusIconButton = forwardRef<
  HTMLButtonElement,
  { status: GstinFieldStatus; gstin: string; onClick: () => void }
>(({ status, gstin, onClick }, ref) => {
  if (status.kind === 'none') return null;
  const spec =
    status.kind === 'verified'
      ? {
          label: `GSTIN ${gstin} verified. View registration details`,
          Icon: CircleCheck,
          tone: 'text-success',
        }
      : status.kind === 'demo'
        ? {
            label: `Demo sample result, not a verification of ${gstin}. View sample details`,
            Icon: FlaskConical,
            tone: 'text-info',
          }
        : {
            label: `${status.message} View details`,
            Icon: TriangleAlert,
            tone: 'text-warning',
          };
  return (
    <button
      ref={ref}
      type="button"
      aria-label={spec.label}
      title={spec.label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-control ${spec.tone} transition-colors hover:bg-surface-muted focus:outline-hidden focus-visible:ring-[length:var(--erp-focus-ring-width)] focus-visible:ring-[var(--erp-focus-ring)]`}
    >
      <spec.Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
});
StatusIconButton.displayName = 'StatusIconButton';

/** Shows the evidence already on file. Opening or closing it never calls the provider. */
function GstinProfileDialog({
  open,
  onOpenChange,
  gstin,
  target,
  verification,
  allowVerify,
  returnFocusTo,
  onReverify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gstin: string;
  target: GstVerificationTarget;
  verification: GstinVerificationController;
  allowVerify: boolean;
  returnFocusTo: RefObject<HTMLElement | null>;
  onReverify: () => void;
}) {
  const view = verification.view;
  if (!view) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto"
        // Portaled content still bubbles React events to the surrounding <form>.
        onKeyDown={(event) => event.stopPropagation()}
        // Opened from our own button (no Dialog.Trigger), so give focus back to it.
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>GSTIN verification</DialogTitle>
          <DialogDescription>
            {gstin}
            {view.mode === 'DEMO' ? ' · Demo Mode' : ' · Live Mode'}
          </DialogDescription>
        </DialogHeader>
        <GstinVerificationResult view={view} />
        {view.evidence && (
          <div className="mt-3">
            <GstinVerificationHistory target={target} />
          </div>
        )}
        <DialogFooter>
          {allowVerify && view.canRefresh && view.evidence && (
            <Button
              type="button"
              variant="secondary"
              density="comfortable"
              disabled={verification.busy}
              onClick={onReverify}
            >
              Reverify GSTIN
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            density="comfortable"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
