import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, UserOption } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageDistributorMaster } from '../../auth/permissions.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { UserLookupField, userLookupQueryKey } from '../users/UserLookupField.js';
import type { Distributor, DistributorUser } from './types.js';

function toErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function UserMappingPanel({ distributor }: { distributor: Distributor }) {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DistributorUser | null>(null);
  const [error, setError] = useState('');

  const mappedUsersQuery = useQuery({
    queryKey: ['distributor-users', distributor.id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<DistributorUser[]>>(
        `/distributors/${distributor.id}/users`,
      );
      return response.data.data;
    },
  });

  // Eligible candidates (ACTIVE DISTRIBUTOR-role users with no distributor
  // mapping — the backend allows exactly one) come from a bounded server
  // search, never the whole /users collection.
  const userOptionsPath = `/distributors/${distributor.id}/user-options`;

  const invalidateMappings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['distributor-users', distributor.id] }),
      // Assigning or removing changes who is eligible; the cached initial
      // candidates must not keep offering (or hiding) them.
      queryClient.invalidateQueries({ queryKey: userLookupQueryKey(userOptionsPath) }),
    ]);
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!selectedUser) {
        throw new Error('Select a user to assign');
      }
      await apiClient.post(`/users/${selectedUser.id}/distributors`, {
        distributorId: distributor.id,
      });
    },
    onSuccess: async () => {
      setSelectedUser(null);
      await invalidateMappings();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to assign user')),
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      setError('');
      await apiClient.delete(`/users/${userId}/distributors/${distributor.id}`);
    },
    onSuccess: async () => {
      setRemoveTarget(null);
      await invalidateMappings();
    },
    onError: (caught) => {
      setRemoveTarget(null);
      setError(toErrorMessage(caught, 'Unable to remove mapping'));
    },
  });

  return (
    <Panel title="Mapped Users">
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            assignMutation.mutate();
          }}
        >
          <UserLookupField
            label="Assign user"
            searchPath={userOptionsPath}
            value={selectedUser}
            onChange={setSelectedUser}
            disabled={distributor.status !== 'ACTIVE'}
            emptyMessage="No unassigned active distributor users available"
            noMatchMessage="No unassigned active distributor users match your search"
          />
          <Button
            type="submit"
            loading={assignMutation.isPending}
            disabled={distributor.status !== 'ACTIVE'}
          >
            Assign
          </Button>
        </form>
        {distributor.status !== 'ACTIVE' ? (
          <p className="text-sm text-muted-foreground">
            Users cannot be assigned to an inactive distributor.
          </p>
        ) : null}
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

        <DataTable
          columns={[
            { key: 'name', header: 'Name', accessor: 'name' },
            { key: 'email', header: 'Email', accessor: 'email' },
            { key: 'roles', header: 'Roles', render: (user) => user.roles.join(', ') },
            {
              key: 'status',
              header: 'Status',
              render: (user) => (
                <StatusBadge
                  label={user.status}
                  tone={user.status === 'ACTIVE' ? 'success' : 'muted'}
                />
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (user) => (
                <Button
                  type="button"
                  variant="destructive"
                  density="compact"
                  onClick={() => setRemoveTarget(user)}
                >
                  Remove
                </Button>
              ),
            },
          ]}
          data={mappedUsersQuery.data ?? []}
          loading={mappedUsersQuery.isLoading}
          loadingState={<LoadingState variant="rows" label="Loading mapped users" />}
          emptyState={
            <EmptyState
              title="No users mapped"
              description="Assign a distributor user to give them access to this distributor's orders."
            />
          }
          error={
            mappedUsersQuery.isError ? (
              <ErrorState
                title="Unable to load mapped users"
                description={mappedUsersQuery.error.message}
              />
            ) : undefined
          }
        />
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove user mapping"
        description={
          removeTarget
            ? `${removeTarget.name} will lose access to ${distributor.name}'s Order Sheets.`
            : undefined
        }
        confirmLabel="Remove"
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (removeTarget) removeMutation.mutate(removeTarget.id);
        }}
      />
    </Panel>
  );
}

export function DistributorDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = canManageDistributorMaster(user);
  const canManageUserMappings = user?.roles.includes('ADMIN') ?? false;
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusError, setStatusError] = useState('');

  const distributorQuery = useQuery({
    queryKey: ['distributor', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<Distributor>>(`/distributors/${id}`);
      return response.data.data;
    },
  });
  const distributor = distributorQuery.data;

  const generateDistributorDetailPdf = useCallback(async () => {
    if (!distributor) throw new Error('Distributor not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateDistributorDetailPdfBlob } = await import('./pdf/generateDistributorDetailPdf.js');
    return generateDistributorDetailPdfBlob(distributor, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [distributor, user?.name]);

  const distributorDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Distributor', distributor?.code]),
    [distributor?.code],
  );

  const pdfAction = usePdfAction({
    generate: generateDistributorDetailPdf,
    filename: distributorDetailPdfFilename,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: 'ACTIVE' | 'INACTIVE') => {
      setStatusError('');
      await apiClient.patch(`/distributors/${id}/status`, { status });
    },
    onSuccess: async () => {
      setStatusDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['distributor', id] }),
        queryClient.invalidateQueries({ queryKey: ['distributors'] }),
      ]);
    },
    onError: (caught) => {
      setStatusDialogOpen(false);
      setStatusError(toErrorMessage(caught, 'Unable to update distributor status'));
    },
  });

  if (distributorQuery.isLoading) {
    return <LoadingState label="Loading distributor" />;
  }
  if (distributorQuery.isError) {
    return (
      <ErrorState title="Unable to load distributor" description={distributorQuery.error.message} />
    );
  }
  if (!distributor) {
    return (
      <EmptyState
        title="Distributor not found"
        description="The selected distributor could not be loaded."
      />
    );
  }

  const isActive = distributor.status === 'ACTIVE';
  const fields = [
    ['Code', distributor.code],
    ['Name', distributor.name],
    ['GSTIN', distributor.gstin],
    ['Purchase Mode', distributor.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale or Return'],
    ['Contact Name', distributor.contactName ?? '—'],
    ['Contact Email', distributor.contactEmail ?? '—'],
    ['Contact Phone', distributor.contactPhone ?? '—'],
    ['Address Line 1', distributor.addressLine1 ?? '—'],
    ['Address Line 2', distributor.addressLine2 ?? '—'],
    ['City', distributor.city ?? '—'],
    ['State', distributor.state ?? '—'],
    ['Country', distributor.country ?? '—'],
    ['Postal Code', distributor.postalCode ?? '—'],
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title={distributor.code}
        subtitle={distributor.name}
        status={<StatusBadge label={distributor.status} tone={isActive ? 'success' : 'muted'} />}
        primaryAction={
          <div className="flex items-start gap-3">
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            {canManage ? (
              <Button asChild>
                <Link to={`/master-data/distributors/${distributor.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </div>
        }
        secondaryActions={
          canManage ? (
            <Button
              type="button"
              variant={isActive ? 'destructive' : 'secondary'}
              onClick={() => setStatusDialogOpen(true)}
              loading={statusMutation.isPending}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </Button>
          ) : undefined
        }
      />

      {statusError ? <ValidationMessage tone="error">{statusError}</ValidationMessage> : null}

      <Panel title="Distributor Details">
        <DescriptionList columns={3}>
          {fields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
        <p className="mt-4 text-xs text-muted-foreground">
          Purchase Mode is locked after creation. If this distributor needs both Outright and Sale
          or Return, create separate distributor records.
        </p>
      </Panel>

      {canManageUserMappings ? <UserMappingPanel distributor={distributor} /> : null}

      <ConfirmDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title={isActive ? 'Deactivate distributor' : 'Activate distributor'}
        description={
          isActive
            ? `${distributor.name} will no longer be selectable on new Order Sheets. Existing Order Sheets remain unchanged.`
            : `${distributor.name} will become selectable on new Order Sheets again.`
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        destructive={isActive}
        loading={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate(isActive ? 'INACTIVE' : 'ACTIVE')}
      />
    </div>
  );
}
