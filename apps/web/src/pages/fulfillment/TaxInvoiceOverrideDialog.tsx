import { useRef, useState, type FormEvent } from 'react';
import type { TaxInvoiceLineView } from '@erve/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  NumericField,
  TextareaField,
  ValidationMessage,
} from '@erve/primitives';
import { FormSection } from '@erve/layout';
import { formatInvoiceMoney } from './tax-invoice-ui.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';

export function TaxInvoiceOverrideDialog({
  line,
  pending,
  onClose,
  onSave,
}: {
  line: TaxInvoiceLineView;
  pending: boolean;
  onClose: () => void;
  onSave: (input: { lineId: string; overrideUnitRate: number; reason: string }) => Promise<unknown>;
}) {
  const [rate, setRate] = useState<number | null>(
    line.overrideUnitRate === null ? null : Number(line.overrideUnitRate),
  );
  const [valid, setValid] = useState(true);
  const [reason, setReason] = useState(line.overrideReason ?? '');
  const [error, setError] = useState('');
  const saving = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || saving.current) return;
    if (rate === null || rate <= 0 || !valid || !reason.trim()) {
      setError('Enter a positive rate and a reason for this override.');
      return;
    }
    saving.current = true;
    try {
      await onSave({ lineId: line.id, overrideUnitRate: rate, reason: reason.trim() });
      onClose();
    } catch (caught) {
      setError(
        getApiErrorMessage(caught, 'Unable to save the override. Your entries have been retained.'),
      );
    } finally {
      saving.current = false;
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && !saving.current) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override unit rate</DialogTitle>
          <DialogDescription>
            {line.style.styleNumber} · {line.size.label} · {line.quantity} pieces · original rate{' '}
            {formatInvoiceMoney(line.calculatedUnitRate)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save}>
          <FormSection title="Accountant rate correction">
            <NumericField
              label="Override unit rate (₹)"
              required
              mode="currency"
              precision={2}
              min={0.01}
              value={rate}
              onChange={setRate}
              onValidationChange={setValid}
              disabled={pending}
              helpText="Normal currency entry, up to two decimal places. Quantities remain unchanged."
            />
            <TextareaField
              label="Override reason"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
            />
            {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
          </FormSection>
          <DialogFooter>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                if (!saving.current) onClose();
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
