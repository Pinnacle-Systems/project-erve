import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { AdminUserSummary } from '../master-data/types.js';
import { RolesPanel } from './user-detail/RolesPanel.js';
import { DistributorMappingPanel } from './user-detail/DistributorMappingPanel.js';
import { FactoryMappingPanel } from './user-detail/FactoryMappingPanel.js';
import { ResetPasswordDialog } from './user-detail/ResetPasswordDialog.js';

function toErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

export function UserDetailPage() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);

  const userQuery = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<AdminUserSummary>>(`/users/${id}`);
      return response.data.data;
    },
  });
  const user = userQuery.data;

  const generateUserDetailPdf = useCallback(async () => {
    if (!user) throw new Error('User not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateUserDetailPdfBlob } = await import('./pdf/generateUserDetailPdf.js');
    return generateUserDetailPdfBlob(user, {
      generatedAt: new Date().toISOString(),
      generatedBy: currentUser?.name,
    });
  }, [user, currentUser?.name]);

  const userDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-User', user?.name]),
    [user?.name],
  );

  const pdfAction = usePdfAction({ generate: generateUserDetailPdf, filename: userDetailPdfFilename });

  const statusMutation = useMutation({
    mutationFn: async (status: 'ACTIVE' | 'INACTIVE') => {
      setStatusError('');
      await apiClient.patch(`/users/${id}/status`, { status });
    },
    onSuccess: async () => {
      setStatusDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-user', id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
    },
    onError: (caught) => {
      setStatusDialogOpen(false);
      setStatusError(toErrorMessage(caught, 'Unable to update user status'));
    },
  });

  const isSelf = useMemo(() => user?.id === currentUser?.id, [user, currentUser]);

  if (userQuery.isLoading) {
    return <LoadingState label="Loading user" />;
  }
  if (userQuery.isError) {
    return <ErrorState title="Unable to load user" description={userQuery.error.message} />;
  }
  if (!user) {
    return (
      <EmptyState title="User not found" description="The selected user could not be loaded." />
    );
  }

  const isActive = user.status === 'ACTIVE';
  const fields = [
    ['Name', user.name],
    ['Email', user.email],
    ['Mobile', user.mobile ?? '—'],
    [
      'Status',
      <StatusBadge key="status" label={user.status} tone={isActive ? 'success' : 'muted'} />,
    ],
    ['Created', user.createdAt ? new Date(user.createdAt).toLocaleString() : '—'],
    ['Updated', user.updatedAt ? new Date(user.updatedAt).toLocaleString() : '—'],
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title={user.name}
        subtitle={user.email}
        status={<StatusBadge label={user.status} tone={isActive ? 'success' : 'muted'} />}
        primaryAction={
          <div className="flex items-start gap-3">
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            <Button asChild>
              <Link to={`/master-data/users/${user.id}/edit`}>Edit</Link>
            </Button>
          </div>
        }
        secondaryActions={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setResetPasswordOpen(true)}>
              Reset Password
            </Button>
            <Button
              type="button"
              variant={isActive ? 'destructive' : 'secondary'}
              onClick={() => setStatusDialogOpen(true)}
              loading={statusMutation.isPending}
              disabled={isActive && isSelf}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        }
      />

      {isActive && isSelf ? (
        <ValidationMessage tone="warning">
          You cannot deactivate your own account. Ask another administrator to do this if needed.
        </ValidationMessage>
      ) : null}
      {statusError ? <ValidationMessage tone="error">{statusError}</ValidationMessage> : null}

      <Panel title="User Details">
        <DescriptionList columns={3}>
          {fields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <RolesPanel user={user} currentUserId={currentUser?.id} />

      {user.roles.includes('DISTRIBUTOR') ? <DistributorMappingPanel user={user} /> : null}
      {user.roles.includes('FACTORY_USER') ? <FactoryMappingPanel user={user} /> : null}

      <ConfirmDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title={isActive ? 'Deactivate user' : 'Activate user'}
        description={
          isActive
            ? `${user.name} will be signed out of all active sessions and will not be able to sign in again until reactivated.`
            : `${user.name} will be able to sign in again, subject to their existing roles and mappings.`
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        destructive={isActive}
        loading={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate(isActive ? 'INACTIVE' : 'ACTIVE')}
      />

      <ResetPasswordDialog
        userId={user.id}
        open={resetPasswordOpen}
        onOpenChange={setResetPasswordOpen}
      />
    </div>
  );
}
