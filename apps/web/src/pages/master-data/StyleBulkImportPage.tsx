import { useRef, useState } from 'react';
import { ImportFilePicker } from '../../components/import/ImportFilePicker.js';
import { useMutation } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge, type StatusBadgeTone } from '@erve/app-components';
import { Button } from '@erve/primitives';
import { DataTable, ErrorState } from '@erve/data-display';
import { Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';

interface PreflightRow {
  rowNumber: number;
  styleNumber: string;
  status: 'CREATE' | 'SKIP_EXISTING' | 'RESUME_IMAGE_PENDING' | 'REJECTED';
  reason?: string;
  detail?: string;
  imageCount: number;
}

interface PreflightResponse {
  sourceFileChecksum: string;
  worksheet?: string;
  confirmationToken?: string;
  summary: {
    totalRows: number;
    create: number;
    skipExisting: number;
    resumeImagePending: number;
    rejected: number;
    fileLevelImageWarnings: number;
  };
  rows: PreflightRow[];
  fileLevelImageWarnings: Array<{ reason: string; detail: string }>;
}

interface ExecuteRow {
  rowNumber: number;
  styleNumber: string;
  outcome: 'COMPLETED' | 'SKIPPED_EXISTING' | 'IMAGE_PENDING' | 'FAILED';
  styleId?: string;
  detail?: string;
}

interface ExecuteResponse {
  runId: string;
  results: ExecuteRow[];
}

const STATUS_TONE: Record<PreflightRow['status'], StatusBadgeTone> = {
  CREATE: 'success',
  SKIP_EXISTING: 'muted',
  RESUME_IMAGE_PENDING: 'warning',
  REJECTED: 'danger',
};

const OUTCOME_TONE: Record<ExecuteRow['outcome'], StatusBadgeTone> = {
  COMPLETED: 'success',
  SKIPPED_EXISTING: 'muted',
  IMAGE_PENDING: 'warning',
  FAILED: 'danger',
};

/**
 * Upload -> preflight preview -> confirm -> execute -> results. The same
 * file is sent to both /preflight and /execute (never a client-held plan)
 * so execute always reflects current server state at the moment it runs.
 */
export function StyleBulkImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [results, setResults] = useState<ExecuteResponse | null>(null);
  const [worksheet, setWorksheet] = useState('');
  const [worksheets, setWorksheets] = useState<string[]>([]);
  const currentSelection = useRef({ file: null as File | null, worksheet: '' });
  const sheetsMutation = useMutation({
    mutationFn: async (selected: File) => {
      const body = new FormData();
      body.append('file', selected);
      return (await apiClient.post<ApiSuccessResponse<string[]>>('/styles/bulk-import/worksheets', body)).data.data;
    },
    onSuccess: (names, selected) => {
      if (currentSelection.current.file !== selected || !Array.isArray(names)) return;
      setWorksheets(names);
      setWorksheet(names[0] ?? '');
      currentSelection.current.worksheet = names[0] ?? '';
      setPreflight(null);
    },
  });
  const historyMutation = useMutation({
    mutationFn: async () => (await apiClient.get<ApiSuccessResponse<Array<{ id: string; sourceFileName: string; createdAt: string; totalRows: number }>>>('/styles/bulk-import/history')).data.data,
  });
  const downloadMutation = useMutation({
    mutationFn: async ({ path, name, upload }: { path: string; name: string; upload?: FormData }) => {
      const response = upload ? await apiClient.post<Blob>(path, upload, { responseType: 'blob' }) : await apiClient.get<Blob>(path, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.click();
      URL.revokeObjectURL(url);
    },
  });
  const downloadExceptions = () => {
    if (!file) return;
    const upload = new FormData();
    upload.append('file', file); upload.append('worksheet', worksheet);
    downloadMutation.mutate({ path: '/styles/bulk-import/exceptions', name: 'style-import-exceptions.xlsx', upload });
  };

  const preflightMutation = useMutation({
    mutationFn: async ({ selected, sheet }: { selected: File; sheet: string }) => {
      const body = new FormData();
      body.append('file', selected);
      body.append('worksheet', sheet);
      const response = await apiClient.post<ApiSuccessResponse<PreflightResponse>>('/styles/bulk-import/preflight', body);
      return response.data.data;
    },
    onSuccess: (data, selection) => {
      if (selection.selected !== currentSelection.current.file || selection.sheet !== currentSelection.current.worksheet) return;
      setPreflight(data);
      setResults(null);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async ({ selected, sheet }: { selected: File; sheet: string }) => {
      const body = new FormData();
      body.append('file', selected);
      body.append('worksheet', preflight?.worksheet ?? sheet);
      body.append('sourceFileChecksum', preflight?.sourceFileChecksum ?? '');
      body.append('confirmationToken', preflight?.confirmationToken ?? '');
      const response = await apiClient.post<ApiSuccessResponse<ExecuteResponse>>('/styles/bulk-import/execute', body);
      return response.data.data;
    },
    onSuccess: (data, selection) => {
      if (selection.selected === currentSelection.current.file && selection.sheet === currentSelection.current.worksheet) {
        setResults(data); setPreflight(null);
      }
    },
  });

  const handleFileChange = (selected: File | null) => {
    // New selections must never reuse a prior workbook's worksheet readiness or errors.
    sheetsMutation.reset();
    preflightMutation.reset();
    setFile(selected);
    currentSelection.current = { file: selected, worksheet: '' };
    setWorksheet(''); setWorksheets([]);
    setPreflight(null);
    setResults(null);
    if (selected) sheetsMutation.mutate(selected);
  };

  // Workbook inspection uploads the chosen file to discover worksheets.
  // Only that same file's successful response makes the Preview action safe.
  const workbookReady = Boolean(
    file && sheetsMutation.isSuccess && sheetsMutation.variables === file,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk Import Styles"
        subtitle="Create-only — existing Styles are never modified. Embedded PNG and JPEG pictures are attached as PNG images."
      />

      <Panel title="1. Choose workbook">
        <Button type="button" onClick={() => downloadMutation.mutate({ path: '/styles/bulk-import/template', name: 'styles.xlsx' })}>Download template</Button>
        <div className="flex items-center gap-3">
          <ImportFilePicker
            accept=".xlsx"
            ariaLabel="Workbook file"
            file={file}
            onSelect={handleFileChange}
          />
          <Button
            type="button"
            disabled={!workbookReady || preflightMutation.isPending || executeMutation.isPending}
            loading={preflightMutation.isPending}
            onClick={() => {
              if (file && workbookReady && !preflightMutation.isPending && !executeMutation.isPending) {
                preflightMutation.mutate({ selected: file, sheet: worksheet });
              }
            }}
          >
            Preview
          </Button>
        </div>
        <label className="mt-3 block text-sm">
          Worksheet
          <select
            aria-label="Worksheet"
            value={worksheet}
            disabled={!workbookReady || preflightMutation.isPending || executeMutation.isPending}
            onChange={(event) => {
            setWorksheet(event.target.value); currentSelection.current.worksheet = event.target.value; setPreflight(null); setResults(null);
          }}>
            {worksheets.length === 0 && <option value="">First worksheet</option>}
            {worksheets.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          Download the Excel template and refer to the Instructions tab for field descriptions, example values, and
          import guidelines. Enter your data in the first worksheet and upload the completed file. Files may be up
          to 25 MB.
        </p>
        {file && sheetsMutation.isPending && (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            Reading workbook worksheets… Preview will be available when this completes.
          </p>
        )}
        {preflightMutation.isError && (
          <ErrorState title="Could not preview this file" description={(preflightMutation.error as Error).message} />
        )}
        {sheetsMutation.isError && <ErrorState title="Could not read worksheets" description={(sheetsMutation.error as Error).message} />}
        {downloadMutation.isError && <ErrorState title="Download failed" description={(downloadMutation.error as Error).message} />}
      </Panel>

      {preflight && (
        <Panel title="2. Review and confirm">
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span>
              <strong>{preflight.summary.create}</strong> to create
            </span>
            <span>
              <strong>{preflight.summary.resumeImagePending}</strong> resumable (image pending from a prior run)
            </span>
            <span>
              <strong>{preflight.summary.skipExisting}</strong> already exist — will be skipped
            </span>
            <span>
              <strong>{preflight.summary.rejected}</strong> rejected
            </span>
          </div>

          {preflight.fileLevelImageWarnings.length > 0 && (
            <div className="mb-3 rounded-control border border-[var(--erp-form-field-error-border)] p-3 text-sm">
              <p className="font-medium">
                {preflight.fileLevelImageWarnings.length} embedded image(s) could not be attributed to any row and will
                not be attached to any Style:
              </p>
              <ul className="ml-4 list-disc">
                {preflight.fileLevelImageWarnings.map((warning, index) => (
                  <li key={index}>{warning.detail}</li>
                ))}
              </ul>
            </div>
          )}

          <DataTable
            columns={[
              { key: 'rowNumber', header: 'Row', accessor: 'rowNumber', width: '64px' },
              { key: 'styleNumber', header: 'Style Number', accessor: 'styleNumber' },
              {
                key: 'status',
                header: 'Status',
                render: (row) => <StatusBadge label={row.status.replace(/_/g, ' ')} tone={STATUS_TONE[row.status]} />,
              },
              { key: 'imageCount', header: 'Images', accessor: 'imageCount', align: 'right', width: '72px' },
              { key: 'detail', header: 'Detail', render: (row) => row.detail ?? row.reason ?? '' },
            ]}
            data={preflight.rows}
            rowKey="rowNumber"
            density="compact"
          />

          <div className="mt-4 flex items-center gap-3">
            <Button type="button" onClick={downloadExceptions}>Download exceptions</Button>
            <Button
              type="button"
              disabled={!file || executeMutation.isPending || preflight.summary.create + preflight.summary.resumeImagePending === 0}
              loading={executeMutation.isPending}
              onClick={() => file && executeMutation.mutate({ selected: file, sheet: worksheet })}
            >
              Confirm &amp; Import
            </Button>
            {preflight.summary.create + preflight.summary.resumeImagePending === 0 && (
              <span className="text-sm text-muted-foreground">Nothing in this file is ready to import.</span>
            )}
          </div>
          {executeMutation.isError && (
            <ErrorState title="Import failed" description={(executeMutation.error as Error).message} />
          )}
        </Panel>
      )}

      {results && (
        <Panel title="3. Results">
          <Button type="button" onClick={() => downloadMutation.mutate({ path: `/styles/bulk-import/history/${results.runId}/report`, name: 'style-import-results.csv' })}>Download report</Button>
          <DataTable
            columns={[
              { key: 'rowNumber', header: 'Row', accessor: 'rowNumber', width: '64px' },
              { key: 'styleNumber', header: 'Style Number', accessor: 'styleNumber' },
              {
                key: 'outcome',
                header: 'Outcome',
                render: (row) => <StatusBadge label={row.outcome.replace(/_/g, ' ')} tone={OUTCOME_TONE[row.outcome]} />,
              },
              { key: 'detail', header: 'Detail', render: (row) => row.detail ?? '' },
            ]}
            data={results.results}
            rowKey="rowNumber"
            density="compact"
          />
          {results.results.some((row) => row.outcome === 'IMAGE_PENDING') && (
            <p className="mt-3 text-sm text-muted-foreground">
              Rows marked &quot;IMAGE PENDING&quot; were created but their image did not finish attaching — re-upload
              the same file to safely retry just those rows.
            </p>
          )}
        </Panel>
      )}
      <Panel title="Execution history">
        <Button type="button" loading={historyMutation.isPending} onClick={() => historyMutation.mutate()}>Load history</Button>
        {historyMutation.isError && <ErrorState title="Could not load history" description={(historyMutation.error as Error).message} />}
        {historyMutation.data?.map((run) => <div key={run.id} className="mt-2 flex items-center gap-3 text-sm">
          <span>{run.sourceFileName} · {new Date(run.createdAt).toLocaleString()} · {run.totalRows} rows</span>
          <Button type="button" onClick={() => downloadMutation.mutate({ path: `/styles/bulk-import/history/${run.id}/report`, name: 'style-import-results.csv' })}>Download report</Button>
        </div>)}
      </Panel>
    </div>
  );
}
