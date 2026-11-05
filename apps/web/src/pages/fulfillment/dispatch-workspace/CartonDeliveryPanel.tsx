import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  CartonDeliverySummary,
  CartonDeliverySummaryItem,
} from '@erve/types';
import { canMutateErveDispatch } from '@erve/shared';
import { Panel } from '@erve/layout';
import { useAuth } from '../../../auth/AuthContext.js';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';

const formatTime = (instant: string) =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(instant));

function CredentialManagement({
  item,
  onClose,
  onSaved,
}: {
  item: CartonDeliverySummaryItem;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [action, setAction] = useState(item.credentialId && !item.revokedAt ? 'revoke' : 'reissue');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.post(`/carton-delivery/credentials/${item.cartonId}`, {
        action,
        reason: reason.trim(),
        expectedTokenId: item.credentialId ?? null,
        ...(action === 'extend' ? { extendedUntil: new Date(until).toISOString() } : {}),
        ...(action === 'reissue' ? { acknowledgeReplacement: acknowledge } : {}),
      }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate();
  }
  return (
    <form
      className="space-y-3 rounded border p-4"
      onSubmit={submit}
      aria-label="Manage carton QR credential"
    >
      <h3 className="font-semibold">
        Manage credential: Carton {item.cartonNumber} / {item.labelReference ?? item.cartonId}
      </h3>
      <label className="block">
        Action
        <select
          className="ml-2 rounded border bg-background p-2"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          {item.credentialId && !item.revokedAt && <option value="revoke">Revoke</option>}
          {item.credentialId && !item.revokedAt && <option value="extend">Extend expiry</option>}
          <option value="reissue">Reissue QR</option>
        </select>
      </label>
      <label className="block">
        Audit reason
        <textarea
          className="mt-1 w-full rounded border bg-background p-2"
          required
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {action === 'extend' && (
        <label className="block">
          New expiry (device timezone)
          <input
            className="ml-2 rounded border bg-background p-2"
            type="datetime-local"
            required
            value={until}
            onChange={(event) => setUntil(event.target.value)}
          />
        </label>
      )}
      {action === 'revoke' && <p>This QR will stop accepting delivery submissions immediately.</p>}
      {action === 'reissue' && (
        <label className="flex gap-2">
          <input
            type="checkbox"
            required
            checked={acknowledge}
            onChange={(event) => setAcknowledge(event.target.checked)}
          />
          I will replace attached carton contents labels using the existing Print/Download Label
          action. The previous QR will stop working.
        </label>
      )}
      {mutation.isError && (
        <p role="alert">
          {getApiErrorMessage(
            mutation.error,
            'Unable to update credential. Refresh and try again.',
          )}
        </p>
      )}
      <div className="flex gap-3">
        <button
          className="rounded border px-3 py-2"
          disabled={mutation.isPending || !reason.trim()}
          type="submit"
        >
          Confirm credential action
        </button>
        <button
          className="rounded border px-3 py-2"
          disabled={mutation.isPending}
          type="button"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CartonDeliveryPanel({ dispatchId }: { dispatchId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const [managing, setManaging] = useState<CartonDeliverySummaryItem | null>(null);
  const cursor = cursors.at(-1);
  const key = ['carton-delivery', user?.id, dispatchId];
  const query = useQuery({
    queryKey: [...key, cursor],
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<CartonDeliverySummary>>(
          `/carton-delivery/dispatches/${dispatchId}`,
          { params: { limit: 25, ...(cursor ? { cursor } : {}) } },
        )
      ).data.data,
  });
  if (query.isPending) return <p role="status">Loading QR carton delivery evidence…</p>;
  if (query.isError)
    return (
      <Panel title="QR Carton Delivery Evidence">
        <p role="alert">Unable to load carton evidence.</p>
        <button onClick={() => void query.refetch()}>Retry</button>
      </Panel>
    );
  const data = query.data;
  if (!data.enabled) return null;
  return (
    <Panel title="QR Carton Delivery Evidence">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Carton QR confirmations are separate from Distributor Receipt quantities and the Dispatch
          delivery status.
        </p>
        <div className="flex flex-wrap gap-5 font-semibold">
          <span>Total cartons: {data.totalCartons}</span>
          <span>QR-confirmed cartons: {data.confirmedCartons}</span>
          <span>Pending cartons: {data.pendingCartons}</span>
        </div>
        <button
          className="rounded border px-3 py-2"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh QR evidence
        </button>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Carton / label reference</th>
                <th className="p-2">Delivery evidence</th>
                <th className="p-2">Submitted (India time)</th>
                <th className="p-2">Remarks</th>
                {user && canMutateErveDispatch(user) && <th className="p-2">Credential</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.cartonId} className="border-t align-top">
                  <td className="p-2">
                    Carton {item.cartonNumber}
                    <div className="break-all">
                      {item.labelReference ?? `QR not issued · ${item.cartonId}`}
                    </div>
                  </td>
                  <td className="p-2">
                    {item.evidence ? (
                      <>
                        <div>{item.evidence.recipientName}</div>
                        <div>{formatTime(item.evidence.deliveredAt)} IST</div>
                        <div className="text-xs">Captured timezone: {item.evidence.timezone}</div>
                      </>
                    ) : (
                      'Pending'
                    )}
                  </td>
                  <td className="p-2">
                    {item.evidence ? formatTime(item.evidence.submittedAt) : '—'}
                  </td>
                  <td className="whitespace-pre-wrap break-words p-2">
                    {item.evidence?.remarks ?? '—'}
                  </td>
                  {user && canMutateErveDispatch(user) && (
                    <td className="p-2">
                      {item.revokedAt && <span>Revoked </span>}
                      <button className="underline" onClick={() => setManaging(item)}>
                        Manage credential
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4">
          {cursors.length > 0 && (
            <button
              disabled={query.isFetching}
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
            >
              Previous cartons
            </button>
          )}
          {data.pageInfo.hasMore && (
            <button
              disabled={query.isFetching}
              onClick={() => {
                if (data.pageInfo.nextCursor)
                  setCursors((previous) => [...previous, data.pageInfo.nextCursor!]);
              }}
            >
              Next cartons
            </button>
          )}
        </div>
        {managing && (
          <CredentialManagement
            key={managing.cartonId}
            item={managing}
            onClose={() => setManaging(null)}
            onSaved={() => queryClient.invalidateQueries({ queryKey: key })}
          />
        )}
      </div>
    </Panel>
  );
}
