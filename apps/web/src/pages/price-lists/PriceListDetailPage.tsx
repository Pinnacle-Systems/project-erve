import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManagePriceLists } from '../../auth/permissions.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { PriceList } from './types.js';
import {
  PRICE_LIST_STATUS_LABELS,
  apiErrorMessage,
  formatEffectiveDate,
  formatPercentage,
  priceListStatusTone,
} from './price-list-ui.js';

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PriceListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = canManagePriceLists(user);

  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [retireDialogOpen, setRetireDialogOpen] = useState(false);
  const [error, setError] = useState('');

  const priceListQuery = useQuery({
    queryKey: ['price-list', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceList>>(`/price-lists/${id}`);
      return res.data.data;
    },
  });

  const priceList = priceListQuery.data;
  const isDraft = priceList?.status === 'DRAFT';
  const canEdit = canManage && isDraft;

  const generatePriceListDetailPdf = useCallback(async () => {
    if (!priceList) throw new Error('Price list not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generatePriceListDetailPdfBlob } = await import('./pdf/generatePriceListDetailPdf.js');
    return generatePriceListDetailPdfBlob(priceList, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [priceList, user?.name]);

  const priceListDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Price-List', priceList?.code]),
    [priceList?.code],
  );

  const pdfAction = usePdfAction({
    generate: generatePriceListDetailPdf,
    filename: priceListDetailPdfFilename,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['price-list', id] });
    await queryClient.invalidateQueries({ queryKey: ['price-lists'] });
  }

  const activateMutation = useMutation({
    mutationFn: async () => {
      setError('');
      const res = await apiClient.post<ApiSuccessResponse<PriceList>>(`/price-lists/${id}/actions/activate`);
      return res.data.data;
    },
    onSuccess: async () => {
      setActivateDialogOpen(false);
      await refresh();
    },
    onError: (caught) => {
      setActivateDialogOpen(false);
      setError(apiErrorMessage(caught, 'Unable to activate price list'));
    },
  });

  const retireMutation = useMutation({
    mutationFn: async () => {
      setError('');
      const res = await apiClient.post<ApiSuccessResponse<PriceList>>(`/price-lists/${id}/actions/retire`);
      return res.data.data;
    },
    onSuccess: async () => {
      setRetireDialogOpen(false);
      await refresh();
    },
    onError: (caught) => {
      setRetireDialogOpen(false);
      setError(apiErrorMessage(caught, 'Unable to retire price list'));
    },
  });

  if (priceListQuery.isLoading) {
    return <LoadingState label="Loading price list" />;
  }
  if (!priceList) {
    return (
      <EmptyState
        title="Price list not found"
        description="The selected price list could not be loaded."
        tone="error"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={priceList.code}
        subtitle={`${priceList.name} — ${priceList.distributor.name}`}
        status={
          <StatusBadge
            label={PRICE_LIST_STATUS_LABELS[priceList.status]}
            tone={priceListStatusTone(priceList.status)}
          />
        }
        secondaryActions={
          <>
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            {canEdit && (
              <Button asChild variant="secondary">
                <Link to={`/price-lists/${id}/edit`}>Edit Details</Link>
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/price-lists')}>
              Back
            </Button>
          </>
        }
        primaryAction={
          canManage ? (
            <div className="flex gap-2">
              {isDraft && (
                <Button onClick={() => setActivateDialogOpen(true)} loading={activateMutation.isPending}>
                  Activate
                </Button>
              )}
              {priceList.status === 'ACTIVE' && (
                <Button
                  variant="destructive"
                  onClick={() => setRetireDialogOpen(true)}
                  loading={retireMutation.isPending}
                >
                  Retire
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

      <Panel title="Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Distributor" value={priceList.distributor.name} />
          <DescriptionList.Item label="MRP Percentage (%)" value={formatPercentage(priceList.percentageOfMrp)} />
          <DescriptionList.Item label="Effective From" value={formatEffectiveDate(priceList.effectiveFrom)} />
          <DescriptionList.Item
            label="Effective To"
            value={priceList.effectiveTo ? formatEffectiveDate(priceList.effectiveTo) : 'Open-ended'}
          />
          <DescriptionList.Item label="Created" value={formatTimestamp(priceList.createdAt)} />
          <DescriptionList.Item label="Last Updated" value={formatTimestamp(priceList.updatedAt)} />
        </DescriptionList>
        {priceList.status === 'EXPIRED' && (
          <p className="mt-3 text-sm text-muted-foreground">
            This price list is retired and read-only. Its percentage is preserved for historical reference.
          </p>
        )}
      </Panel>

      <ConfirmDialog
        open={activateDialogOpen}
        onOpenChange={setActivateDialogOpen}
        title="Activate price list?"
        description={`This makes ${priceList.code} the applicable price list for ${priceList.distributor.name} from ${formatEffectiveDate(priceList.effectiveFrom)}. An overlapping open-ended price list will be ended the day before, and the list becomes read-only.`}
        confirmLabel="Activate"
        loading={activateMutation.isPending}
        onConfirm={() => activateMutation.mutate()}
      />

      <ConfirmDialog
        open={retireDialogOpen}
        onOpenChange={setRetireDialogOpen}
        title="Retire price list?"
        description={`New transactions will no longer price against ${priceList.code}. The historical percentage remains readable and unchanged.`}
        confirmLabel="Retire"
        destructive
        loading={retireMutation.isPending}
        onConfirm={() => retireMutation.mutate()}
      />
    </div>
  );
}
