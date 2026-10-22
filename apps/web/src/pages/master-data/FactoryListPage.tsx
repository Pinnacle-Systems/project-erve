import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageFactories } from '../../auth/permissions.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { Factory, Status } from './types.js';

export function FactoryListPage() {
  const { user } = useAuth();
  const canManage = canManageFactories(user);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<Status | ''>('');
  const listParams = useMemo(
    () => ({ search: debouncedSearch || undefined, status: status || undefined }),
    [debouncedSearch, status],
  );
  // Opt-in cursor pagination (limit sent): Load more appends further pages; a
  // filter change restarts at page 1. The PDF fetches every page (unfiltered
  // — it keeps its existing full-export behavior).
  const { query: factoriesQuery, items: factories } = useCursorList<Factory>({
    queryKey: ['factories'],
    path: '/factories',
    params: { ...listParams, limit: 25 },
  });

  const generateFactoryListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateFactoryListPdfBlob } = await import('./pdf/generateFactoryListPdf.js');
    return generateFactoryListPdfBlob(await fetchAllListPages<Factory>('/factories'), {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [user?.name]);

  const factoryListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Factories', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({
    generate: generateFactoryListPdf,
    filename: factoryListPdfFilename,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Factories"
        subtitle="Factory master records and contacts"
        primaryAction={
          canManage ? (
            <div className="flex gap-2">
              <Button asChild variant="secondary">
                <Link to="/master-data/factories/import">Import Factories</Link>
              </Button>
              <Button asChild>
                <Link to="/master-data/factories/new">Add Factory</Link>
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search factories"
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
            render: (factory) => (
              <Link
                className="font-medium text-primary hover:underline"
                to={`/master-data/factories/${factory.id}`}
              >
                {factory.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Name', accessor: 'name' },
          {
            key: 'contactName',
            header: 'Contact',
            render: (factory) => factory.contactName ?? '—',
          },
          {
            key: 'contactEmail',
            header: 'Email',
            render: (factory) => factory.contactEmail ?? '—',
          },
          {
            key: 'contactPhone',
            header: 'Phone',
            render: (factory) => factory.contactPhone ?? '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (factory) => (
              <StatusBadge
                label={factory.status}
                tone={factory.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={factories}
        loading={factoriesQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading factories" />}
        emptyState={
          <EmptyState title="No factories found" description="Factory records will appear here." />
        }
        error={
          factoriesQuery.isError ? (
            <ErrorState
              title="Unable to load factories"
              description={factoriesQuery.error.message}
            />
          ) : undefined
        }
      />
      <LoadMoreFooter
        {...loadMoreProps(factoriesQuery, factories.length, ['factory', 'factories'])}
      />
    </div>
  );
}
