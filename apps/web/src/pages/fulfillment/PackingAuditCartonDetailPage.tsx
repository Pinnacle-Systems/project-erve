import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { canConfirmPackingAudits } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { PackingAuditQueueItem } from './types.js';

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
          <DescriptionList.Item label="Total Quantity" value={carton.totalQuantity.toLocaleString()} />
        </DescriptionList>
        <DataTable
          rowKey="saleOrderLineId"
          data={carton.lines}
          columns={[
            { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
            { key: 'size', header: 'Size', accessor: 'sizeLabel' },
            { key: 'quantity', header: 'Quantity', align: 'right', render: (r) => r.quantity.toLocaleString() },
          ]}
        />
      </Panel>

      {canConfirm && !carton.retired && !isCurrent && (
        <Panel title="Confirm Inspected">
          <div className="space-y-3">
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
