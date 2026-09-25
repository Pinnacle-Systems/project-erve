import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageDistributorMaster } from '../../auth/permissions.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { DistributorSummary, Status } from './types.js';

export function DistributorListPage() {
  const { user } = useAuth();
  const canManage = canManageDistributorMaster(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(
    () => ({ search: debouncedSearch || undefined, status: status || undefined }),
    [debouncedSearch, status],
  );

  // Opt-in cursor pagination (limit sent): Load more appends further pages; a
  // filter change restarts at page 1. The PDF fetches every matching page.
  const { query: distributorsQuery, items: distributors } = useCursorList<DistributorSummary>({
    queryKey: ['distributors'],
    path: '/distributors',
    params: { ...params, limit: 25 },
  });

  const generateDistributorListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateDistributorListPdfBlob } = await import('./pdf/generateDistributorListPdf.js');
    return generateDistributorListPdfBlob(
      await fetchAllListPages<DistributorSummary>('/distributors', params),
      { search: debouncedSearch, status },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [params, debouncedSearch, status, user?.name]);

  const distributorListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Distributors', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({
    generate: generateDistributorListPdf,
    filename: distributorListPdfFilename,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Distributors"
        subtitle="Distributor master records and contacts"
        primaryAction={
          canManage ? (
            <Button asChild variant="default">
              <Link to="/master-data/distributors/new">Create Distributor</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search distributors"
            statusOptions={[
              { label: 'All statuses', value: 'ALL' },
              { label: 'Active', value: 'ACTIVE' },
              { label: 'Inactive', value: 'INACTIVE' },
            ]}
            statusValue={status || 'ALL'}
            onStatusChange={(value) => setStatus(value === 'ALL' ? '' : (value as Status))}
            hasActiveFilters={Boolean(search || status)}
            onClearFilters={() => {
              setSearch('');
              setStatus('');
            }}
          />
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
            render: (distributor) => (
              <Link
                className="font-medium text-[var(--erp-text-link)]"
                to={`/master-data/distributors/${distributor.id}`}
              >
                {distributor.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          {
            key: 'contactName',
            header: 'Contact',
            render: (distributor) => distributor.contactName ?? '—',
          },
          { key: 'city', header: 'City', render: (distributor) => distributor.city ?? '—' },
          {
            key: 'status',
            header: 'Status',
            render: (distributor) => (
              <StatusBadge
                label={distributor.status}
                tone={distributor.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={distributors}
        loading={distributorsQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading distributors" />}
        emptyState={
          <EmptyState
            title="No distributors found"
            description="Distributor records will appear here."
          />
        }
        error={
          distributorsQuery.isError ? (
            <ErrorState
              title="Unable to load distributors"
              description={distributorsQuery.error.message}
            />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(distributorsQuery, distributors.length, ['distributor', 'distributors'])} />
    </div>
  );
}
