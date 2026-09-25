import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { toCompactFinancialYearCode } from '../../lib/financial-years.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canFilterDispatchOrders, canMutateDispatchOrders } from '../../auth/permissions.js';
import { DistributorLookupField } from '../master-data/DistributorLookupField.js';
import type { Distributor, Factory, SaleOrder } from './types.js';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function SaleOrderListPage() {
  const { user } = useAuth();
  const canCreate = canMutateDispatchOrders(user);
  // FACTORY_USER can view this list but is hard-scoped server-side to its
  // own Factory and has no operational need for the Distributor/Factory
  // filter pickers — a merchandiser-oriented control that also used to leak
  // to it because this was wired to canViewDispatchOrders (true for every
  // role that can even see the page) instead of a narrower check.
  const showFilters = canFilterDispatchOrders(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [distributor, setDistributor] = useState<Distributor | null>(null);
  const distributorId = distributor?.id ?? '';
  const [factoryId, setFactoryId] = useState('');

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      distributorId: distributorId || undefined,
      factoryId: factoryId || undefined,
    }),
    [debouncedSearch, distributorId, factoryId],
  );

  // Cursor-paginated (25 per page): Load more appends; a filter change
  // restarts at page 1. The PDF fetches every page itself.
  const { query: ordersQuery, items: orders } = useCursorList<SaleOrder>({
    queryKey: ['sale-orders'],
    path: '/sale-orders',
    params,
  });

  // UXAUTH-015: Dispatch-Order-specific option lookups — ACCOUNTANT is
  // denied on both broad masters (/distributors and /factories), and
  // SENIOR_MANAGEMENT on /factories, so these filters must not depend on
  // them. No status filter is passed: Dispatch Order list is historical, and
  // a Distributor/Factory that has since gone INACTIVE must remain
  // selectable so its past Dispatch Orders stay filterable, not just visible
  // in the unfiltered table. The Distributor filter is a bounded lookup
  // search of /sale-orders/distributor-options (P1L8); Factory stays a list.
  const factoriesQuery = useQuery({
    queryKey: ['dispatch-order-factory-options'],
    enabled: showFilters,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/sale-orders/factory-options');
      return res.data.data;
    },
  });

  const distributorName = distributor?.name;
  const factoryName = (factoriesQuery.data ?? []).find((f) => f.id === factoryId)?.name;

  const generateDispatchOrderListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateDispatchOrderListPdfBlob } = await import('../fulfillment/pdf/dispatch-order/generateDispatchOrderListPdf.js');
    return generateDispatchOrderListPdfBlob(
      params,
      { search: debouncedSearch, distributorName, factoryName },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [params, debouncedSearch, distributorName, factoryName, user?.name]);

  const pdfAction = usePdfAction({
    generate: generateDispatchOrderListPdf,
    filename: () => buildPdfFilename(['ERVE-Dispatch-Orders', getLocalDateString()]),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dispatch Orders"
        subtitle="Pooled Factory stock allocated to Distributor destinations"
        primaryAction={
          canCreate ? (
            <Button asChild>
              <Link to="/sale-orders/new">Create Dispatch Order</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search Dispatch Order number"
            hasActiveFilters={Boolean(search || distributorId || factoryId)}
            onClearFilters={() => {
              setSearch('');
              setDistributor(null);
              setFactoryId('');
            }}
            actions={
              showFilters ? (
                <div className="flex gap-2">
                  <DistributorLookupField<Distributor>
                    aria-label="Distributor"
                    id="dispatch-order-distributor-filter"
                    placeholder="All distributors"
                    value={distributor}
                    onChange={setDistributor}
                    searchPath="/sale-orders/distributor-options"
                    emptyMessage="No distributors match — try another name or code"
                    density="compact"
                    width="md"
                  />
                  <SelectField
                    aria-label="Factory"
                    value={factoryId || 'ALL'}
                    onValueChange={(value) => setFactoryId(value === 'ALL' ? '' : value)}
                    density="compact"
                    width="md"
                  >
                    <SelectItem value="ALL">All factories</SelectItem>
                    {factoriesQuery.isLoading && (
                      <SelectItem value="LOADING" disabled>
                        Loading factories…
                      </SelectItem>
                    )}
                    {factoriesQuery.isError && (
                      <SelectItem value="ERROR" disabled>
                        Unable to load factories
                      </SelectItem>
                    )}
                    {(factoriesQuery.data ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                        {f.status === 'INACTIVE' ? ' (inactive)' : ''}
                      </SelectItem>
                    ))}
                  </SelectField>
                </div>
              ) : undefined
            }
          />
          {showFilters && factoriesQuery.isError ? (
            <ValidationMessage tone="error" className="mt-2">
              Unable to load factories for filtering. Try again.
            </ValidationMessage>
          ) : null}
        </div>
        <PdfActionButtons
          isGenerating={pdfAction.isGenerating}
          error={pdfAction.error}
          onDownload={pdfAction.handleDownload}
          onPrint={pdfAction.handlePrint}
        />
      </div>

      <DataTable
        columns={[
          {
            key: 'saleOrderNumber',
            header: 'Dispatch Order No.',
            render: (so) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/sale-orders/${so.id}`}>
                {so.saleOrderNumber}
              </Link>
            ),
          },
          {
            key: 'distributor',
            header: 'Distributors',
            render: (so) => {
              const names = so.distributors.map((d) => d.name);
              if (names.length <= 2) return names.join(', ');
              return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
            },
          },
          { key: 'factory', header: 'Factory', render: (so) => so.factory.name },
          { key: 'soDate', header: 'Date', render: (so) => formatDate(so.soDate) },
          {
            key: 'financialYear',
            header: 'FY',
            render: (so) => toCompactFinancialYearCode(so.financialYear.code),
          },
          {
            key: 'destinationCount',
            header: 'Destinations',
            align: 'right',
            render: (so) => so.destinationCount.toLocaleString(),
          },
          {
            key: 'totalQuantity',
            header: 'Total Qty',
            align: 'right',
            render: (so) => so.totalQuantity.toLocaleString(),
          },
          {
            key: 'state',
            header: 'State',
            render: (so) =>
              so.isLocked ? (
                <StatusBadge label="Factory Dispatched" tone="approved" />
              ) : (
                <StatusBadge label="Ready for Factory" tone="pending" />
              ),
          },
        ]}
        data={orders}
        loading={ordersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading dispatch orders" />}
        emptyState={
          <EmptyState
            title="No dispatch orders found"
            description={
              canCreate
                ? 'Create a Dispatch Order to allocate pooled Factory stock to a Distributor.'
                : 'Dispatch orders will appear here when they are available.'
            }
            action={
              canCreate ? (
                <Button asChild>
                  <Link to="/sale-orders/new">Create Dispatch Order</Link>
                </Button>
              ) : undefined
            }
          />
        }
        error={
          ordersQuery.isError ? (
            <ErrorState title="Unable to load dispatch orders" description={ordersQuery.error.message} />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(ordersQuery, orders.length, ['dispatch order', 'dispatch orders'])} />
    </div>
  );
}
