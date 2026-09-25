import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useAuth } from '../../auth/AuthContext.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { Size } from './types.js';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';

function errorMessage(error: unknown) {
  if (isAxiosError(error)) return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to create size';
}

export function SizeListPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({ code: '', label: '', sizeType: 'AGE', sortOrder: '' });
  const [error, setError] = useState('');
  // Opt-in cursor pagination (limit sent): Load more appends further pages.
  // The PDF fetches every page.
  const { query: sizesQuery, items: sizes } = useCursorList<Size>({
    queryKey: ['sizes'],
    path: '/sizes',
    params: { limit: 25 },
  });
  const createMutation = useMutation({
    mutationFn: () => {
      setError('');
      if (!form.code.trim() || !form.label.trim() || !form.sortOrder.trim() || Number.isNaN(Number(form.sortOrder))) {
        throw new Error('Code, label, and sort order are required');
      }
      return apiClient.post('/sizes', { ...form, code: form.code.trim(), label: form.label.trim(), sortOrder: Number(form.sortOrder) });
    },
    onSuccess: async () => {
      // Only clear the form once the size is actually created — a failed
      // create (validation or duplicate-code conflict) must preserve what
      // the user typed so they can fix and resubmit it.
      setForm({ code: '', label: '', sizeType: 'AGE', sortOrder: '' });
      await queryClient.invalidateQueries({ queryKey: ['sizes'] });
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const generateSizeListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateSizeListPdfBlob } = await import('./pdf/generateSizeListPdf.js');
    return generateSizeListPdfBlob(await fetchAllListPages<Size>('/sizes'), {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [user?.name]);

  const sizeListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Sizes', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({ generate: generateSizeListPdf, filename: sizeListPdfFilename });

  return (
    <div className="space-y-5">
      <PageHeader title="Sizes" subtitle="Size codes available for style mapping" />

      <Panel title="Add Size">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <FormGrid columns={4}>
            <TextField
              label="Code *"
              value={form.code}
              errorMessage={error && !form.code.trim() ? 'Required' : undefined}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
            <TextField
              label="Label *"
              value={form.label}
              errorMessage={error && !form.label.trim() ? 'Required' : undefined}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
            <SelectField
              label="Type *"
              value={form.sizeType}
              onValueChange={(value) => setForm({ ...form, sizeType: value })}
              width="fill"
            >
              <SelectItem value="AGE">Age</SelectItem>
              <SelectItem value="ALPHA">Alpha</SelectItem>
              <SelectItem value="NUMERIC">Numeric</SelectItem>
              <SelectItem value="WAIST">Waist</SelectItem>
              <SelectItem value="FREE_SIZE">Free Size</SelectItem>
            </SelectField>
            <TextField
              label="Sort Order *"
              type="number"
              value={form.sortOrder}
              errorMessage={error && !form.sortOrder.trim() ? 'Required' : undefined}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </FormGrid>
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <div className="flex justify-end">
            <Button type="submit" loading={createMutation.isPending}>
              Add
            </Button>
          </div>
        </form>
      </Panel>

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
            render: (size) => (
              <Link
                className="font-medium text-primary hover:underline"
                to={`/master-data/sizes/${size.id}`}
              >
                {size.code}
              </Link>
            ),
          },
          { key: 'label', header: 'Label', accessor: 'label' },
          { key: 'sizeType', header: 'Type', render: (size) => size.sizeType.replace('_', ' ') },
          { key: 'sortOrder', header: 'Sort', accessor: 'sortOrder', align: 'right' },
          {
            key: 'status',
            header: 'Status',
            render: (size) => (
              <StatusBadge
                label={size.status}
                tone={size.status === 'ACTIVE' ? 'success' : 'muted'}
              />
            ),
          },
        ]}
        data={sizes}
        loading={sizesQuery.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading sizes" />}
        emptyState={
          <EmptyState
            title="No sizes found"
            description="Create a size to use it in style mappings."
          />
        }
        error={
          sizesQuery.isError ? (
            <ErrorState title="Unable to load sizes" description={sizesQuery.error.message} />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(sizesQuery, sizes.length, ['size', 'sizes'])} />
    </div>
  );
}
