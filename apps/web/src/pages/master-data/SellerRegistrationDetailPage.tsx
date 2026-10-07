import { useState } from 'react';
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
import { canManageSellerRegistrations } from '../../auth/permissions.js';
import type { SellerRegistration } from './types.js';

function toErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

export function SellerRegistrationDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = canManageSellerRegistrations(user);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusError, setStatusError] = useState('');

  const registrationQuery = useQuery({
    queryKey: ['seller-registration', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<SellerRegistration>>(
        `/seller-registrations/${id}`,
      );
      return response.data.data;
    },
  });
  const registration = registrationQuery.data;

  const statusMutation = useMutation({
    mutationFn: async (status: 'ACTIVE' | 'INACTIVE') => {
      setStatusError('');
      await apiClient.patch(`/seller-registrations/${id}/status`, { status });
    },
    onSuccess: async () => {
      setStatusDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['seller-registration', id] }),
        queryClient.invalidateQueries({ queryKey: ['seller-registrations'] }),
      ]);
    },
    onError: (caught) => {
      setStatusDialogOpen(false);
      setStatusError(toErrorMessage(caught, 'Unable to update seller registration status'));
    },
  });

  if (registrationQuery.isLoading) {
    return <LoadingState label="Loading seller registration" />;
  }
  if (registrationQuery.isError) {
    return (
      <ErrorState
        title="Unable to load seller registration"
        description={registrationQuery.error.message}
      />
    );
  }
  if (!registration) {
    return (
      <EmptyState
        title="Seller registration not found"
        description="The selected seller registration could not be loaded."
      />
    );
  }

  const isActive = registration.status === 'ACTIVE';

  const identityFields = [
    ['Legal Name', registration.legalName],
    ['Trade Name', registration.tradeName ?? '—'],
    ['Branch Code', registration.branchCode],
  ] as const;

  const gstFields = [
    ['GSTIN', registration.gstin],
    ['State', registration.state],
    ['State Code', registration.stateCode],
    ['PIN', registration.postalCode],
    ['E-Invoice Applicable', registration.einvoiceApplicable ? 'Yes' : 'No'],
  ] as const;

  const addressFields = [
    ['Address Line 1', registration.addressLine1],
    ['Address Line 2', registration.addressLine2 ?? '—'],
    ['City', registration.city],
    ['District', registration.district ?? '—'],
    ['Country', registration.country],
  ] as const;

  const bankFields = [
    ['Bank Name', registration.bankName],
    ['Beneficiary / Account Name', registration.bankAccountName],
    ['Account Number', registration.bankAccountNumber],
    ['IFSC', registration.bankIfsc],
    ['Branch Name', registration.bankBranchName],
    ['Bank Address', registration.bankAddress ?? '—'],
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title={registration.branchCode}
        subtitle={registration.legalName}
        status={<StatusBadge label={registration.status} tone={isActive ? 'success' : 'muted'} />}
        primaryAction={
          canManage ? (
            <Button asChild>
              <Link to={`/master-data/seller-registrations/${registration.id}/edit`}>Edit</Link>
            </Button>
          ) : null
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

      <Panel title="Seller Identity">
        <DescriptionList columns={3}>
          {identityFields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <Panel title="GST Registration">
        <DescriptionList columns={3}>
          {gstFields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <Panel title="Registered Address">
        <DescriptionList columns={3}>
          {addressFields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <Panel title="Bank Details">
        <DescriptionList columns={3}>
          {bankFields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>

      <ConfirmDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title={isActive ? 'Deactivate seller registration' : 'Activate seller registration'}
        description={
          isActive
            ? `${registration.legalName} will no longer be selectable as a seller identity. Historical records remain unchanged.`
            : `${registration.legalName} will become selectable again.`
        }
        confirmLabel={isActive ? 'Deactivate' : 'Activate'}
        destructive={isActive}
        loading={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate(isActive ? 'INACTIVE' : 'ACTIVE')}
      />
    </div>
  );
}
