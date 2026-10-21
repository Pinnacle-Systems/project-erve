import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { createEnterToNextHandler, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { canConfirmPackingAudits } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import { distinctSizeColumns, groupLinesByStyle } from './style-size-grouping.js';
import type { PackingAuditQueueItem } from './types.js';

// ISS-023 Phase 2: this carton's own contents as one Style row per Style,
// with Sizes as columns, instead of one flat row per Style+Size combination
// — mirrors the already-standardized carton contents on the Factory Packing
// List / Carton Label (ISS-007/ISS-010). Carries each Style's primaryImage
// through (one per styleId, from its first-seen line) so the DataTable's
// thumbnail isn't lost in the conversion.
function cartonStyleSizeRows(carton: PackingAuditQueueItem) {
  const primaryImageByStyle = new Map(carton.lines.map((line) => [line.styleId, line.primaryImage]));
  return groupLinesByStyle(carton.lines).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: primaryImageByStyle.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

// Lightweight carton inspection view — the inspector sees carton identity,
// destination, and Style/Size contents, then confirms the current state was
// visually inspected. No heavyweight inspection form (Phase 4 §2/§25-30).
export function PackingAuditCartonDetailPage() {
  const { cartonId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canConfirm = canConfirmPackingAudits(user);

  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');

  const query = useQuery({
    queryKey: ['packing-audit-carton', cartonId],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PackingAuditQueueItem & { factoryDispatchId: string }>>(
        `/packing-audit/cartons/${cartonId}`,
      );
      return res.data.data;
    },
  });
  const carton = query.data;

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/factory-dispatches/${carton!.factoryDispatchId}/cartons/${cartonId}/audit`, {
        remarks: remarks || null,
      });
    },
    onSuccess: () => {
      setRemarks('');
      void queryClient.invalidateQueries({ queryKey: ['packing-audit-carton', cartonId] });
      void queryClient.invalidateQueries({ queryKey: ['packing-audit-queue'] });
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to confirm this carton as inspected.')),
  });

  const generatePackingAuditCartonDetailPdf = useCallback(async () => {
    if (!carton) throw new Error('Carton not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle. Only the
    // server-persisted carton record is passed in — never the local "Confirm Inspected" remarks
    // draft state, which must never leak into the printed document.
    const { generatePackingAuditCartonDetailPdfBlob } = await import('./pdf/packing-audit/generatePackingAuditCartonDetailPdf.js');
    return generatePackingAuditCartonDetailPdfBlob(carton, { generatedAt: new Date().toISOString(), generatedBy: user?.name });
  }, [carton, user?.name]);

  const pdfAction = usePdfAction({
    generate: generatePackingAuditCartonDetailPdf,
    filename: () => buildPdfFilename(['ERVE-Packing-Audit-Carton', carton?.saleOrder.saleOrderNumber, carton?.cartonNumber]),
  });

  if (query.isLoading) return <LoadingState label="Loading carton" />;
  if (query.isError)
    return <ErrorState title="Unable to load carton" description={query.error.message} />;
  if (!carton) return <EmptyState title="Carton not found" tone="error" />;

  const isCurrent = carton.auditState === 'INSPECTED';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Carton ${carton.cartonNumber}`}
        subtitle={`${carton.saleOrder.saleOrderNumber} · ${carton.factory.name}`}
        status={
          carton.auditState === 'INSPECTED' ? (
            <StatusBadge label="Inspected" tone="approved" />
          ) : carton.auditState === 'NEEDS_REINSPECTION' ? (
            <StatusBadge label="Needs Reinspection" tone="rejected" />
          ) : (
            <StatusBadge label="Not Inspected" tone="draft" />
          )
        }
        secondaryActions={
          <div className="flex items-center gap-2">
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            <Button variant="secondary" onClick={() => navigate('/fulfillment/packing-audit')}>
              Back to Queue
            </Button>
          </div>
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {carton.retired && <ValidationMessage tone="warning">This carton has been retired and can no longer be inspected.</ValidationMessage>}
      {carton.destinationMismatch && (
        <ValidationMessage tone="warning">
          This carton contains a line for another destination — it must be reconciled by the Factory before it can be
          inspected.
        </ValidationMessage>
      )}

      <Panel title="Carton Contents">
        <DescriptionList columns={2}>
          <DescriptionList.Item
            label="Distributor"
            value={carton.destination.distributor.name}
          />
          <DescriptionList.Item
            label="Destination"
            value={[
              carton.destination.label,
              [carton.destination.city, carton.destination.state].filter(Boolean).join(', '),
            ].filter(Boolean).join(' · ')}
          />
          <DescriptionList.Item label="Total Quantity" value={carton.totalQuantity.toLocaleString()} />
        </DescriptionList>
        <StyleSizeGrid
          columns={distinctSizeColumns(carton.lines)}
          rows={cartonStyleSizeRows(carton)}
          variant="readOnly"
        />
      </Panel>

      {canConfirm && !carton.retired && !carton.destinationMismatch && !isCurrent && (
        <Panel title="Confirm Inspected">
          <div className="space-y-3" onKeyDown={createEnterToNextHandler()}>
            <TextField label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <Button onClick={() => confirmMutation.mutate()} loading={confirmMutation.isPending}>
              Confirm Inspected
            </Button>
          </div>
        </Panel>
      )}

      {carton.auditHistory.length > 0 && (
        <Panel title="Audit History">
          <ul className="space-y-1 text-sm">
            {carton.auditHistory.map((entry, idx) => (
              <li key={idx}>
                v{entry.cartonVersion} — Inspected by {entry.inspectedByName} at {new Date(entry.inspectedAt).toLocaleString()}
                {entry.remarks ? ` — "${entry.remarks}"` : ''}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
