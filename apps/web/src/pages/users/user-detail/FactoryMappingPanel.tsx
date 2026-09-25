import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
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
export function FactoryMappingPanel({ user }: { user: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const [selectedFactoryId, setSelectedFactoryId] = useState('');
  const [error, setError] = useState('');

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
    mutationFn: async () => {
      setError('');
      if (!selectedFactoryId) throw new Error('Select a factory to assign');
      await apiClient.post(`/users/${user.id}/factories`, { factoryId: selectedFactoryId });
    },
    onSuccess: async () => {
      setSelectedFactoryId('');
      await invalidate();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to assign factory')),
  });

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
          onSubmit={(event) => {
            event.preventDefault();
            assignMutation.mutate();
          }}
        >
          <SelectField
            label={mapped ? 'Reassign factory' : 'Assign factory'}
            value={currentSelection}
            onValueChange={(value) => setSelectedFactoryId(value === 'NONE' ? '' : value)}
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
    </Panel>
  );
}
