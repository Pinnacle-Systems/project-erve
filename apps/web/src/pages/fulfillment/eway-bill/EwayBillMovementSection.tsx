import { useState } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  EwayBillMovementRecord,
  UpdateEwayBillMovementRequest,
} from '@erve/types';
import {
  Button,
  DatePicker,
  NumericField,
  SelectField,
  SelectItem,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { ErrorState, LoadingState } from '@erve/data-display';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import {
  DISPATCH_FROM_LABEL,
  MOVEMENT_LIMITS,
  SHIP_TO_LABEL,
  TRANSPORT_MODE_LABEL,
  VEHICLE_TYPE_LABEL,
  formToMovementRequest,
  getFieldErrors,
  isMovementDirty,
  isStaleVersionError,
  movementToForm,
  type DispatchFromFormState,
  type MovementFormState,
} from './eway-bill-ui.js';

const NONE = '__NONE__';

function EnumSelect<T extends string>({
  label,
  value,
  labels,
  onChange,
  disabled,
  errorMessage,
}: {
  label: string;
  value: T | null;
  labels: Record<T, string>;
  onChange: (value: T | null) => void;
  disabled: boolean;
  errorMessage?: string;
}) {
  return (
    <SelectField
      label={label}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : (next as T))}
      disabled={disabled}
      errorMessage={errorMessage}
      width="full"
    >
      <SelectItem value={NONE}>Not set</SelectItem>
      {(Object.keys(labels) as T[]).map((key) => (
        <SelectItem key={key} value={key}>
          {labels[key]}
        </SelectItem>
      ))}
    </SelectField>
  );
}

interface FormProps {
  record: EwayBillMovementRecord;
  /** null = editable; otherwise the reason it is read-only. */
  readOnlyReason: string | null;
  /** Offered while the block is a status read that failed or is unverified. */
  onRetry?: () => void;
  save: UseMutationResult<EwayBillMovementRecord, unknown, UpdateEwayBillMovementRequest>;
  onSaved: () => void;
  onEdit: () => void;
  onReload: () => Promise<void>;
}

function MovementForm({ record, readOnlyReason, onRetry, save, onSaved, onEdit, onReload }: FormProps) {
  const baseline = movementToForm(record.movement);
  const [form, setForm] = useState<MovementFormState>(baseline);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [distanceValid, setDistanceValid] = useState(true);
  const [reloading, setReloading] = useState(false);

  const readOnly = readOnlyReason !== null;
  const busy = save.isPending || reloading;
  const disabled = readOnly || busy;
  const dirty = isMovementDirty(form, baseline);

  function update(values: Partial<MovementFormState>) {
    onEdit();
    setForm((current) => ({ ...current, ...values }));
  }
  function updateDispatchFrom(values: Partial<DispatchFromFormState>) {
    onEdit();
    setForm((current) => ({ ...current, dispatchFrom: { ...current.dispatchFrom, ...values } }));
  }

  async function submit() {
    if (disabled || !dirty || !distanceValid) return;
    setError('');
    setStale(false);
    setFieldErrors({});
    try {
      await save.mutateAsync(formToMovementRequest(form, record.version));
      onSaved();
    } catch (caught) {
      // The form state is deliberately left untouched so nothing typed is lost.
      if (isStaleVersionError(caught)) {
        setStale(true);
        setError(
          'This movement information was changed by someone else after you loaded it. Your edits are kept below; reload to see the latest version.',
        );
      } else {
        setFieldErrors(getFieldErrors(caught));
        setError(getApiErrorMessage(caught, 'Unable to save movement information.'));
      }
    }
  }

  const differentPlace = form.dispatchFromArrangement === 'DIFFERENT_PLACE';

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {readOnly && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{readOnlyReason}</p>
          {onRetry && (
            <Button type="button" variant="secondary" onClick={onRetry}>
              Retry loading status
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className="space-y-2">
          <ValidationMessage tone="error">{error}</ValidationMessage>
          {stale && (
            <Button
              type="button"
              variant="secondary"
              loading={reloading}
              onClick={() => {
                setReloading(true);
                void onReload().finally(() => setReloading(false));
              }}
            >
              Discard my edits and reload
            </Button>
          )}
        </div>
      )}
      <FormGrid columns={2} gap="sm">
        <FormSection title="Transport">
          <div className="space-y-3">
            <EnumSelect
              label="Transport mode"
              value={form.transportMode}
              labels={TRANSPORT_MODE_LABEL}
              onChange={(transportMode) => update({ transportMode })}
              disabled={disabled}
              errorMessage={fieldErrors.transportMode}
            />
            <TextField
              label="Vehicle number"
              value={form.vehicleNumber}
              maxLength={MOVEMENT_LIMITS.vehicleNumber}
              disabled={disabled}
              onChange={(event) => update({ vehicleNumber: event.target.value })}
              errorMessage={fieldErrors.vehicleNumber}
              width="full"
            />
            <EnumSelect
              label="Vehicle type"
              value={form.vehicleType}
              labels={VEHICLE_TYPE_LABEL}
              onChange={(vehicleType) => update({ vehicleType })}
              disabled={disabled}
              errorMessage={fieldErrors.vehicleType}
            />
            <TextField
              label="Transporter ID"
              value={form.transporterId}
              maxLength={MOVEMENT_LIMITS.transporterId}
              disabled={disabled}
              onChange={(event) => update({ transporterId: event.target.value })}
              errorMessage={fieldErrors.transporterId}
              width="full"
            />
            <TextField
              label="Transporter name"
              value={form.transporterName}
              maxLength={MOVEMENT_LIMITS.transporterName}
              disabled={disabled}
              onChange={(event) => update({ transporterName: event.target.value })}
              errorMessage={fieldErrors.transporterName}
              width="full"
            />
            <TextField
              label="Transport document number"
              value={form.transportDocumentNumber}
              maxLength={MOVEMENT_LIMITS.transportDocumentNumber}
              disabled={disabled}
              onChange={(event) => update({ transportDocumentNumber: event.target.value })}
              errorMessage={fieldErrors.transportDocumentNumber}
              width="full"
            />
            <DatePicker
              label="Transport document date"
              value={form.transportDocumentDate}
              disabled={disabled}
              onValueChange={(value) => update({ transportDocumentDate: value ?? '' })}
              error={fieldErrors.transportDocumentDate}
              width="full"
            />
            <NumericField
              label="Approximate distance (km)"
              mode="integer"
              min={0}
              max={MOVEMENT_LIMITS.maxDistanceKm}
              value={form.approximateDistanceKm}
              disabled={disabled}
              onChange={(approximateDistanceKm) => update({ approximateDistanceKm })}
              onValidationChange={setDistanceValid}
              errorMessage={fieldErrors.approximateDistanceKm}
              helpText="Enter 0 if the portal should derive the distance."
              width="full"
            />
          </div>
        </FormSection>
        <FormSection title="Parties and locations">
          <div className="space-y-3">
            <EnumSelect
              label="Ship-to"
              value={form.shipToArrangement}
              labels={SHIP_TO_LABEL}
              onChange={(shipToArrangement) => update({ shipToArrangement })}
              disabled={disabled}
              errorMessage={fieldErrors.shipToArrangement}
            />
            <EnumSelect
              label="Dispatch-from"
              value={form.dispatchFromArrangement}
              labels={DISPATCH_FROM_LABEL}
              onChange={(dispatchFromArrangement) => update({ dispatchFromArrangement })}
              disabled={disabled}
              errorMessage={fieldErrors.dispatchFromArrangement}
            />
            {differentPlace && (
              <fieldset className="space-y-3 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">Dispatch-from address</legend>
                <TextField
                  label="Address line 1"
                  value={form.dispatchFrom.addressLine1}
                  maxLength={MOVEMENT_LIMITS.addressLine}
                  disabled={disabled}
                  onChange={(event) => updateDispatchFrom({ addressLine1: event.target.value })}
                  errorMessage={fieldErrors['dispatchFrom.addressLine1']}
                  width="full"
                />
                <TextField
                  label="Address line 2"
                  value={form.dispatchFrom.addressLine2}
                  maxLength={MOVEMENT_LIMITS.addressLine}
                  disabled={disabled}
                  onChange={(event) => updateDispatchFrom({ addressLine2: event.target.value })}
                  errorMessage={fieldErrors['dispatchFrom.addressLine2']}
                  width="full"
                />
                <TextField
                  label="City"
                  value={form.dispatchFrom.city}
                  maxLength={MOVEMENT_LIMITS.city}
                  disabled={disabled}
                  onChange={(event) => updateDispatchFrom({ city: event.target.value })}
                  errorMessage={fieldErrors['dispatchFrom.city']}
                  width="full"
                />
                <TextField
                  label="State"
                  value={form.dispatchFrom.state}
                  maxLength={MOVEMENT_LIMITS.state}
                  disabled={disabled}
                  onChange={(event) => updateDispatchFrom({ state: event.target.value })}
                  errorMessage={fieldErrors['dispatchFrom.state']}
                  width="full"
                />
                <TextField
                  label="GST state code"
                  value={form.dispatchFrom.stateCode}
                  maxLength={MOVEMENT_LIMITS.stateCode}
                  inputMode="numeric"
                  disabled={disabled}
                  onChange={(event) => updateDispatchFrom({ stateCode: event.target.value })}
                  errorMessage={fieldErrors['dispatchFrom.stateCode']}
                  width="full"
                />
                <TextField
                  label="PIN code"
                  value={form.dispatchFrom.postalCode}
                  maxLength={MOVEMENT_LIMITS.postalCode}
                  inputMode="numeric"
                  disabled={disabled}
                  onChange={(event) => updateDispatchFrom({ postalCode: event.target.value })}
                  errorMessage={fieldErrors['dispatchFrom.postalCode']}
                  width="full"
                />
              </fieldset>
            )}
          </div>
        </FormSection>
      </FormGrid>
      <p className="text-sm text-muted-foreground">
        {record.captured && record.updatedAt
          ? `Version ${record.version}${record.updatedBy ? ` · last saved by ${record.updatedBy.name}` : ''}. Saving replaces the whole movement record.`
          : 'No movement information saved yet. It may be saved partially and completed later.'}
      </p>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty || busy || !distanceValid}>
            Save movement information
          </Button>
        </div>
      )}
    </form>
  );
}

interface Props {
  query: UseQueryResult<EwayBillMovementRecord>;
  readOnlyReason: string | null;
  onRetry?: () => void;
  save: UseMutationResult<EwayBillMovementRecord, unknown, UpdateEwayBillMovementRequest>;
}

export function EwayBillMovementSection({ query, readOnlyReason, onRetry, save }: Props) {
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);

  let body;
  if (query.isPending) body = <LoadingState label="Loading movement information" />;
  else if (!query.data)
    body = (
      <ErrorState
        title="Unable to load movement information"
        description={getApiErrorMessage(query.error, 'Try again.')}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  else
    body = (
      <>
        {saved && (
          <div role="status">
            <ValidationMessage tone="success">Movement information saved.</ValidationMessage>
          </div>
        )}
        <MovementForm
          // Remount only on a new server version or an explicit reload, so a
          // background refetch can never overwrite what is being typed.
          key={`${query.data.version}:${revision}`}
          record={query.data}
          readOnlyReason={readOnlyReason}
          onRetry={onRetry}
          save={save}
          onSaved={() => setSaved(true)}
          onEdit={() => setSaved(false)}
          onReload={async () => {
            setSaved(false);
            await query.refetch();
            setRevision((value) => value + 1);
          }}
        />
      </>
    );

  return (
    <Panel
      title="Movement information"
      description="Goods-movement details for the E-Way Bill. These are recorded for this invoice only and do not change the physical dispatch."
    >
      <div className="space-y-4">
        {body}
      </div>
    </Panel>
  );
}
