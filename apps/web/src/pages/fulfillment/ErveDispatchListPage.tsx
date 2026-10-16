import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { ErveDispatchView } from './types.js';

type DispatchStatusFilter = ErveDispatchView['status'] | 'ALL';

const STATUS_TABS: Array<{ value: DispatchStatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
];

export function ErveDispatchListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<DispatchStatusFilter>('ALL');

  // Cursor-paginated: Load more appends every further page (the page size
  // is only the batch size, never a cap on what the list can reach).
  const { query, items } = useCursorList<ErveDispatchView>({
    queryKey: ['erve-dispatches'],
    path: '/erve-dispatches',
    // Filter is applied by the API before cursor paging; changing status resets to page one.
    params: { limit: 50, status: status === 'ALL' ? undefined : status },
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

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter Dispatch History by status">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value}
            type="button"
            density="compact"
            variant={status === tab.value ? 'default' : 'ghost'}
            aria-pressed={status === tab.value}
            onClick={() => setStatus(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <LoadingState label="Loading dispatch history" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={items}
            onRowClick={(row) => navigate(`/fulfillment/erve-dispatches/${row.id}`)}
            emptyState={<EmptyState title={status === 'ALL' ? 'No dispatches yet' : 'No dispatches match this status.'} />}
            error={
              query.isError ? (
                <ErrorState title="Unable to load dispatch history" description={query.error.message} />
              ) : undefined
            }
            columns={[
              { key: 'number', header: 'Dispatch #', accessor: 'erveDispatchNumber' },
              { key: 'saleOrder', header: 'Dispatch Order', render: (r) => r.saleOrder?.saleOrderNumber ?? 'Multiple' },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
              { key: 'date', header: 'Dispatch Date', render: (r) => new Date(r.dispatchDate).toLocaleDateString() },
              { key: 'transporter', header: 'Transporter', render: (r) => r.transporter ?? '—' },
              { key: 'lr', header: 'LR Number', render: (r) => r.lrNumber ?? '—' },
              { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
              {
                key: 'status',
                header: 'Status',
                render: (r) => r.status === 'DELIVERED'
                  ? <StatusBadge label="Delivered" tone="posted" />
                  : <StatusBadge label="Dispatched" tone="approved" />,
              },
            ]}
          />
        </Panel>
      )}
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['dispatch', 'dispatches'])} />
    </div>
  );
}
