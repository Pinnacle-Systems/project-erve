import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, ErveDispatchTransportView } from '@erve/types';
import { Button, LookupField, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { apiClient } from '../../../lib/api-client.js';
import { getApiErrorMessage } from '../../../lib/api-errors.js';
import { useServerLookup } from '../../../lib/use-server-lookup.js';

type Option = { id: string; name: string };
export function TransporterAssignmentPanel({
  id,
  version,
  disabled,
  onConflict,
}: {
  id: string;
  version: number;
  disabled: boolean;
  onConflict: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Option | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const query = useQuery({
    queryKey: ['dispatch-transporter-assignment', id, version],
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<ErveDispatchTransportView>>(
          `/erve-dispatches/${id}/transport`,
        )
      ).data.data,
  });
  const lookup = useServerLookup<Option>({
    queryKey: ['dispatch-transporter-options'],
    searchText: search,
    minLength: 0,
    enabled: open,
    fetchOptions: async (search, signal) =>
      (
        await apiClient.get<ApiSuccessResponse<Option[]>>('/erve-dispatches/transporter-options', {
          params: { search, limit: 20 },
          signal,
        })
      ).data.data,
  });
  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.patch(`/erve-dispatches/${id}/transporter-assignment`, {
        expectedVersion: version,
        transporterUserId: selected?.id ?? null,
      }),
    onSuccess: async () => {
      setDirty(false);
      setError('');
      setSuccess(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['erve-dispatch', id] }),
        queryClient.invalidateQueries({ queryKey: ['dispatch-transporter-assignment', id] }),
      ]);
    },
    onError: (caught) => {
      setSuccess(false);
      setError(getApiErrorMessage(caught, 'Unable to update Transporter assignment.'));
      if (isAxiosError(caught) && caught.response?.status === 409) onConflict();
    },
  });
  const current = query.data?.transporterAssignment ?? null;
  return (
    <Panel title="Authenticated Transporter Assignment">
      <p className="mb-3 text-sm">Current assignment: {current?.name ?? 'Unassigned'}</p>
      {query.isError && (
        <ValidationMessage tone="error">Unable to load current assignment.</ValidationMessage>
      )}
      {error && <ValidationMessage tone="error">{error}</ValidationMessage>}
      {success && <p role="status">Transporter assignment saved.</p>}
      <LookupField<Option>
        label="Assign Transporter"
        placeholder="Search Transporter name…"
        selectedOption={dirty ? selected : current}
        onSelect={(option) => {
          setSelected(option);
          setDirty(true);
          setSuccess(false);
        }}
        searchText={search}
        onSearchTextChange={setSearch}
        options={lookup.options}
        getOptionKey={(option) => option.id}
        getOptionLabel={(option) => option.name}
        onOpenChange={setOpen}
        disabled={disabled || mutation.isPending || query.isPending || query.isError}
        loading={lookup.loading}
        searchError={lookup.error?.message}
      />
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          variant="secondary"
          disabled={disabled || mutation.isPending || query.isPending || query.isError}
          onClick={() => {
            setSelected(null);
            setDirty(true);
            setSuccess(false);
          }}
        >
          Clear Assignment
        </Button>
        <Button
          disabled={!dirty || disabled || mutation.isPending || query.isPending || query.isError}
          loading={mutation.isPending}
          onClick={() => {
            if (!mutation.isPending && !disabled) mutation.mutate();
          }}
        >
          Save Assignment
        </Button>
      </div>
    </Panel>
  );
}
