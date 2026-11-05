import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { createEnterToNextHandler, PageHeader } from '@erve/app-components';
import { Button, DatePicker, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { canMutateErveDispatches } from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { getLocalDateString } from '../../lib/dates.js';
import type { ErvePackingListDetail } from './types.js';

export function ErveDispatchRecordPage() {
  const [params] = useSearchParams();
  const id = params.get('ervePackingListId')?.trim() ?? '';
  return <RecordDispatchContent key={id} id={id} />;
}

function RecordDispatchContent({ id }: { id: string }) {
  const { user } = useAuth();
  const canRecord = canMutateErveDispatches(user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const [dispatchDate, setDispatchDate] = useState(getLocalDateString);
  const [transporter, setTransporter] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['erve-packing-list', id],
    enabled: canRecord && Boolean(id),
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<ErvePackingListDetail>>(
          `/erve-packing-lists/${encodeURIComponent(id)}`,
        )
      ).data.data,
  });
  const packingList = query.data;
  const eligible = canRecord && packingList?.status === 'FINALIZED' && !packingList.dispatch;
  useEffect(() => {
    if (packingList?.status === 'DISPATCHED' && packingList.dispatch) {
      navigate(`/fulfillment/erve-dispatches/${packingList.dispatch.id}`, { replace: true });
    }
  }, [packingList, navigate]);
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<ApiSuccessResponse<{ id: string }>>('/erve-dispatches', {
          ervePackingListId: id,
          dispatchDate,
          transporter: transporter || null,
          vehicleNumber: vehicleNumber || null,
          lrNumber: lrNumber || null,
          remarks: remarks || null,
        })
      ).data.data,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['erve-packing-list', id] });
      void queryClient.invalidateQueries({ queryKey: ['erve-packing-lists'] });
      void queryClient.invalidateQueries({ queryKey: ['erve-dispatches'] });
      navigate(`/fulfillment/erve-dispatches/${created.id}`);
    },
    onError: (caught) => {
      setError(getApiErrorMessage(caught, 'Unable to record this dispatch.'));
      // Another operator may have recorded it since this page loaded.
      void query.refetch();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  if (!canRecord) return <ErrorState title="Not authorized to record dispatches" />;
  if (!id)
    return (
      <EmptyState
        title="Select a finalized Erve Packing List to record dispatch"
        description={<Link to="/fulfillment/erve-packing-lists">View Erve Packing Lists</Link>}
      />
    );
  if (query.isLoading) return <LoadingState label="Loading Erve Packing List" />;
  if (query.isError) {
    if (isAxiosError(query.error) && query.error.response?.status === 404)
      return <EmptyState title="Erve Packing List not found" />;
    return (
      <ErrorState
        title="Unable to load Erve Packing List"
        description={getApiErrorMessage(query.error, 'Please try again.')}
      />
    );
  }
  if (!packingList) return <EmptyState title="Erve Packing List not found" />;
  return (
    <div className="space-y-4">
      <PageHeader
        wrapActions
        title="Record Dispatch"
        subtitle={packingList.ervePackingListNumber}
        secondaryActions={
          <Button
            variant="secondary"
            onClick={() => navigate(`/fulfillment/erve-packing-lists/${id}`)}
          >
            Back to Packing List
          </Button>
        }
      />
      <Panel title="Erve Packing List">
        <DescriptionList columns={3}>
          <DescriptionList.Item label="Distributor" value={packingList.distributor?.name} />
          <DescriptionList.Item
            label="Destination"
            value={
              packingList.destination.label ||
              [packingList.destination.city, packingList.destination.state]
                .filter(Boolean)
                .join(', ')
            }
          />
          <DescriptionList.Item
            label="Total Quantity"
            value={packingList.totalQuantity.toLocaleString()}
          />
        </DescriptionList>
      </Panel>
      {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
      {!eligible ? (
        <EmptyState
          title={
            packingList.status === 'DISPATCHED'
              ? 'This packing list has already been dispatched'
              : 'Finalize this packing list before recording dispatch'
          }
        />
      ) : (
        <Panel title="Physical Dispatch">
          <form
            onKeyDown={createEnterToNextHandler()}
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !eligible ||
                !dispatchDate ||
                mutation.isPending ||
                submitting.current ||
                query.isFetching
              )
                return;
              submitting.current = true;
              setError('');
              mutation.mutate();
            }}
          >
            <fieldset
              disabled={mutation.isPending}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <DatePicker
                label="Dispatch Date"
                value={dispatchDate}
                onValueChange={(value) => setDispatchDate(value ?? '')}
                width="sm"
              />
              <TextField
                label="Transporter (optional)"
                value={transporter}
                onChange={(e) => setTransporter(e.target.value)}
                maxLength={200}
              />
              <TextField
                label="Vehicle Number (optional)"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value)}
                maxLength={100}
              />
              <TextField
                label="LR Number (optional)"
                value={lrNumber}
                onChange={(e) => setLrNumber(e.target.value)}
                maxLength={100}
              />
              <TextField
                label="Remarks (optional)"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                maxLength={1000}
              />
            </fieldset>
            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                disabled={!dispatchDate || query.isFetching || mutation.isPending}
                loading={mutation.isPending}
              >
                Record Dispatch
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
