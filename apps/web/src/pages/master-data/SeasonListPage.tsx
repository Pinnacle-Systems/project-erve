import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ConfirmDialog, FilterBar, PageHeader, StatusBadge, createEnterToNextHandler } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { fetchAllListPages } from '../../lib/pdf/fetchAllListPages.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useAuth } from '../../auth/AuthContext.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { Season, Status } from './types.js';

function errorMessage(error: unknown) {
  if (isAxiosError(error)) return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save Season';
}

export function SeasonListPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const emptyForm = { code: '', name: '', barcodeSerial: '' };
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Season | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  const [error, setError] = useState('');
  const [confirmStatusSeason, setConfirmStatusSeason] = useState<Season | null>(null);
  const listParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
    }),
    [debouncedSearch, statusFilter],
  );
  // Opt-in cursor pagination (limit sent): Load more appends further pages; a
  // filter change restarts at page 1. The PDF fetches every page (unfiltered
  // by search/status).
  const { query: seasonsQuery, items: seasons } = useCursorList<Season>({
    queryKey: ['seasons'],
    path: '/seasons',
    params: { ...listParams, limit: 25 },
  });
  const generateSeasonListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateSeasonListPdfBlob } = await import('./pdf/generateSeasonListPdf.js');
    return generateSeasonListPdfBlob(
      await fetchAllListPages<Season>('/seasons', {}),
      {},
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [user?.name]);

  const seasonListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Seasons', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({ generate: generateSeasonListPdf, filename: seasonListPdfFilename });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['seasons'] });
  const save = useMutation({
    mutationFn: async () => {
      setError('');
      const barcodeSerial = form.barcodeSerial.trim();
      const value = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        // Blank = none yet (never auto-assigned); omitted on edit so an unset field cannot clear a serial.
        ...(barcodeSerial === '' ? {} : { barcodeSerial: Number(barcodeSerial) }),
      };
      if (!value.code || !value.name) throw new Error('Season code and name are required');
      if (barcodeSerial !== '' && !/^[1-9]\d{0,4}$/.test(barcodeSerial))
        throw new Error('Barcode Serial must be a whole number from 1 to 99999');
      return editing ? apiClient.patch(`/seasons/${editing.id}`, value) : apiClient.post('/seasons', value);
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditing(null);
      await refresh();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });
  const status = useMutation({
    mutationFn: (season: Season) =>
      apiClient.patch(`/seasons/${season.id}/status`, {
        status: season.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: async () => {
      setConfirmStatusSeason(null);
      await refresh();
    },
  });
  const beginEdit = (season: Season) => {
    setEditing(season);
    setForm({
      code: season.code,
      name: season.name,
      barcodeSerial: season.barcodeSerial == null ? '' : String(season.barcodeSerial),
    });
    setError('');
  };
  const beginAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setError('');
  };
  return <div className="space-y-5">
    <PageHeader title="Seasons" subtitle="Season master records used by Styles. Inactive Seasons remain visible on historical records." primaryAction={<Button asChild variant="secondary"><Link to="/master-data/seasons/import">Import</Link></Button>} />
    <Panel title={editing ? 'Edit Season' : 'Add Season'}>
      <form className="space-y-4" noValidate onKeyDown={createEnterToNextHandler()} onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <FormGrid layout="content">
          <TextField required label="Season code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} errorMessage={error && !form.code.trim() ? 'Required' : undefined} width="sm" />
          <TextField required label="Season name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} errorMessage={error && !form.name.trim() ? 'Required' : undefined} width="md" />
          <TextField
            label="Barcode Serial"
            inputMode="numeric"
            width="sm"
            value={form.barcodeSerial}
            helpText="Unique. Fixed once barcodes exist."
            onChange={(event) => setForm({ ...form, barcodeSerial: event.target.value })}
          />
          <div className="flex gap-2 pt-[1.375rem]">
            {editing ? <Button type="button" variant="secondary" onClick={beginAdd}>Cancel</Button> : null}
            <Button type="submit" loading={save.isPending}>{editing ? 'Save Changes' : 'Add Season'}</Button>
          </div>
        </FormGrid>
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      </form>
    </Panel>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search Seasons"
          statusOptions={[
            { label: 'All statuses', value: 'ALL' },
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Inactive', value: 'INACTIVE' },
          ]}
          statusValue={statusFilter || 'ALL'}
          onStatusChange={(value) => setStatusFilter(value === 'ALL' ? '' : (value as Status))}
          hasActiveFilters={Boolean(search || statusFilter)}
          onClearFilters={() => {
            setSearch('');
            setStatusFilter('');
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
    <DataTable columns={[
      { key: 'code', header: 'Code', accessor: 'code' },
      { key: 'name', header: 'Season name', accessor: 'name' },
      { key: 'barcodeSerial', header: 'Barcode serial', render: (season) => season.barcodeSerial ?? '-' },
      { key: 'status', header: 'Status', render: (season) => <StatusBadge label={season.status} tone={season.status === 'ACTIVE' ? 'success' : 'muted'} /> },
      { key: 'actions', header: 'Actions', render: (season) => <div className="flex gap-2"><Button variant="secondary" onClick={() => beginEdit(season)}>Edit</Button><Button variant="secondary" onClick={() => setConfirmStatusSeason(season)}>{season.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button></div> },
    ]} data={seasons} loading={seasonsQuery.isLoading} loadingState={<LoadingState variant="rows" label="Loading Seasons" />} emptyState={<EmptyState title="No Seasons found" description="Create a Season before assigning it to a Style." />} error={seasonsQuery.isError ? <ErrorState title="Unable to load Seasons" description={seasonsQuery.error.message} /> : undefined} />
      <LoadMoreFooter {...loadMoreProps(seasonsQuery, seasons.length, ['Season', 'Seasons'])} />
    <ConfirmDialog
      open={confirmStatusSeason !== null}
      onOpenChange={(open) => { if (!open) setConfirmStatusSeason(null); }}
      title={confirmStatusSeason?.status === 'ACTIVE' ? `Deactivate ${confirmStatusSeason.code}?` : `Activate ${confirmStatusSeason?.code}?`}
      description={
        confirmStatusSeason?.status === 'ACTIVE'
          ? `${confirmStatusSeason.code} — ${confirmStatusSeason.name} will be blocked from new Style assignments. Historical records remain unchanged.`
          : `${confirmStatusSeason?.code} — ${confirmStatusSeason?.name} will become available for new Style assignments again.`
      }
      confirmLabel={confirmStatusSeason?.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
      destructive={confirmStatusSeason?.status === 'ACTIVE'}
      loading={status.isPending}
      onConfirm={() => confirmStatusSeason && status.mutate(confirmStatusSeason)}
    />
  </div>;
}
