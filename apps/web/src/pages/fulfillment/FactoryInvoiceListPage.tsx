import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
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

  return (
    <div className="space-y-6">
      <PageHeader title="Factory Invoices" subtitle="ERVE-generated payable documents snapshotted from finalized Factory Packing Lists" />

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
