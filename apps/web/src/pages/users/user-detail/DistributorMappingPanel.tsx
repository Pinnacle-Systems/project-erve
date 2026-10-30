import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DistributorOption } from '@erve/types';
import { ConfirmDialog, createEnterToNextHandler } from '@erve/app-components';
import { Badge, Button, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { apiClient } from '../../../lib/api-client.js';
import { DistributorLookupField } from '../../master-data/DistributorLookupField.js';
import type { AdminUserSummary } from '../../master-data/types.js';
import { toErrorMessage } from './toErrorMessage.js';

type RemovalTarget = Readonly<{
  userId: string;
  distributorId: string;
  userName: string;
  distributorName: string;
}>;

// A Distributor user is capped at exactly one distributor mapping by the
// backend today (see DistributorDetailPage's UserMappingPanel eligibility
// filter), so the common case is the single assign/remove affordance below,
// driven by `mapped`. If the API ever returns more than one mapping, every
// entry is still shown (not just the first) instead of silently dropping the
// rest.
// Keyed by user.id so this never carries state (a selection, an open remove
// confirmation) across an in-place navigation to a different, already-cached
// user — the :id route does not otherwise unmount this panel when the
// destination user's data is cached. Mirrors FactoryMappingPanel.
export function DistributorMappingPanel({ user }: { user: AdminUserSummary }) {
  return <DistributorMappingPanelInner key={user.id} user={user} />;
}

function DistributorMappingPanelInner({ user }: { user: AdminUserSummary }) {
  const queryClient = useQueryClient();
  const [selectedDistributor, setSelectedDistributor] = useState<DistributorOption | null>(null);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);
  // Also revoke retained callbacks on cancel, drift, and unmount. A later
  // confirmation for the same identity pair is a separate deliberate action.
  const activeRemoval = useRef<RemovalTarget | null>(null);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const mapped = user.distributors[0];
  const targetMatches = removalTarget !== null && user.distributors.length === 1 &&
    removalTarget.userId === user.id && removalTarget.distributorId === mapped?.id;

  useLayoutEffect(() => {
    if (removalTarget && !targetMatches && !submitting.current) {
      activeRemoval.current = null;
      setRemovalTarget(null);
    }
  }, [removalTarget, targetMatches]);

  useLayoutEffect(() => () => { activeRemoval.current = null; }, []);

  const closeRemoval = () => {
    activeRemoval.current = null;
    setRemovalTarget(null);
  };

  const invalidate = (userId = user.id) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-user', userId] }),
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
    mutationFn: async (target: RemovalTarget) => {
      setError('');
      await apiClient.delete(`/users/${target.userId}/distributors/${target.distributorId}`);
    },
    onSuccess: async (_data, target) => {
      closeRemoval();
      await invalidate(target.userId);
    },
    onError: (caught) => {
      closeRemoval();
      setError(toErrorMessage(caught, 'Unable to remove distributor mapping'));
    },
    onSettled: () => { submitting.current = false; },
  });

  const remove = () => {
    if (submitting.current || !removalTarget || activeRemoval.current !== removalTarget) return;
    // Validate in the handler too: cleanup alone cannot protect confirmation
    // during the commit that observes a changed, missing, or ambiguous mapping.
    if (!targetMatches) { closeRemoval(); return; }
    submitting.current = true;
    removeMutation.mutate(removalTarget);
  };

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
              onClick={() => {
                if (submitting.current || user.distributors.length !== 1) return;
                const target: RemovalTarget = {
                  userId: user.id,
                  distributorId: mapped.id,
                  userName: user.name,
                  distributorName: mapped.name,
                };
                activeRemoval.current = target;
                setRemovalTarget(target);
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onKeyDown={createEnterToNextHandler()}
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
        open={removalTarget !== null}
        onOpenChange={(open) => { if (!open && !submitting.current) closeRemoval(); }}
        title="Remove distributor mapping"
        description={
          removalTarget
            ? `${removalTarget.userName} will lose access to ${removalTarget.distributorName}'s Order Sheets.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={remove}
      />
    </Panel>
  );
}
