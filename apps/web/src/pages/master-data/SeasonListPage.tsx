import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import {
  FinancialYearSelect,
  toCompactFinancialYearCode,
  useCurrentFinancialYearQuery,
  useFinancialYearsQuery,
} from '../../lib/financial-years.js';
import { useAuth } from '../../auth/AuthContext.js';
import { getLocalDateString } from '../../lib/dates.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import type { Season } from './types.js';

function errorMessage(error: unknown) {
  if (isAxiosError(error)) return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save Season';
}

export function SeasonListPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const currentFinancialYearQuery = useCurrentFinancialYearQuery();
  const financialYearsQuery = useFinancialYearsQuery();
  const emptyForm = { code: '', name: '', financialYearId: '' };
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Season | null>(null);
  const [filterFinancialYearId, setFilterFinancialYearId] = useState('');
  const [error, setError] = useState('');
  const [confirmStatusSeason, setConfirmStatusSeason] = useState<Season | null>(null);
  // Bumped whenever the Add/Edit form's target identity changes (switching
  // into or out of Edit, or resetting after a successful save) so the
  // Financial Year Select below remounts with `key`. Its value otherwise
  // changes on an already-mounted, already-interactive Select — e.g. Add's
  // '' -> current-FY default, or Add's default -> a different Season's FY on
  // Edit — which is exactly the external (non-user-driven) post-mount value
  // change that reproduces Radix's hidden bubble-select clobbering the
  // display back to the placeholder (confirmed via the Case C regression
  // test in SeasonListPage.test.tsx; Cases A/B proved the Add form's own
  // '' -> current-FY default transition is safe on its own, so this key only
  // needs to change on a target switch, not on every query resolution).
  const [formKey, setFormKey] = useState(0);
  // The Add-Season form defaults to the current Financial Year once it's
  // known — derived at render time (never written back into state) so it
  // updates as soon as the query resolves, without a setState-in-effect.
  // Only applies while adding (not mid-edit) and the user hasn't picked one.
  const effectiveFinancialYearId =
    form.financialYearId || (editing ? '' : currentFinancialYearQuery.data?.id ?? '');
  const seasonsQuery = useQuery({
    queryKey: ['seasons', filterFinancialYearId],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<Season[]>>('/seasons', {
          params: { financialYearId: filterFinancialYearId || undefined },
        })
      ).data.data,
  });
  const generateSeasonListPdf = useCallback(async () => {
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateSeasonListPdfBlob } = await import('./pdf/generateSeasonListPdf.js');
    const selectedFinancialYear = financialYearsQuery.data?.find(
      (fy) => fy.id === filterFinancialYearId,
    );
    return generateSeasonListPdfBlob(
      seasonsQuery.data ?? [],
      { financialYear: selectedFinancialYear ? toCompactFinancialYearCode(selectedFinancialYear.code) : undefined },
      { generatedAt: new Date().toISOString(), generatedBy: user?.name },
    );
  }, [seasonsQuery.data, filterFinancialYearId, financialYearsQuery.data, user?.name]);

  const seasonListPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Seasons', getLocalDateString()]),
    [],
  );

  const pdfAction = usePdfAction({ generate: generateSeasonListPdf, filename: seasonListPdfFilename });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['seasons'] });
  const save = useMutation({
    mutationFn: async () => {
      setError('');
      const value = { code: form.code.trim().toUpperCase(), name: form.name.trim(), financialYearId: effectiveFinancialYearId };
      if (!value.code || !value.name || !value.financialYearId)
        throw new Error('Season code, name, and Financial Year are required');
      return editing ? apiClient.patch(`/seasons/${editing.id}`, value) : apiClient.post('/seasons', value);
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setEditing(null);
      setFormKey((key) => key + 1);
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
    setForm({ code: season.code, name: season.name, financialYearId: season.financialYear.id });
    setError('');
    setFormKey((key) => key + 1);
  };
  const beginAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setFormKey((key) => key + 1);
  };
  return <div className="space-y-5">
    <PageHeader title="Seasons" subtitle="Season master records used by Styles. Inactive Seasons remain visible on historical records." />
    <Panel title={editing ? 'Edit Season' : 'Add Season'}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <FormGrid columns={3}>
          <TextField label="Season code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} errorMessage={error && !form.code.trim() ? 'Required' : undefined} />
          <TextField label="Season name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} errorMessage={error && !form.name.trim() ? 'Required' : undefined} />
          <FinancialYearSelect
            key={formKey}
            label="Financial Year"
            width="md"
            value={effectiveFinancialYearId}
            onValueChange={(value) => setForm({ ...form, financialYearId: value })}
            errorMessage={error && !effectiveFinancialYearId ? 'Required' : undefined}
          />
        </FormGrid>
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">{editing ? <Button type="button" variant="secondary" onClick={beginAdd}>Cancel</Button> : null}<Button type="submit" loading={save.isPending}>{editing ? 'Save Changes' : 'Add Season'}</Button></div>
      </form>
    </Panel>
    <div className="flex items-start justify-between gap-3">
      <FinancialYearSelect
        aria-label="Filter by Financial Year"
        value={filterFinancialYearId}
        onValueChange={setFilterFinancialYearId}
        allLabel="All Financial Years"
      />
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
      { key: 'financialYear', header: 'Financial year', render: (season) => toCompactFinancialYearCode(season.financialYear.code) },
      { key: 'displayName', header: 'Display', accessor: 'displayName' },
      { key: 'status', header: 'Status', render: (season) => <StatusBadge label={season.status} tone={season.status === 'ACTIVE' ? 'success' : 'muted'} /> },
      { key: 'actions', header: 'Actions', render: (season) => <div className="flex gap-2"><Button variant="secondary" onClick={() => beginEdit(season)}>Edit</Button><Button variant="secondary" onClick={() => setConfirmStatusSeason(season)}>{season.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button></div> },
    ]} data={seasonsQuery.data ?? []} loading={seasonsQuery.isLoading} loadingState={<LoadingState variant="rows" label="Loading Seasons" />} emptyState={<EmptyState title="No Seasons found" description="Create a Season before assigning it to a Style." />} error={seasonsQuery.isError ? <ErrorState title="Unable to load Seasons" description={seasonsQuery.error.message} /> : undefined} />
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
