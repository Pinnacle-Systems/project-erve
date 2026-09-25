import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageStyles } from '../../auth/permissions.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { StyleThumbnailCell } from './StyleThumbnailCell.js';
import type { Status, Style } from './types.js';

export function StyleListPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<Status | ''>('');
  const params = useMemo(
    () => ({ search: debouncedSearch || undefined, status: status || undefined }),
    [debouncedSearch, status],
  );

  // Opt-in cursor pagination (limit sent): Load more appends further pages; a
  // filter change restarts at page 1. The PDF fetches every matching page.
  const { query: stylesQuery, items: styles } = useCursorList<Style>({
    queryKey: ['styles'],
    path: '/styles',
    params: { ...params, limit: 25 },
  });

  const generateStyleListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateStyleListPdfBlob } = await import('./pdf/generateStyleListPdf.js');
    return generateStyleListPdfBlob(
      await fetchAllListPages<Style>('/styles', params),
      { search: debouncedSearch, status },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [params, debouncedSearch, status, user?.name]);

  const styleListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Styles', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({ generate: generateStyleListPdf, filename: styleListPdfFilename });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Styles"
        subtitle="Item master records"
        primaryAction={
          canManageStyles(user) ? (
            <Button asChild variant="default">
              <Link to="/master-data/styles/new">Create Style</Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search styles"
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
            key: 'image',
            header: 'Image',
            width: '56px',
            render: (style) => (
              <StyleThumbnailCell
                styleId={style.id}
                image={style.images.find((image) => image.isPrimary) ?? style.images[0] ?? null}
              />
            ),
          },
          {
            key: 'styleNumber',
            header: 'Style Number',
            render: (style) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`/master-data/styles/${style.id}`}>
                {style.styleNumber}
              </Link>
            ),
          },
          { key: 'styleName', header: 'Style Name', accessor: 'styleName' },
          { key: 'ipName', header: 'IP', accessor: 'ipName' },
          { key: 'licensor', header: 'Licensor', accessor: 'licensor' },
          { key: 'colour', header: 'Colour', accessor: 'colour' },
          { key: 'lmixNumber', header: 'LMIX', accessor: 'lmixNumber' },
          { key: 'finalMrp', header: 'Final MRP', align: 'right', render: (style) => style.finalMrp.toFixed(2) },
          {
            key: 'status',
            header: 'Status',
            render: (style) => (
              <StatusBadge label={style.status} tone={style.status === 'ACTIVE' ? 'success' : 'muted'} />
            ),
          },
        ]}
        data={styles}
        loading={stylesQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading styles" />}
        emptyState={<EmptyState title="No styles found" description="Style records will appear here." />}
        error={
          stylesQuery.isError ? (
            <ErrorState title="Unable to load styles" description={stylesQuery.error.message} />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(stylesQuery, styles.length, ['style', 'styles'])} />
    </div>
  );
}
