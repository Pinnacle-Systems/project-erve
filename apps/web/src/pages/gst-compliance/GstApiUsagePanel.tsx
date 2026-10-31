import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, GstApiUsageToday } from '@erve/types';
import { Button, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';

const PATH = '/gst-compliance/usage';
const stamp = (value: string) => new Date(value).toLocaleString('en-IN');

// Observational only and manual only: nothing here runs on mount, on a timer, on focus or
// when settings change. The query is disabled, so only the button can fetch.
export function GstApiUsagePanel() {
  const inFlight = useRef(false);
  const query = useQuery({
    queryKey: ['gst-api-usage'],
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<GstApiUsageToday>>(PATH)).data.data,
  });
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await query.refetch();
    } finally {
      inFlight.current = false;
    }
  }
  // A failed refresh keeps the last successful values; they are never replaced by zeros.
  const usage = query.data;
  const failed = query.isError;
  const fetching = query.isFetching;
  const values: [string, number][] = usage
    ? [
        ['Total Calls', usage.totalCalls],
        ['Successful', usage.successfulCalls],
        ['Errors', usage.errorCalls],
        ['Credits Used Today', usage.creditsUsed],
      ]
    : [];
  return (
    <Panel
      title="GSTINAPI — Today's Usage"
      actions={
        <Button
          type="button"
          variant="secondary"
          loading={fetching}
          disabled={fetching}
          onClick={() => void refresh()}
        >
          Refresh Usage
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Statistics are for the API key configured on the ERVE server and cover the provider&apos;s
          current day. Retrieving them does not run a GSTIN verification.
        </p>
        {fetching && (
          <p role="status" className="text-muted-foreground">
            Retrieving usage…
          </p>
        )}
        {failed && !fetching && (
          <div role="alert">
            <ValidationMessage tone="error">
              {getApiErrorMessage(query.error, 'Unable to retrieve GSTINAPI usage. Try again.')}
            </ValidationMessage>
          </div>
        )}
        {usage ? (
          <>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {values.map(([label, value]) => (
                <div key={label} className="min-w-0 rounded border border-border-subtle p-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground">
              {failed ? 'Last successful retrieval' : 'Retrieved'} on {stamp(usage.fetchedAt)}
              {failed ? ' — the latest refresh failed and these values may be outdated.' : '.'}
            </p>
          </>
        ) : (
          !fetching &&
          !failed && (
            <p className="text-muted-foreground">
              Usage has not been retrieved. Select Refresh Usage to load today&apos;s statistics.
            </p>
          )
        )}
      </div>
    </Panel>
  );
}
