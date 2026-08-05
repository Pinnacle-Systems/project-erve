import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Season } from './types.js';

const emptyForm = { code: '', name: '', financialYear: '' };
const financialYearPattern = /^\d{2}-\d{2}$/;
function errorMessage(error: unknown) {
  if (isAxiosError(error)) return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : 'Unable to save Season';
}

export function SeasonListPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Season | null>(null);
  const [error, setError] = useState('');
  const seasonsQuery = useQuery({ queryKey: ['seasons'], queryFn: async () => (await apiClient.get<ApiSuccessResponse<Season[]>>('/seasons')).data.data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['seasons'] });
  const save = useMutation({
    mutationFn: async () => {
      setError('');
      const value = { code: form.code.trim().toUpperCase(), name: form.name.trim(), financialYear: form.financialYear.trim() };
      if (!value.code || !value.name || !financialYearPattern.test(value.financialYear)) throw new Error('Season code, name, and a YY-YY financial year are required');
      return editing ? apiClient.patch(`/seasons/${editing.id}`, value) : apiClient.post('/seasons', value);
    },
    onSuccess: async () => { setForm(emptyForm); setEditing(null); await refresh(); },
    onError: (caught) => setError(errorMessage(caught)),
  });
  const status = useMutation({ mutationFn: (season: Season) => apiClient.patch(`/seasons/${season.id}/status`, { status: season.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), onSuccess: refresh });
  const beginEdit = (season: Season) => { setEditing(season); setForm({ code: season.code, name: season.name, financialYear: season.financialYear }); setError(''); };
  return <div className="space-y-5">
    <PageHeader title="Seasons" subtitle="Season master records used by Styles. Inactive Seasons remain visible on historical records." />
    <Panel title={editing ? 'Edit Season' : 'Add Season'}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <FormGrid columns={3}>
          <TextField label="Season code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} errorMessage={error && !form.code.trim() ? 'Required' : undefined} />
          <TextField label="Season name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} errorMessage={error && !form.name.trim() ? 'Required' : undefined} />
          <TextField label="Financial year" placeholder="YY-YY" value={form.financialYear} onChange={(event) => setForm({ ...form, financialYear: event.target.value })} errorMessage={error && !financialYearPattern.test(form.financialYear.trim()) ? 'Use YY-YY, for consecutive years' : undefined} />
        </FormGrid>
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
        <div className="flex justify-end gap-2">{editing ? <Button type="button" variant="secondary" onClick={() => { setEditing(null); setForm(emptyForm); setError(''); }}>Cancel</Button> : null}<Button type="submit" loading={save.isPending}>{editing ? 'Save Changes' : 'Add Season'}</Button></div>
      </form>
    </Panel>
    <DataTable columns={[
      { key: 'code', header: 'Code', accessor: 'code' },
      { key: 'name', header: 'Season name', accessor: 'name' },
      { key: 'financialYear', header: 'Financial year', accessor: 'financialYear' },
      { key: 'displayName', header: 'Display', accessor: 'displayName' },
      { key: 'status', header: 'Status', render: (season) => <StatusBadge label={season.status} tone={season.status === 'ACTIVE' ? 'success' : 'muted'} /> },
      { key: 'actions', header: 'Actions', render: (season) => <div className="flex gap-2"><Button variant="secondary" onClick={() => beginEdit(season)}>Edit</Button><Button variant="secondary" loading={status.isPending} onClick={() => status.mutate(season)}>{season.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button></div> },
    ]} data={seasonsQuery.data ?? []} loading={seasonsQuery.isLoading} loadingState={<LoadingState variant="rows" label="Loading Seasons" />} emptyState={<EmptyState title="No Seasons found" description="Create a Season before assigning it to a Style." />} error={seasonsQuery.isError ? <ErrorState title="Unable to load Seasons" description={seasonsQuery.error.message} /> : undefined} />
  </div>;
}
