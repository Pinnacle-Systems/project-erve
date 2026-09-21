import { useCallback, useState } from 'react';
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
import { FACTORY_INVOICE_STATUS_LABELS, factoryInvoiceStatusTone, formatMoney } from './factory-invoice-ui.js';
import type { FactoryInvoiceStatus, FactoryInvoiceView, PaginatedResult } from './types.js';

const STATUS_TABS: Array<{ value: FactoryInvoiceStatus | 'ALL'; label: string }> = [
  { value: 'GENERATED', label: 'Awaiting Factory Confirmation' },
  { value: 'FACTORY_CONFIRMED', label: 'Factory Confirmed' },
  { value: 'FINALIZED', label: 'Finalized' },
  { value: 'ALL', label: 'All' },
];

export function FactoryInvoiceListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<FactoryInvoiceStatus | 'ALL'>('GENERATED');

  const query = useQuery({
    queryKey: ['factory-invoices', status],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<FactoryInvoiceView>>>('/factory-invoices', {
        params: { limit: 100, status: status === 'ALL' ? undefined : status },
      });
      return res.data.data.items;
    },
  });

  const generateFactoryInvoiceListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateFactoryInvoiceListPdfBlob } = await import('./pdf/factory-invoice/generateFactoryInvoiceListPdf.js');
    return generateFactoryInvoiceListPdfBlob(
      { status: status === 'ALL' ? undefined : status },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [status, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateFactoryInvoiceListPdf,
    filename: () => buildPdfFilename(['ERVE-Factory-Invoices', getLocalDateString()]),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Factory Invoices"
        subtitle="ERVE-generated payable documents snapshotted from finalized Factory Packing Lists"
        secondaryActions={
          <PdfActionButtons
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
        }
      />

      <div className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              status === tab.value ? 'bg-[var(--erp-accent)] text-white' : 'bg-[var(--erp-surface-muted)] text-[var(--erp-fg-muted)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <LoadingState label="Loading Factory Invoices" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={query.data ?? []}
            onRowClick={(row) => navigate(`/fulfillment/factory-invoices/${row.id}`)}
            emptyState={<EmptyState title="Nothing here" description="No Factory Invoices match this filter." />}
            error={
              query.isError ? (
                <ErrorState title="Unable to load Factory Invoices" description={query.error.message} />
              ) : undefined
            }
            columns={[
              { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
              { key: 'dispatch', header: 'Dispatch Order #', render: (r) => r.factoryDispatch.factoryDispatchNumber },
              { key: 'lines', header: 'Lines', align: 'right', render: (r) => r.lines.length },
              { key: 'subtotal', header: 'Subtotal', align: 'right', render: (r) => formatMoney(r.subtotal) },
              { key: 'total', header: 'Total', align: 'right', render: (r) => formatMoney(r.total) },
              {
                key: 'status',
                header: 'Status',
                render: (r) => <StatusBadge label={FACTORY_INVOICE_STATUS_LABELS[r.status]} tone={factoryInvoiceStatusTone(r.status)} />,
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
