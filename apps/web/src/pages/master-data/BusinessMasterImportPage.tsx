import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  MasterImportHistoryEntry,
  MasterImportKind,
  MasterImportPlan,
  MasterImportResult,
  MasterImportRow,
} from '@erve/types';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, ErrorState } from '@erve/data-display';
import { Panel } from '@erve/layout';
import { useAuth } from '../../auth/AuthContext.js';
import {
  canManageFactories,
  canManageDistributorMaster,
  canManageRetailStores,
  canManageSeasons,
  canManageSizes,
  canManageHsns,
} from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { downloadPdfBlob as downloadBlob } from '../../lib/pdf/download.js';

const labels: Record<MasterImportKind, string> = {
  seasons: 'Seasons',
  sizes: 'Sizes',
  hsns: 'HSNs',
  factories: 'Factories',
  distributors: 'Distributors',
  'retail-stores': 'Retail Stores',
};
const tones: Record<MasterImportRow['outcome'], StatusBadgeTone> = {
  CREATE: 'success',
  SKIP_EXISTING: 'muted',
  NEEDS_REVIEW: 'warning',
  REJECTED: 'danger',
  FAILED: 'danger',
};

function ImportRows({ rows, kind }: { rows: MasterImportRow[]; kind: MasterImportKind }) {
  const [limit, setLimit] = useState(50);
  return (
    <>
      <DataTable<MasterImportRow>
        data={rows.slice(0, limit)}
        rowKey={(row) => String(row.rowNumber)}
        columns={[
          { key: 'row', header: 'Source row', render: (row) => row.rowNumber },
          ...(kind === 'seasons'
            ? [
                {
                  key: 'name',
                  header: 'Season name',
                  render: (row: MasterImportRow) => row.input.name ?? row.raw['Season Name'] ?? '',
                },
                {
                  key: 'year',
                  header: 'Financial year',
                  render: (row: MasterImportRow) => row.raw['Financial Year'] ?? '',
                },
                {
                  key: 'serial',
                  header: 'Barcode serial',
                  render: (row: MasterImportRow) => row.input.barcodeSerial ?? 'NULL',
                },
              ]
            : kind === 'sizes'
              ? [
                  {
                    key: 'label',
                    header: 'Size label',
                    render: (row: MasterImportRow) => row.input.label ?? '',
                  },
                  {
                    key: 'type',
                    header: 'Size type',
                    render: (row: MasterImportRow) => row.input.sizeType ?? '',
                  },
                  {
                    key: 'sort',
                    header: 'Sort order',
                    render: (row: MasterImportRow) => row.input.sortOrder ?? '',
                  },
                ]
              : kind === 'hsns'
                ? [
                    {
                      key: 'description',
                      header: 'Description',
                      render: (row: MasterImportRow) => row.input.description ?? '',
                    },
                  ]
                : [
                    {
                      key: 'name',
                      header: 'Name',
                      render: (row: MasterImportRow) => row.input.name ?? row.raw.Name ?? '',
                    },
                  ]),
          {
            key: 'outcome',
            header: 'Outcome',
            render: (row) => <StatusBadge tone={tones[row.outcome]} label={row.outcome} />,
          },
          {
            key: 'code',
            header: ['seasons', 'sizes', 'hsns'].includes(kind) ? 'Code' : 'Generated code',
            render: (row) => row.code ?? row.input.code ?? '',
          },
          {
            key: 'detail',
            header: 'Detail',
            render: (row) => [row.detail, ...(row.warnings ?? [])].filter(Boolean).join(' '),
          },
        ]}
      />
      {rows.length > limit && (
        <Button variant="secondary" onClick={() => setLimit((value) => value + 50)}>
          Show more rows
        </Button>
      )}
    </>
  );
}

export function BusinessMasterImportPage({ kind }: { kind: MasterImportKind }) {
  const { user } = useAuth();
  const allowed =
    kind === 'seasons'
      ? canManageSeasons(user)
      : kind === 'sizes'
        ? canManageSizes(user)
        : kind === 'hsns'
          ? canManageHsns(user)
          : kind === 'factories'
            ? canManageFactories(user)
            : kind === 'distributors'
              ? canManageDistributorMaster(user)
              : canManageRetailStores(user);
  if (!allowed)
    return (
      <ErrorState
        title="Import not permitted"
        description="An authorized master-maintenance role is required."
      />
    );
  return <ImportWorkflow key={kind} kind={kind} />;
}

function ImportWorkflow({ kind }: { kind: MasterImportKind }) {
  const queryClient = useQueryClient();
  const base = `/master-imports/${kind}`;
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [worksheet, setWorksheet] = useState('');
  const [plan, setPlan] = useState<MasterImportPlan | null>(null);
  const [result, setResult] = useState<MasterImportResult | null>(null);
  const [selectedRun, setSelectedRun] = useState('');
  const [error, setError] = useState('');
  const history = useQuery({
    queryKey: ['master-import-history', kind],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<MasterImportHistoryEntry[]>>(`${base}/history`)).data
        .data,
  });
  const detail = useQuery({
    queryKey: ['master-import-run', kind, selectedRun],
    enabled: Boolean(selectedRun),
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<{ rows: Array<{ payload: MasterImportRow }> }>>(
          `${base}/history/${selectedRun}`,
        )
      ).data.data,
  });
  const upload = () => {
    if (!file) throw new Error('Choose an import file');
    const body = new FormData();
    body.append('file', file);
    if (worksheet) body.append('worksheet', worksheet);
    return body;
  };
  const fail = (caught: unknown) =>
    setError(getApiErrorMessage(caught, 'Unable to complete the import request. Try again.'));
  const worksheets = useMutation({
    mutationFn: async (selected: File) => {
      const body = new FormData();
      body.append('file', selected);
      return (
        await apiClient.post<ApiSuccessResponse<{ worksheets: string[] }>>(
          `${base}/worksheets`,
          body,
        )
      ).data.data.worksheets;
    },
    onSuccess: setSheets,
    onError: fail,
  });
  const preview = useMutation({
    mutationFn: async () =>
      (await apiClient.post<ApiSuccessResponse<MasterImportPlan>>(`${base}/preflight`, upload()))
        .data.data,
    onSuccess: (data) => {
      setPlan(data);
      setResult(null);
      setError('');
    },
    onError: fail,
  });
  const execute = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error('Preview the file before confirming');
      const body = upload();
      body.append('confirmationToken', plan.confirmationToken);
      return (await apiClient.post<ApiSuccessResponse<MasterImportResult>>(`${base}/execute`, body))
        .data.data;
    },
    onSuccess: (data) => {
      setResult(data);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['master-import-history', kind] });
      void queryClient.invalidateQueries({ queryKey: [kind] });
    },
    onError: (caught) => {
      setPlan(null);
      fail(caught);
    },
  });
  const download = useMutation({
    mutationFn: async (target: 'template' | 'preview' | 'run') => {
      const response =
        target === 'preview'
          ? await apiClient.post<Blob>(`${base}/exceptions`, upload(), { responseType: 'blob' })
          : await apiClient.get<Blob>(
              target === 'run' ? `${base}/history/${selectedRun}/exceptions` : `${base}/template`,
              { responseType: 'blob' },
            );
      downloadBlob(
        response.data,
        `${kind}-${target === 'template' ? 'template' : 'exceptions'}.xlsx`,
      );
    },
    onError: fail,
  });
  const busy = worksheets.isPending || preview.isPending || execute.isPending || download.isPending;
  const ready = Boolean(file && (/\.csv$/i.test(file.name) || worksheet));
  const choose = (selected: File | null) => {
    setFile(selected);
    setPlan(null);
    setResult(null);
    setWorksheet('');
    setSheets([]);
    setError('');
    worksheets.reset();
    preview.reset();
    execute.reset();
    if (selected && !/\.(csv|xlsx)$/i.test(selected.name)) {
      setFile(null);
      setError('Choose a CSV or XLSX file');
    } else if (selected && /\.xlsx$/i.test(selected.name)) worksheets.mutate(selected);
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title={`Import ${labels[kind]}`}
        subtitle="Preview new records, review exceptions and confirm eligible rows. Existing records are never updated."
      />
      <Panel title="Choose file">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => download.mutate('template')}>
            Download template
          </Button>
          <input
            type="file"
            accept=".csv,.xlsx"
            aria-label="Import file"
            disabled={busy}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
          {file && /\.xlsx$/i.test(file.name) && (
            <label className="text-sm">
              Worksheet{' '}
              <select
                aria-label="Worksheet"
                className="rounded border bg-background p-2"
                value={worksheet}
                disabled={busy}
                onChange={(event) => {
                  setWorksheet(event.target.value);
                  setPlan(null);
                  setResult(null);
                  setError('');
                }}
              >
                <option value="">Select worksheet</option>
                {sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            disabled={!ready || busy}
            loading={preview.isPending}
            onClick={() => {
              setPlan(null);
              setResult(null);
              setError('');
              preview.mutate();
            }}
          >
            Preview
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {kind === 'seasons'
            ? 'Season Code + Financial Year identifies a Season. Financial Year must exist. Blank Barcode Serial stays NULL; automatic Style barcodes may require it.'
            : kind === 'sizes'
              ? 'Supply the original Size Code, label, valid Size Type and integer Sort Order. Existing metadata is never changed.'
              : kind === 'hsns'
                ? 'Store HSN Code as text with exactly 8 digits, preserving leading zeroes. GST Rule Set assignment is outside this import.'
                : 'Internal codes are generated automatically. Missing Purchase Modes and uncertain Distributor matches require review.'}{' '}
          Files may contain up to 10,000 rows.
        </p>
        {worksheets.isPending && <p role="status">Reading worksheets…</p>}
      </Panel>
      {error && <ErrorState title="Import request failed" description={error} />}
      {plan && (
        <Panel title="Preview">
          <p className="mb-3 text-sm">
            {plan.summary.CREATE} new records; {plan.summary.SKIP_EXISTING} existing;{' '}
            {plan.summary.NEEDS_REVIEW} need review; {plan.summary.REJECTED} rejected.
          </p>
          <ImportRows key={plan.confirmationToken} kind={kind} rows={plan.rows} />
          <div className="mt-3 flex gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => download.mutate('preview')}>
              Download exceptions
            </Button>
            <Button
              disabled={busy || Boolean(result) || !plan.rows.length}
              loading={execute.isPending}
              onClick={() => {
                setError('');
                execute.mutate();
              }}
            >
              Confirm import
            </Button>
          </div>
        </Panel>
      )}
      {result && (
        <Panel title="Results">
          <p className="mb-3 text-sm">
            {result.summary.CREATE} created; {result.summary.SKIP_EXISTING} skipped;{' '}
            {result.summary.NEEDS_REVIEW} need review; {result.summary.REJECTED} rejected;{' '}
            {result.summary.FAILED} failed.
          </p>
          <ImportRows key={result.runId} kind={kind} rows={result.rows} />
        </Panel>
      )}
      <Panel title="Import history">
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && (
          <ErrorState
            title="Unable to load history"
            description={getApiErrorMessage(history.error, 'Try refreshing history.')}
          />
        )}
        <Button
          variant="secondary"
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          Refresh history
        </Button>
        <DataTable<MasterImportHistoryEntry>
          data={history.data ?? []}
          rowKey={(run) => run.id}
          columns={[
            { key: 'file', header: 'Source file', accessor: 'sourceFileName' },
            {
              key: 'date',
              header: 'Imported',
              render: (run) => new Date(run.createdAt).toLocaleString(),
            },
            { key: 'status', header: 'Status', accessor: 'status' },
            {
              key: 'view',
              header: 'Details',
              render: (run) => (
                <Button variant="secondary" onClick={() => setSelectedRun(run.id)}>
                  View run
                </Button>
              ),
            },
          ]}
        />
        {selectedRun && (
          <div className="mt-3 space-y-3">
            {detail.isPending && <p role="status">Loading run…</p>}
            {detail.isError && (
              <ErrorState
                title="Unable to load run"
                description={getApiErrorMessage(detail.error, 'Choose the run again.')}
              />
            )}
            {detail.data && (
              <>
                <ImportRows
                  key={selectedRun}
                  kind={kind}
                  rows={detail.data.rows.map((row) => row.payload)}
                />
                <Button variant="secondary" disabled={busy} onClick={() => download.mutate('run')}>
                  Download run exceptions
                </Button>
              </>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
