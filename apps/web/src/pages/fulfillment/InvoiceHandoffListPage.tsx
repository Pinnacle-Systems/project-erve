import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
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

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" subtitle="Physically dispatched quantities (both Outright and Sale-or-Return) awaiting a Tally invoice reference" />

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
