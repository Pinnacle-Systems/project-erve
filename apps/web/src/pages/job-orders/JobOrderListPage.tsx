import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import {
  FilterBar,
  formatPreparedQuantity,
  getQaStatusPresentation,
  PageHeader,
  StatusBadge,
} from '@erve/app-components';
import { Button, SelectField, SelectItem, ValidationMessage } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import {
  FinancialYearSelect,
  toCompactFinancialYearCode,
  useFinancialYearsQuery,
} from '../../lib/financial-years.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { JobOrder, JobOrderFactoryOption, JobOrderStatus } from './types.js';
import {
  JOB_ORDER_STATUS_LABELS,
  formatDateTime,
  getJobOrderConfirmationPresentation,
} from './job-order-ui.js';
import { useAuth } from '../../auth/AuthContext.js';
import { useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { canCreateJobOrders, canFilterJobOrdersByFactory } from '../../auth/permissions.js';

export function JobOrderListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canCreate = canCreateJobOrders(user);
  const mayFilterByFactory = canFilterJobOrdersByFactory(user);
  const showQaWork = user?.roles.includes('QA_USER') ?? false;

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<JobOrderStatus | ''>('');
  const [financialYearId, setFinancialYearId] = useState('');

  const rawFactoryId = searchParams.get('factoryId');
  const effectiveFactoryId = mayFilterByFactory ? (rawFactoryId ?? undefined) : undefined;

  useEffect(() => {
    if (!mayFilterByFactory && rawFactoryId !== null) {
      const next = new URLSearchParams(searchParams);
      next.delete('factoryId');
      setSearchParams(next, { replace: true });
    }
  }, [mayFilterByFactory, rawFactoryId, searchParams, setSearchParams]);

  const handleFactoryChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && value !== 'ALL') {
      next.set('factoryId', value);
    } else {
      next.delete('factoryId');
    }
    setSearchParams(next, { replace: true });
  };

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: status || undefined,
      factoryId: effectiveFactoryId,
      // Filters by each JO's own Financial Year (derived from its
      // createdAt), never the parent PO's. Optional, defaulting to "All".
      financialYearId: financialYearId || undefined,
    }),
    [debouncedSearch, status, effectiveFactoryId, financialYearId],
  );

  // The API pages this list by cursor (25 per page); every page is kept so
  // "Load more" appends rather than replaces, and any filter change resets
  // to the first page through the query key.
  const jobOrdersQuery = useInfiniteQuery({
    queryKey: ['job-orders', params],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<JobOrder>>>(
        '/job-orders',
        { params: { ...params, cursor: pageParam } },
      );
      return res.data.data;
    },
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasMore && lastPage.pageInfo.nextCursor ? lastPage.pageInfo.nextCursor : undefined,
  });
  const jobOrders = useMemo(
    () => jobOrdersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [jobOrdersQuery.data],
  );

  // UXAUTH-014: Job-Order-specific option lookup — QA_USER/SENIOR_MANAGEMENT
  // can list Job Orders but are denied on the broad Factory master
  // (/factories is ADMIN/MERCHANDISER only), so this filter must not depend
  // on it. No status filter is passed: Job Order list is historical, and a
  // Factory that has since gone INACTIVE must remain selectable so its past
  // Job Orders stay filterable, not just visible in the unfiltered table.
  const factoriesQuery = useQuery({
    queryKey: ['job-order-factory-options'],
    enabled: mayFilterByFactory,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrderFactoryOption[]>>(
        '/job-orders/factory-options',
      );
      return res.data.data;
    },
  });

  const financialYearsQuery = useFinancialYearsQuery();
  const factoryName = (factoriesQuery.data ?? []).find((f) => f.id === effectiveFactoryId)?.name;
  const financialYearLabel = financialYearId
    ? toCompactFinancialYearCode(
        (financialYearsQuery.data ?? []).find((fy) => fy.id === financialYearId)?.code ?? '',
      )
    : undefined;

  const generateJobOrderListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateJobOrderListPdfBlob } = await import('./pdf/generateJobOrderListPdf.js');
    return generateJobOrderListPdfBlob(
      params,
      { search: debouncedSearch, status, factoryName, financialYearLabel },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [params, debouncedSearch, status, factoryName, financialYearLabel, user?.name]);

  const jobOrderListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Job-Orders', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({
    generate: generateJobOrderListPdf,
    filename: jobOrderListPdfFilename,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Job Orders"
        subtitle="Factory production orders created from Order Sheet demand"
        primaryAction={
          canCreate ? (
            <Button asChild>
              <Link to="/job-orders/new">Create Job Order</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search job order or Order Sheet"
            statusValue={status || 'ALL'}
            statusAriaLabel="Lifecycle"
            statusPlaceholder="All lifecycle states"
            onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as JobOrderStatus))}
            statusOptions={[
              { label: 'All lifecycle states', value: 'ALL' },
              ...(Object.keys(JOB_ORDER_STATUS_LABELS) as JobOrderStatus[]).map((s) => ({
                label: JOB_ORDER_STATUS_LABELS[s],
                value: s,
              })),
            ]}
            hasActiveFilters={Boolean(search || status || effectiveFactoryId || financialYearId)}
            onClearFilters={() => {
              setSearch('');
              setStatus('');
              setFinancialYearId('');
              handleFactoryChange('');
            }}
            actions={
              <>
                <FinancialYearSelect
                  aria-label="Financial Year"
                  value={financialYearId}
                  onValueChange={setFinancialYearId}
                  allLabel="All Financial Years"
                />
                {mayFilterByFactory ? (
                  <SelectField
                    aria-label="Factory"
                    value={effectiveFactoryId || 'ALL'}
                    onValueChange={handleFactoryChange}
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
                    {(factoriesQuery.data ?? []).map((factory) => (
                      <SelectItem key={factory.id} value={factory.id}>
                        {factory.name}
                        {factory.status === 'INACTIVE' ? ' (inactive)' : ''}
                      </SelectItem>
                    ))}
                  </SelectField>
                ) : undefined}
              </>
            }
          />
          {mayFilterByFactory && factoriesQuery.isError ? (
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
            key: 'jobOrderNumber',
            header: 'Job Order',
            render: (jobOrder) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/job-orders/${jobOrder.id}`}
              >
                {jobOrder.jobOrderNumber}
              </Link>
            ),
          },
          {
            key: 'sourceOrderSheetCount',
            header: 'Order Sheets',
            render: (jobOrder) => jobOrder.sourceOrderSheetCount,
          },
          {
            key: 'financialYear',
            header: 'FY',
            render: (jobOrder) => toCompactFinancialYearCode(jobOrder.financialYear.code),
          },
          { key: 'factory', header: 'Factory', render: (jobOrder) => jobOrder.factory.name },
          {
            key: 'processFlowVersion',
            header: 'Process Flow',
            render: (jobOrder) =>
              `${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`,
          },
          {
            key: 'workflow',
            header: showQaWork ? 'Status' : 'Current State',
            render: (jobOrder) => {
              if (!showQaWork) {
                return (
                  <div className="flex max-w-[18rem] flex-wrap items-center gap-1.5">
                    <StatusBadge
                      label={jobOrder.operationalState.primaryDisplayState.label}
                      tone={jobOrder.operationalState.primaryDisplayState.tone}
                      className="whitespace-normal break-words leading-tight"
                    />
                    {jobOrder.isDelayed && <StatusBadge label="Delayed" tone="warning" />}
                  </div>
                );
              }

              const status = getQaStatusPresentation(jobOrder.operationalState);
              return (
                <div className="max-w-[18rem] space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      label={status.primary.label}
                      tone={status.primary.tone}
                      className="whitespace-normal break-words leading-tight"
                    />
                    {jobOrder.isDelayed && <StatusBadge label="Delayed" tone="warning" />}
                  </div>
                  {status.secondaryLabel ? (
                    <div className="text-xs leading-tight text-muted-foreground">
                      Production: {status.secondaryLabel}
                    </div>
                  ) : null}
                </div>
              );
            },
          },
          {
            key: 'factoryConfirmationStatus',
            header: 'Confirmation',
            render: (jobOrder) => <StatusBadge {...getJobOrderConfirmationPresentation(jobOrder)} />,
          },
          {
            key: 'orderedQuantityTotal',
            header: 'Ordered',
            align: 'right',
            render: (jobOrder) => jobOrder.orderedQuantityTotal.toLocaleString(),
          },
          {
            key: 'preparedQuantityTotal',
            header: 'Prepared',
            align: 'right',
            render: (jobOrder) => formatPreparedQuantity(jobOrder, jobOrder.preparedQuantityTotal),
          },
          {
            key: 'createdAt',
            header: 'Created',
            render: (jobOrder) => formatDateTime(jobOrder.createdAt),
          },
        ]}
        data={jobOrders}
        loading={jobOrdersQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading job orders" />}
        emptyState={
          <EmptyState
            title="No job orders found"
            description="Create job orders from available Order Sheet demand."
          />
        }
        error={
          jobOrdersQuery.isError ? (
            <ErrorState
              title="Unable to load job orders"
              description={jobOrdersQuery.error.message}
            />
          ) : undefined
        }
      />
      {jobOrders.length > 0 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Showing {jobOrders.length.toLocaleString()} job order{jobOrders.length === 1 ? '' : 's'}
            {jobOrdersQuery.hasNextPage ? '' : ' (all loaded)'}
          </span>
          {jobOrdersQuery.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void jobOrdersQuery.fetchNextPage()}
              disabled={jobOrdersQuery.isFetchingNextPage}
            >
              {jobOrdersQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {jobOrdersQuery.isFetchNextPageError ? (
        <ValidationMessage tone="error">Unable to load more job orders. Try again.</ValidationMessage>
      ) : null}
    </div>
  );
}
