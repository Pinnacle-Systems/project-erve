import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, ErveDispatchTransportView } from '@erve/types';
import { PageHeader, createEnterToNextHandler } from '@erve/app-components';
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ValidationMessage,
} from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../../lib/cursor-list.js';
import { useAuth } from '../../../auth/AuthContext.js';
import { TransportFields, type TransportFieldsValue } from './TransportFields.js';

export function AssignedTransportList() {
  const { user } = useAuth();
  const { query, items } = useCursorList<ErveDispatchTransportView>({
    queryKey: ['assigned-transport', user?.id],
    path: '/erve-dispatches/assigned-transport',
    params: { limit: 25 },
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Assigned Dispatches"
        subtitle="Transport information for your assigned dispatches"
      />
      {query.isLoading ? (
        <LoadingState label="Loading assigned dispatches" />
      ) : query.isError ? (
        <ErrorState title="Unable to load assigned dispatches" description={query.error.message} />
      ) : (
        <DataTable
          rowKey="id"
          data={items}
          emptyState={<EmptyState title="No assigned dispatches" />}
          columns={[
            {
              key: 'number',
              header: 'Dispatch #',
              render: (row) => (
                <Link
                  className="underline"
                  to={`/fulfillment/erve-dispatches/${row.id}?tab=transport-delivery`}
                >
                  {row.erveDispatchNumber}
                </Link>
              ),
            },
            {
              key: 'date',
              header: 'Dispatch Date',
              render: (row) => new Date(row.dispatchDate).toLocaleDateString(),
            },
            { key: 'transporter', header: 'Transporter', render: (row) => row.transporter ?? '—' },
            { key: 'vehicle', header: 'Vehicle Number', render: (row) => row.vehicleNumber ?? '—' },
            { key: 'lr', header: 'LR Number', render: (row) => row.lrNumber ?? '—' },
            { key: 'status', header: 'Status', accessor: 'status' },
          ]}
        />
      )}
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['dispatch', 'dispatches'])} />
    </div>
  );
}

export function AssignedTransportWorkspace({ id }: { id: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Partial<TransportFieldsValue>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [stale, setStale] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const key = ['assigned-transport-detail', user?.id, id];
  useEffect(() => {
    if (params.get('tab') !== 'transport-delivery')
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('tab', 'transport-delivery');
          return next;
        },
        { replace: true },
      );
  }, [params, setParams]);
  const query = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<ErveDispatchTransportView>>(
          `/erve-dispatches/${id}/transport`,
        )
      ).data.data,
  });
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch<ApiSuccessResponse<ErveDispatchTransportView>>(
          `/erve-dispatches/${id}/lr`,
          {
            expectedVersion: query.data!.version,
            transporter: draft.transporter ?? query.data!.transporter,
            vehicleNumber: draft.vehicleNumber ?? query.data!.vehicleNumber,
            lrNumber: draft.lrNumber ?? query.data!.lrNumber,
          },
        )
      ).data.data,
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setDraft({});
      setError('');
      setSuccess(true);
      void queryClient.invalidateQueries({ queryKey: ['assigned-transport', user?.id] });
    },
    onError: (caught) => {
      setSuccess(false);
      setError(getApiErrorMessage(caught, 'Unable to update transport information.'));
      if (isAxiosError(caught)) {
        if (caught.response?.status === 409) setStale(true);
        if ([401, 403, 404].includes(caught.response?.status ?? 0)) {
          setRevoked(true);
          queryClient.removeQueries({ queryKey: ['assigned-transport', user?.id] });
        }
      }
    },
  });
  if (query.isLoading) return <LoadingState label="Loading transport information" />;
  if (revoked || query.isError)
    return (
      <ErrorState
        title="Transport access unavailable"
        description="This dispatch may no longer be assigned to your account."
      />
    );
  if (!query.data) return <EmptyState title="Transport access unavailable" />;
  const dispatch = query.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title={dispatch.erveDispatchNumber}
        subtitle={`${new Date(dispatch.dispatchDate).toLocaleDateString()} | ${dispatch.status}`}
      />
      <Link className="underline" to="/fulfillment/erve-dispatches">
        Assigned Dispatches
      </Link>
      <Tabs value="transport-delivery">
        <TabsList aria-label="Dispatch workspace">
          <TabsTrigger value="transport-delivery">Transport &amp; Delivery</TabsTrigger>
        </TabsList>
        <TabsContent value="transport-delivery" className="space-y-4 pt-4">
          <Panel title="Update Transport / LR Information">
            {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
            {success && <p role="status">Transport information saved.</p>}
            {stale && (
              <div role="alert">
                <p>
                  This dispatch has changed. Refresh and review the latest details before retrying.
                  Your entries will be kept.
                </p>
                <Button
                  variant="secondary"
                  disabled={query.isFetching}
                  onClick={async () => {
                    const result = await query.refetch();
                    if (!result.isError) {
                      setStale(false);
                      setError('');
                    }
                  }}
                >
                  Refresh Dispatch
                </Button>
              </div>
            )}
            <form
              onKeyDown={createEnterToNextHandler()}
              onSubmit={(event) => {
                event.preventDefault();
                if (!mutation.isPending && !stale) mutation.mutate();
              }}
            >
              <TransportFields
                value={{
                  transporter: draft.transporter ?? dispatch.transporter ?? '',
                  vehicleNumber: draft.vehicleNumber ?? dispatch.vehicleNumber ?? '',
                  lrNumber: draft.lrNumber ?? dispatch.lrNumber ?? '',
                }}
                onChange={(field, value) => {
                  setDraft((current) => ({ ...current, [field]: value }));
                  setSuccess(false);
                }}
                disabled={mutation.isPending}
              />
              <div className="mt-3 flex justify-end">
                <Button
                  type="submit"
                  disabled={mutation.isPending || stale}
                  loading={mutation.isPending}
                >
                  Save
                </Button>
              </div>
            </form>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
