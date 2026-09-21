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
import type { InvoiceHandoffStatus, InvoiceHandoffView, PaginatedResult } from './types.js';

const STATUS_TABS: Array<{ value: InvoiceHandoffStatus | 'ALL'; label: string }> = [
  { value: 'PENDING_TALLY', label: 'Pending Tally Reference' },
  { value: 'INVOICED', label: 'Invoiced' },
  { value: 'ALL', label: 'All' },
];

function modeLabel(item: InvoiceHandoffView) {
  return item.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale-or-Return';
}

export function InvoiceHandoffListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<InvoiceHandoffStatus | 'ALL'>('PENDING_TALLY');

  const query = useQuery({
    queryKey: ['invoice-handoffs', status],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResult<InvoiceHandoffView>>>('/invoice-handoffs', {
        params: { limit: 100, status: status === 'ALL' ? undefined : status },
      });
      return res.data.data.items;
    },
  });

  const generateInvoiceHandoffListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateInvoiceHandoffListPdfBlob } = await import('./pdf/invoice-handoff/generateInvoiceHandoffListPdf.js');
    return generateInvoiceHandoffListPdfBlob(
      { status: status === 'ALL' ? undefined : status },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [status, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateInvoiceHandoffListPdf,
    filename: () => buildPdfFilename(['ERVE-Invoice-Handoffs', getLocalDateString()]),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        subtitle="Physically dispatched quantities (both Outright and Sale-or-Return) awaiting a Tally invoice reference"
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
        <LoadingState label="Loading invoice handoffs" />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={query.data ?? []}
            onRowClick={(row) => navigate(`/fulfillment/invoices/${row.id}`)}
            emptyState={<EmptyState title="Nothing here" description="No invoice handoffs match this filter." />}
            error={
              query.isError ? (
                <ErrorState title="Unable to load invoice handoffs" description={query.error.message} />
              ) : undefined
            }
            columns={[
              { key: 'mode', header: 'Mode', render: (r) => modeLabel(r) },
              { key: 'reference', header: 'Dispatch #', render: (r) => r.erveDispatch.erveDispatchNumber },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
              { key: 'style', header: 'Style / Size', render: (r) => `${r.style.styleNumber} / ${r.size.sizeLabel}` },
              { key: 'qty', header: 'Qty', align: 'right', render: (r) => r.quantity.toLocaleString() },
              {
                key: 'status',
                header: 'Status',
                render: (r) =>
                  r.status === 'PENDING_TALLY' ? (
                    <StatusBadge label="Pending Tally" tone="pending" />
                  ) : (
                    <StatusBadge label="Invoiced" tone="posted" />
                  ),
              },
              { key: 'tallyInvoiceNumber', header: 'Tally Invoice #', render: (r) => r.tallyInvoiceNumber ?? '—' },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
