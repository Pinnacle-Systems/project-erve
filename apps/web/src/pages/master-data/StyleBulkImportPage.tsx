import { useState } from 'react';
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

  const preflightMutation = useMutation({
    mutationFn: async (selected: File) => {
      const body = new FormData();
      body.append('file', selected);
      const response = await apiClient.post<ApiSuccessResponse<PreflightResponse>>('/styles/bulk-import/preflight', body);
      return response.data.data;
    },
    onSuccess: (data) => {
      setPreflight(data);
      setResults(null);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (selected: File) => {
      const body = new FormData();
      body.append('file', selected);
      const response = await apiClient.post<ApiSuccessResponse<ExecuteResponse>>('/styles/bulk-import/execute', body);
      return response.data.data;
    },
    onSuccess: (data) => setResults(data),
  });

  const handleFileChange = (selected: File | null) => {
    setFile(selected);
    setPreflight(null);
    setResults(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk Import Styles"
        subtitle="Create-only — existing Styles are never modified. PNG images embedded in the workbook are attached automatically."
      />

      <Panel title="1. Choose workbook">
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx"
            aria-label="Workbook file"
            onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            disabled={!file || preflightMutation.isPending}
            loading={preflightMutation.isPending}
            onClick={() => file && preflightMutation.mutate(file)}
          >
            Preview
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Required columns: Style Number, Style Name, Final MRP, Season Code, Size Codes. Optional: LMIX Number
          (needed only if any Barcode is left blank, for auto-generation), HSN Code (leave blank if not yet known —
          the Style is still created, HSN can be added later), Barcodes (parallel to Size Codes — blank generates),
          Factory Mappings (&quot;CODE:PRICE;CODE:PRICE&quot;). Primary Style images are PNGs embedded directly in the
          workbook, anchored to their Style&apos;s row.
        </p>
        {preflightMutation.isError && (
          <ErrorState title="Could not preview this file" description={(preflightMutation.error as Error).message} />
        )}
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
            <Button
              type="button"
              disabled={!file || executeMutation.isPending || preflight.summary.create + preflight.summary.resumeImagePending === 0}
              loading={executeMutation.isPending}
              onClick={() => file && executeMutation.mutate(file)}
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
    </div>
  );
}
