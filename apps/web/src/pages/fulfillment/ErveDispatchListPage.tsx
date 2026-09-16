import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { ErveDispatchView, PaginatedResult } from './types.js';

export function ErveDispatchListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['erve-dispatches'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<ErveDispatchView>>>('/erve-dispatches', {
        params: { limit: 50 },
      });
      return res.data.data.items;
    },
  });

  const generateErveDispatchListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateErveDispatchListPdfBlob } = await import('./pdf/erve-dispatch/generateErveDispatchListPdf.js');
    return generateErveDispatchListPdfBlob({ generatedAt: new Date().toISOString(), generatedBy: user?.name });
  }, [user?.name]);

  const pdfAction = usePdfAction({
    generate: generateErveDispatchListPdf,
    filename: () => buildPdfFilename(['ERVE-Dispatches', getLocalDateString()]),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch History"
        subtitle="Physical goods movement from Erve India to Distributors"
        secondaryActions={
          <PdfActionButtons
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
        }
      />

      {query.isLoading ? (
        <LoadingState label="Loading dispatch history" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={query.data ?? []}
            onRowClick={(row) => navigate(`/fulfillment/erve-dispatches/${row.id}`)}
            emptyState={<EmptyState title="No dispatches yet" />}
            columns={[
              { key: 'number', header: 'Dispatch #', accessor: 'erveDispatchNumber' },
              { key: 'saleOrder', header: 'Sale Order', render: (r) => r.saleOrder?.saleOrderNumber ?? 'Multiple' },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
              { key: 'date', header: 'Dispatch Date', render: (r) => new Date(r.dispatchDate).toLocaleDateString() },
              { key: 'transporter', header: 'Transporter', render: (r) => r.transporter ?? '—' },
              { key: 'lr', header: 'LR Number', render: (r) => r.lrNumber ?? '—' },
              { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
