import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { PackingAuditQueueItem, PaginatedResult } from './types.js';

function auditStateBadge(state: PackingAuditQueueItem['auditState']) {
  if (state === 'INSPECTED') return <StatusBadge label="Inspected" tone="approved" />;
  if (state === 'NEEDS_REINSPECTION') return <StatusBadge label="Needs Reinspection" tone="rejected" />;
  return <StatusBadge label="Not Inspected" tone="draft" />;
}

// QA's lightweight, cross-factory Packing Audit discovery surface (Phase 4).
// No StockAllocation/QaReleaseLine/Job Order fields — carton identity,
// destination, and Style/Size quantities only.
export function PackingAuditQueuePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['packing-audit-queue'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<PackingAuditQueueItem>>>('/packing-audit/queue', {
        params: { limit: 100 },
      });
      return res.data.data.items;
    },
  });

  const generatePackingAuditListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generatePackingAuditListPdfBlob } = await import('./pdf/packing-audit/generatePackingAuditListPdf.js');
    return generatePackingAuditListPdfBlob({ generatedAt: new Date().toISOString(), generatedBy: user?.name });
  }, [user?.name]);

  const pdfAction = usePdfAction({
    generate: generatePackingAuditListPdf,
    filename: () => buildPdfFilename(['ERVE-Packing-Audit-Queue', getLocalDateString()]),
  });

  if (query.isLoading) return <LoadingState label="Loading Packing Audit queue" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packing Audit"
        subtitle="Confirm cartons as inspected before Factory Dispatch"
        secondaryActions={
          <PdfActionButtons
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
        }
      />

      <Panel title="Cartons" padding="none">
        <DataTable
          rowKey="id"
          data={query.data ?? []}
          emptyState={<EmptyState title="Nothing to inspect" description="No open cartons are currently awaiting Packing Audit." />}
          error={
            query.isError ? (
              <ErrorState title="Unable to load Packing Audit queue" description={query.error.message} />
            ) : undefined
          }
          onRowClick={(row) => navigate(`/fulfillment/packing-audit/cartons/${row.id}`)}
          columns={[
            { key: 'saleOrder', header: 'Sale Order', render: (r) => r.saleOrder.saleOrderNumber },
            { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
            { key: 'carton', header: 'Carton #', accessor: 'cartonNumber' },
            { key: 'qty', header: 'Total Qty', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
            { key: 'state', header: 'Audit State', render: (r) => auditStateBadge(r.auditState) },
          ]}
        />
      </Panel>
    </div>
  );
}
