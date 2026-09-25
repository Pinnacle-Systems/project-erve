import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageFactories } from '../../auth/permissions.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { Factory } from './types.js';

export function FactoryListPage() {
  const { user } = useAuth();
  const canManage = canManageFactories(user);
  // Opt-in cursor pagination (limit sent): Load more appends further pages.
  // The PDF fetches every page.
  const { query: factoriesQuery, items: factories } = useCursorList<Factory>({
    queryKey: ['factories'],
    path: '/factories',
    params: { limit: 25 },
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

  const pdfAction = usePdfAction({ generate: generateFactoryListPdf, filename: factoryListPdfFilename });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Factories"
        subtitle="Factory master records and contacts"
        primaryAction={
          canManage ? (
            <Button asChild>
              <Link to="/master-data/factories/new">Add Factory</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex justify-end">
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
      <LoadMoreFooter {...loadMoreProps(factoriesQuery, factories.length, ['factory', 'factories'])} />
    </div>
  );
}
