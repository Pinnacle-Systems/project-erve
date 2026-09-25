import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DistributorOption } from '@erve/types';
import { ConfirmDialog } from '@erve/app-components';
import { Badge, Button, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { apiClient } from '../../../lib/api-client.js';
import { DistributorLookupField } from '../../master-data/DistributorLookupField.js';
import type { AdminUserSummary } from '../../master-data/types.js';
import { toErrorMessage } from './toErrorMessage.js';

// A Distributor user is capped at exactly one distributor mapping by the
// backend today (see DistributorDetailPage's UserMappingPanel eligibility
// filter), so the common case is the single assign/remove affordance below,
// driven by `mapped`. If the API ever returns more than one mapping, every
// entry is still shown (not just the first) instead of silently dropping the
// rest.
export function DistributorMappingPanel({ user }: { user: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const [selectedDistributor, setSelectedDistributor] = useState<DistributorOption | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');

  const mapped = user.distributors[0];

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    ]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!selectedDistributor) throw new Error('Select a distributor to assign');
      await apiClient.post(`/users/${user.id}/distributors`, {
        distributorId: selectedDistributor.id,
      });
    },
    onSuccess: async () => {
      setSelectedDistributor(null);
      await invalidate();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to assign distributor')),
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!mapped) return;
      await apiClient.delete(`/users/${user.id}/distributors/${mapped.id}`);
    },
    onSuccess: async () => {
      setConfirmRemove(false);
      await invalidate();
    },
    onError: (caught) => {
      setConfirmRemove(false);
      setError(toErrorMessage(caught, 'Unable to remove distributor mapping'));
    },
  });

  return (
    <Panel title="Distributor Mapping">
      <div className="space-y-4">
        {user.distributors.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {user.distributors.map((distributor) => (
              <Badge key={distributor.id} variant="muted">
                {distributor.name} ({distributor.code})
              </Badge>
            ))}
          </div>
        ) : mapped ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{mapped.name}</p>
              <p className="text-xs text-muted-foreground">{mapped.code}</p>
            </div>
            <Button
              type="button"
              variant="destructive"
              density="compact"
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              assignMutation.mutate();
            }}
          >
            {/* Bounded search over ACTIVE distributors (GET /distributors/options),
                not the whole Distributor master. */}
            <DistributorLookupField
              label="Assign distributor"
              placeholder="Search an active distributor…"
              value={selectedDistributor}
              onChange={setSelectedDistributor}
            />
            <Button type="submit" loading={assignMutation.isPending}>
              Assign
            </Button>
          </form>
        )}

        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove distributor mapping"
        description={
          mapped ? `${user.name} will lose access to ${mapped.name}'s Order Sheets.` : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate()}
      />
    </Panel>
  );
}
