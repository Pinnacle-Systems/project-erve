import { useQuery } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  GstVerificationAttempt,
  GstVerificationTarget,
} from '@erve/types';
import { ConfirmDialog } from '@erve/app-components';
import { apiClient } from '../../lib/api-client.js';
import {
  confirmationDescription,
  confirmationTitle,
  GST_VERIFICATION_PATH,
  type GstinVerificationController,
} from './useGstinVerification.js';

const stamp = (value: string) => new Date(value).toLocaleString('en-IN');

/** The explicit Live confirmation. Rendered only once the server has issued a
 * confirmation; closing it never performs a lookup. */
export function GstinLiveConfirmDialog({
  verification,
}: {
  verification: GstinVerificationController;
}) {
  const { confirmation, busy, invoker } = verification;
  return (
    <ConfirmDialog
      open={!!confirmation}
      onOpenChange={(open) => {
        if (!busy && !open) verification.cancel();
      }}
      loading={busy}
      title={confirmation ? confirmationTitle(confirmation) : 'Verify GSTIN'}
      description={confirmation ? confirmationDescription(confirmation) : ''}
      confirmLabel="Proceed"
      onConfirm={() => void verification.confirm()}
      onCloseAutoFocus={(event) => {
        const trigger = invoker.current;
        if (trigger?.isConnected && !(trigger as HTMLButtonElement).disabled) {
          event.preventDefault();
          trigger.focus();
        }
      }}
    />
  );
}

/** Lazy history: nothing is requested until the user opens the disclosure. */
export function GstinVerificationHistory({ target }: { target: GstVerificationTarget }) {
  const history = useQuery({
    queryKey: ['gst-verification-history', target],
    enabled: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<GstVerificationAttempt[]>>(
          `${GST_VERIFICATION_PATH}/history`,
          {
            params: {
              gstin: target.gstin,
              sourceType: target.source?.type,
              sourceId: target.source?.id,
            },
          },
        )
      ).data.data,
  });
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && !history.data && !history.isFetching)
          void history.refetch();
      }}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Verification history
      </summary>
      {history.isError ? (
        <p className="text-xs">History unavailable.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {history.data?.map((attempt) => (
            <li key={attempt.id}>
              {stamp(attempt.createdAt)} · {attempt.outcome.replaceAll('_', ' ')}
              {attempt.refresh ? ' · Explicit refresh' : ''}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
