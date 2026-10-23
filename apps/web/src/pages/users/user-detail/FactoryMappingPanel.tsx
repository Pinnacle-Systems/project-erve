import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, createEnterToNextHandler } from '@erve/app-components';
import { Badge, Button, SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { apiClient } from '../../../lib/api-client.js';
import type { AdminUserSummary, FactoryOption } from '../../master-data/types.js';
import { toErrorMessage } from './toErrorMessage.js';

// A Factory User must always have exactly one factory — there is no valid
// "remove" affordance here: swapping the selection reassigns atomically
// (old mapping out, new one in, in a single backend call), and dropping to
// zero mappings is only possible by removing the FACTORY_USER role itself
// (see RolesPanel), which takes the mapping with it.
//
// `currentSelection` is computed directly at render time (not copied into
// state via useEffect on load) — that's what keeps this Select's mount-time
// value change safe from the Radix hydration race documented across U2/U3A.
// Preserve that shape; do not introduce a useEffect-based hydration copy here.
// Keyed by user.id so this never carries state (a selection, an open
// reassignment confirmation) across an in-place navigation to a different,
// already-cached user — the :id route does not otherwise unmount this
// panel when the destination user's data is cached.
export function FactoryMappingPanel({ user }: { user: AdminUserSummary }) {
  return <FactoryMappingPanelInner key={user.id} user={user} />;
}

function FactoryMappingPanelInner({ user }: { user: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const [selectedFactoryId, setSelectedFactoryId] = useState('');
  const [error, setError] = useState('');
  const [destination, setDestination] = useState<FactoryOption | null>(null);
  const submitting = useRef(false);

  const mapped = user.factories[0];

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'options'],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<FactoryOption[]>>('/factories/options');
      return response.data.data;
    },
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    ]);

  const assignMutation = useMutation({
    mutationFn: async (factoryId: string) => {
      setError('');
      await apiClient.post(`/users/${user.id}/factories`, { factoryId });
    },
    onSuccess: async () => {
      setSelectedFactoryId('');
      setDestination(null);
      await invalidate();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to assign factory')),
    onSettled: () => { submitting.current = false; },
  });

  const assign = (factoryId: string) => {
    if (submitting.current) return;
    submitting.current = true;
    assignMutation.mutate(factoryId);
  };

  const currentSelection = selectedFactoryId || mapped?.id || 'NONE';
  const unchanged = Boolean(mapped) && currentSelection === mapped?.id;

  return (
    <Panel title="Factory Mapping">
      <div className="space-y-4">
        {user.factories.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {user.factories.map((factory) => (
              <Badge key={factory.id} variant="muted">
                {factory.name} ({factory.code})
              </Badge>
            ))}
          </div>
        ) : null}

        <form
          className="flex flex-wrap items-end gap-3"
          onKeyDown={createEnterToNextHandler()}
          onSubmit={(event) => {
            event.preventDefault();
            if (unchanged || submitting.current || destination) return;
            setError('');
            const next = factoriesQuery.data?.find((factory) => factory.id === selectedFactoryId);
            if (!next) { setError('Select a factory to assign'); return; }
            if (mapped && mapped.id !== next.id) setDestination(next);
            else assign(next.id);
          }}
        >
          <SelectField
            label={mapped ? 'Reassign factory' : 'Assign factory'}
            value={currentSelection}
            onValueChange={(value) => setSelectedFactoryId(value === 'NONE' ? '' : value)}
            disabled={assignMutation.isPending}
          >
            {mapped ? null : <SelectItem value="NONE">Select an active factory</SelectItem>}
            {(factoriesQuery.data ?? []).map((factory) => (
              <SelectItem key={factory.id} value={factory.id}>
                {factory.name} ({factory.code})
              </SelectItem>
            ))}
          </SelectField>
          <Button type="submit" loading={assignMutation.isPending} disabled={unchanged}>
            {mapped ? 'Reassign' : 'Assign'}
          </Button>
        </form>
        {mapped ? (
          <p className="text-xs text-muted-foreground">
            To revoke factory access entirely, remove the FACTORY_USER role above instead.
          </p>
        ) : null}

        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      </div>
      <ConfirmDialog
        open={destination !== null}
        onOpenChange={(open) => { if (!open && !submitting.current) { setDestination(null); setError(''); } }}
        title="Reassign factory user?"
        description={destination ? `Confirming will move this user from ${mapped?.name} to ${destination.name}, replacing the existing factory assignment.` : undefined}
        error={error}
        loading={assignMutation.isPending}
        onConfirm={() => { if (destination) assign(destination.id); }}
      />
    </Panel>
  );
}
