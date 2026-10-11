import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse, TaxInvoiceView, TaxInvoiceSource } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import {
  Button,
  TextField,
  SelectField,
  SelectItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  ValidationMessage,
} from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { canMutateTaxInvoices } from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useCursorList, LoadMoreFooter, loadMoreProps } from '../../lib/cursor-list.js';
import { formatInvoiceDate, formatInvoiceMoney, invoiceIssuedAmount } from './tax-invoice-ui.js';

export function TaxInvoiceListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sourceOpen, setSourceOpen] = useState(false);
  const { query, items } = useCursorList<TaxInvoiceView>({
    queryKey: ['tax-invoices'],
    path: '/tax-invoices',
    params: {
      limit: 25,
      search: search.trim() || undefined,
      status: status === 'ALL' ? undefined : status,
    },
  });
  const canCreate = canMutateTaxInvoices(user);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tax Invoices"
        subtitle="Accountant review and issued financial documents"
        primaryAction={
          canCreate ? <Button onClick={() => setSourceOpen(true)}>Create draft</Button> : undefined
        }
      />
      <div className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem]">
        <TextField
          label="Search invoices"
          placeholder="Invoice, buyer, destination or EIPL"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectField label="Status" value={status} onValueChange={setStatus}>
          <SelectItem value="ALL">All invoices</SelectItem>
          <SelectItem value="DRAFT">Draft</SelectItem>
          <SelectItem value="FINALIZED">Finalized</SelectItem>
        </SelectField>
      </div>
      {query.isLoading ? (
        <LoadingState label="Loading Tax Invoices" />
      ) : query.isError && items.length === 0 ? (
        <ErrorState
          title="Unable to load Tax Invoices"
          description={getApiErrorMessage(query.error, 'Try again.')}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <Panel padding="none">
          <DataTable
            rowKey="id"
            data={items}
            onRowClick={(row) => navigate(`/fulfillment/tax-invoices/${row.id}`)}
            emptyState={
              <EmptyState
                title="No Tax Invoices"
                description={
                  search || status !== 'ALL'
                    ? 'No invoices match these filters.'
                    : 'Create a draft from a finalized EIPL to begin Accountant review.'
                }
              />
            }
            columns={[
              {
                key: 'identity',
                header: 'Invoice',
                render: (row) => (
                  <div className="font-medium">
                    {row.invoiceNumber ?? `Draft · ${row.ervePackingList.ervePackingListNumber}`}
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <StatusBadge
                    label={row.status === 'DRAFT' ? 'Draft' : 'Finalized'}
                    tone={row.status === 'DRAFT' ? 'warning' : 'success'}
                  />
                ),
              },
              {
                key: 'date',
                header: 'Invoice date',
                render: (row) => formatInvoiceDate(row.finalizedAt),
              },
              { key: 'buyer', header: 'Distributor / Bill-To', render: (row) => row.billTo.name },
              {
                key: 'destination',
                header: 'Destination',
                render: (row) => row.shipTo.label ?? 'Not snapshotted',
              },
              {
                key: 'amount',
                header: 'Issued amount',
                align: 'right',
                render: (row) =>
                  row.status === 'DRAFT' ? (
                    'Not finalized'
                  ) : (
                    <div>
                      {formatInvoiceMoney(invoiceIssuedAmount(row).amount)}
                      <div className="text-xs text-muted-foreground">
                        {invoiceIssuedAmount(row).label}
                      </div>
                    </div>
                  ),
              },
              {
                key: 'source',
                header: 'Source documents',
                render: (row) => (
                  <div className="text-sm">
                    {row.ervePackingList.ervePackingListNumber}
                    <div className="text-xs text-muted-foreground">
                      {row.erveDispatch?.erveDispatchNumber ?? 'Dispatch not recorded'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'action',
                header: 'Action',
                render: (row) => (
                  <Button
                    variant="secondary"
                    density="compact"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate(`/fulfillment/tax-invoices/${row.id}`);
                    }}
                  >
                    {canCreate && row.status === 'DRAFT' ? 'Review' : 'View'}
                  </Button>
                ),
              },
            ]}
          />
        </Panel>
      )}
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['Tax Invoice', 'Tax Invoices'])} />
      {sourceOpen && canCreate && <TaxInvoiceSourceDialog onClose={() => setSourceOpen(false)} />}
    </div>
  );
}

function TaxInvoiceSourceDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const { query, items } = useCursorList<TaxInvoiceSource>({
    queryKey: ['tax-invoice-sources'],
    path: '/tax-invoices/sources',
    params: { limit: 25, search: search.trim() || undefined },
  });
  const create = useMutation({
    mutationFn: async (ervePackingListId: string) =>
      (
        await apiClient.post<ApiSuccessResponse<TaxInvoiceView>>('/tax-invoices', {
          ervePackingListId,
        })
      ).data.data,
    onSuccess: async (invoice) => {
      await client.invalidateQueries({ queryKey: ['tax-invoices'] });
      onClose();
      navigate(`/fulfillment/tax-invoices/${invoice.id}`);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Create Tax Invoice draft</DialogTitle>
          <DialogDescription>
            Select a finalized EIPL. Draft creation validates the frozen carton-derived commercial
            snapshot and does not allocate an EI number.
          </DialogDescription>
        </DialogHeader>
        <TextField
          label="Search EIPL references"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {create.isError && (
          <ValidationMessage tone="error">
            {getApiErrorMessage(
              create.error,
              'Unable to create the draft. Your selection is retained for retry.',
            )}
          </ValidationMessage>
        )}
        {query.isLoading ? (
          <LoadingState label="Loading finalized EIPLs" />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load invoice sources"
            description={getApiErrorMessage(query.error, 'Try again.')}
            action={
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <DataTable
            rowKey="id"
            data={items}
            emptyState={
              <EmptyState
                title="No eligible EIPLs awaiting an invoice"
                description="Existing drafts are available in the invoice queue. Packing lists need finalized commercial snapshots."
              />
            }
            columns={[
              { key: 'eipl', header: 'EIPL', accessor: 'ervePackingListNumber' },
              {
                key: 'buyer',
                header: 'Distributor',
                render: (row) => row.distributor?.name ?? 'Unavailable',
              },
              {
                key: 'destination',
                header: 'Destination',
                render: (row) => row.destinationLabel ?? 'Not snapshotted',
              },
              {
                key: 'snapshot',
                header: 'Commercial basis',
                render: (row) =>
                  row.commercialSnapshotAvailable
                    ? 'Validates on creation'
                    : 'Historical snapshot missing',
              },
              {
                key: 'action',
                header: 'Action',
                render: (row) => (
                  <Button
                    density="compact"
                    disabled={!row.commercialSnapshotAvailable || create.isPending}
                    loading={create.isPending && create.variables === row.id}
                    onClick={() => create.mutate(row.id)}
                  >
                    Create draft
                  </Button>
                ),
              },
            ]}
          />
        )}
        <LoadMoreFooter {...loadMoreProps(query, items.length, ['EIPL', 'EIPLs'])} />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
