import { useState } from 'react';
import type { TaxInvoiceBillToSnapshot } from '@erve/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  TextField,
  ValidationMessage,
} from '@erve/primitives';
import { useBillToRefreshPreview, useRefreshBillTo } from './tax-invoice-queries.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';

const fields: [keyof TaxInvoiceBillToSnapshot, string][] = [
  ['name', 'Name'],
  ['gstin', 'GSTIN'],
  ['contactName', 'Contact'],
  ['contactEmail', 'Email'],
  ['contactPhone', 'Phone'],
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['postalCode', 'Postal code'],
  ['country', 'Country'],
];
export function TaxInvoiceBillToRefreshDialog({
  id,
  version,
  disabled,
  onOpenChange,
}: {
  id: string;
  version: number;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const preview = useBillToRefreshPreview(id, version);
  const mutation = useRefreshBillTo(id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [error, setError] = useState('');
  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  const proposal = preview.data;
  const reload = async () => {
    const result = await preview.refetch();
    if (!result.isError) {
      setError('');
      setRequestKey(crypto.randomUUID());
    }
  };
  const apply = async () => {
    if (!proposal) return;
    try {
      await mutation.mutateAsync({
        key: requestKey,
        input: {
          expectedVersion: proposal.expectedVersion,
          expectedMasterUpdatedAt: proposal.expectedMasterUpdatedAt,
          proposedFingerprint: proposal.proposedFingerprint,
          reason: reason.trim(),
        },
      });
      changeOpen(false);
      setReason('');
      setError('');
    } catch (failure) {
      setError(
        getApiErrorMessage(
          failure,
          'Unable to apply the Bill-To correction. Retry or reload the comparison.',
        ),
      );
    }
  };
  return (
    <>
      {preview.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking Bill-To source details...
        </p>
      )}
      {preview.isError && (
        <ValidationMessage tone="error">
          Unable to check current Bill-To details.{' '}
          <Button variant="secondary" onClick={() => void reload()}>
            Retry Bill-To check
          </Button>
        </ValidationMessage>
      )}
      {proposal?.changed && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle p-3">
          <p className="text-sm">
            Bill-To details have changed in Distributor {proposal.distributor.code} -{' '}
            {proposal.distributor.name}.
          </p>
          <Button
            variant="secondary"
            disabled={disabled || preview.isFetching || preview.isError}
            onClick={() => {
              setReason('');
              setError('');
              setRequestKey(crypto.randomUUID());
              changeOpen(true);
            }}
          >
            Review Bill-To changes
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) changeOpen(next);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Correct draft Bill-To details</DialogTitle>
            <DialogDescription>
              Compare this draft with its current Distributor master. Applying changes keeps the
              same draft and commercial lines. A reason is required.
            </DialogDescription>
          </DialogHeader>
          {proposal && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr>
                      <th className="p-2">Field</th>
                      <th className="p-2">Saved on this draft</th>
                      <th className="p-2">Current Distributor details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map(([key, label]) => (
                      <tr
                        key={key}
                        className={
                          proposal.current[key] !== proposal.proposed[key] ? 'bg-muted' : ''
                        }
                      >
                        <th scope="row" className="p-2 align-top">
                          {label}
                        </th>
                        <td className="p-2 break-words">
                          {proposal.current[key] || 'Not recorded'}
                        </td>
                        <td className="p-2 break-words">
                          {proposal.proposed[key] || 'Not recorded'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">
                Proposed State code: {proposal.validation.stateCode ?? 'Unresolved'}; GSTIN prefix:{' '}
                {proposal.proposed.gstin.slice(0, 2)}
              </p>
              {proposal.validation.blockers.map((blocker) => (
                <ValidationMessage key={blocker.code} tone="error">
                  {blocker.message}
                </ValidationMessage>
              ))}
            </>
          )}
          {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
          {preview.isError && (
            <ValidationMessage tone="error">
              The comparison could not be refreshed. Reload it before applying.
            </ValidationMessage>
          )}
          <TextField
            label="Reason for correction (mandatory)"
            aria-label="Reason for Bill-To correction"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            disabled={mutation.isPending}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              disabled={mutation.isPending || preview.isFetching}
              onClick={() => void reload()}
            >
              Reload comparison
            </Button>
            <Button
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => changeOpen(false)}
            >
              Back
            </Button>
            <Button
              disabled={
                !proposal ||
                !proposal.changed ||
                !reason.trim() ||
                proposal.validation.blockers.length > 0 ||
                disabled ||
                preview.isFetching ||
                preview.isError
              }
              loading={mutation.isPending}
              onClick={() => void apply()}
            >
              Apply Bill-To correction
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
