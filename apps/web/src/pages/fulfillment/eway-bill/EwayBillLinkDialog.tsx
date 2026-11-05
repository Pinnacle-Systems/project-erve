import { useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { LinkEwayBillRequest, LinkEwayBillResponse } from '@erve/types';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import { getApiErrorMessage } from '../../../lib/api-errors.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: UseMutationResult<LinkEwayBillResponse, unknown, LinkEwayBillRequest>;
  onLinked: (ewayBillNumber: string) => void;
}

export function EwayBillLinkDialog({ open, onOpenChange, link, onLinked }: Props) {
  const [number, setNumber] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const trimmed = number.trim();
  const valid = /^\d{12}$/.test(trimmed);
  const pending = link.isPending;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setNumber('');
      setConfirmed(false);
      setError('');
    }
    onOpenChange(next);
  }

  async function submit() {
    if (!valid || !confirmed || pending) return;
    setError('');
    try {
      await link.mutateAsync({ ewayBillNumber: trimmed });
      onLinked(trimmed);
      close(false);
    } catch (caught) {
      setError(getApiErrorMessage(caught, 'Unable to link this E-Way Bill number.'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent aria-busy={pending || undefined}>
        <DialogHeader>
          <DialogTitle>Link an existing E-Way Bill</DialogTitle>
          <DialogDescription>
            Record the number of an E-Way Bill that was generated outside ERVE India.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>ERVE India has not verified this number.</li>
            <li>It is stored only as an unverified reference.</li>
            <li>Linking is not statutory clearance.</li>
            <li>
              A linked number cannot be edited or removed from here. Check it carefully before you
              confirm.
            </li>
          </ul>
          {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
          <TextField
            label="E-Way Bill number"
            value={number}
            maxLength={12}
            inputMode="numeric"
            autoComplete="off"
            disabled={pending}
            onChange={(event) => setNumber(event.target.value)}
            errorMessage={
              trimmed.length > 0 && !valid ? 'An E-Way Bill number is exactly 12 digits.' : undefined
            }
            width="full"
          />
          <Checkbox
            id="eway-link-confirm"
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            disabled={pending}
            label="I have checked this number. It was generated outside ERVE India and is not verified here."
          />
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!valid || !confirmed || pending}>
              Link as unverified reference
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
