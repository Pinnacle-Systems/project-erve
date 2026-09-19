import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManagePriceLists } from '../../auth/permissions.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { PriceListDistributor, PriceListStatus, PriceListSummary } from './types.js';
import {
  PRICE_LIST_STATUS_LABELS,
  formatEffectiveDate,
  priceListStatusTone,
} from './price-list-ui.js';

export function PriceListListPage() {
  const { user } = useAuth();
  const canManage = canManagePriceLists(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<PriceListStatus | ''>('');
  const [distributorId, setDistributorId] = useState('');

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      distributorId: distributorId || undefined,
    }),
    [debouncedSearch, status, distributorId],
  );

  const priceListsQuery = useQuery({
    queryKey: ['price-lists', params],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceListSummary[]>>('/price-lists', { params });
      return res.data.data;
    },
  });

  // Price-List-specific option lookup: ACCOUNTANT can manage Price Lists but
  // is denied on the broad /distributors master endpoint, so this filter must
  // not depend on it. No status filter is passed — unlike the create form,
  // this filter browses historical Price Lists too, and a distributor that
  // has since gone INACTIVE must remain selectable so its price lists stay
  // filterable, not just visible in the unfiltered table.
  const distributorOptionsQuery = useQuery({
    queryKey: ['price-list-distributor-options'],
    queryFn: async () => {
      const res =
        await apiClient.get<ApiSuccessResponse<PriceListDistributor[]>>('/price-lists/distributor-options');
      return res.data.data;
    },
  });

  const distributorName = (distributorOptionsQuery.data ?? []).find(
    (distributor) => distributor.id === distributorId,
  )?.name;

  const generatePriceListListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generatePriceListListPdfBlob } = await import('./pdf/generatePriceListListPdf.js');
    return generatePriceListListPdfBlob(
      priceListsQuery.data ?? [],
      { search: debouncedSearch, status, distributorName },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [priceListsQuery.data, debouncedSearch, status, distributorName, user?.name]);

  const priceListListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Price-Lists', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({
    generate: generatePriceListListPdf,
    filename: priceListListPdfFilename,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Price Lists"
        subtitle="Distributor-specific selling prices with effective periods"
        primaryAction={
          canManage ? (
            <Button asChild>
              <Link to="/price-lists/new">Create Price List</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search code or name"
            statusValue={status || 'ALL'}
            onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as PriceListStatus))}
            statusOptions={[
              { label: 'All statuses', value: 'ALL' },
              ...(Object.keys(PRICE_LIST_STATUS_LABELS) as PriceListStatus[]).map((value) => ({
                label: PRICE_LIST_STATUS_LABELS[value],
                value,
              })),
            ]}
            hasActiveFilters={Boolean(search || status || distributorId)}
            onClearFilters={() => {
              setSearch('');
              setStatus('');
              setDistributorId('');
            }}
            actions={
              <SelectField
                aria-label="Distributor"
                value={distributorId || 'ALL'}
                onValueChange={(value) => setDistributorId(value === 'ALL' ? '' : value)}
                density="compact"
                width="md"
              >
                <SelectItem value="ALL">All distributors</SelectItem>
                {distributorOptionsQuery.isLoading && (
                  <SelectItem value="LOADING" disabled>
                    Loading distributors…
                  </SelectItem>
                )}
                {distributorOptionsQuery.isError && (
                  <SelectItem value="ERROR" disabled>
                    Unable to load distributors
                  </SelectItem>
                )}
                {(distributorOptionsQuery.data ?? []).map((distributor) => (
                  <SelectItem key={distributor.id} value={distributor.id}>
                    {distributor.name}
                    {distributor.status === 'INACTIVE' ? ' (inactive)' : ''}
                  </SelectItem>
                ))}
              </SelectField>
            }
          />
          {distributorOptionsQuery.isError ? (
            <ValidationMessage tone="error" className="mt-2">
              Unable to load distributors for filtering. Try again.
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
            key: 'code',
            header: 'Code',
            render: (priceList) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/price-lists/${priceList.id}`}>
                {priceList.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          { key: 'distributor', header: 'Distributor', render: (priceList) => priceList.distributor.name },
          {
            key: 'effectiveFrom',
            header: 'Effective From',
            render: (priceList) => formatEffectiveDate(priceList.effectiveFrom),
          },
          {
            key: 'effectiveTo',
            header: 'Effective To',
            render: (priceList) => (priceList.effectiveTo ? formatEffectiveDate(priceList.effectiveTo) : 'Open-ended'),
          },
          { key: 'lineCount', header: 'Lines', align: 'right', render: (priceList) => priceList.lineCount },
          {
            key: 'status',
            header: 'Status',
            render: (priceList) => (
              <StatusBadge
                label={PRICE_LIST_STATUS_LABELS[priceList.status]}
                tone={priceListStatusTone(priceList.status)}
              />
            ),
          },
        ]}
        data={priceListsQuery.data ?? []}
        loading={priceListsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading price lists" />}
        emptyState={
          <EmptyState
            title="No price lists found"
            description="Distributor price lists will appear here once created."
          />
        }
        error={
          priceListsQuery.isError ? (
            <ErrorState title="Unable to load price lists" description={priceListsQuery.error.message} />
          ) : undefined
        }
      />
    </div>
  );
}
