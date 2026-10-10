/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { StyleBulkImportPage } from './StyleBulkImportPage.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <StyleBulkImportPage />
      </QueryClientProvider>,
    );
  });
}

function selectFile(): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['fake xlsx bytes'], 'styles.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const preflightResponse = {
  data: {
    data: {
      sourceFileChecksum: 'abc123',
      summary: { totalRows: 2, create: 1, skipExisting: 1, resumeImagePending: 0, rejected: 0, fileLevelImageWarnings: 0 },
      rows: [
        { rowNumber: 2, styleNumber: 'ST-NEW', status: 'CREATE', imageCount: 1 },
        { rowNumber: 3, styleNumber: 'ST-OLD', status: 'SKIP_EXISTING', imageCount: 0, detail: 'A Style with this Style Number already exists' },
      ],
      fileLevelImageWarnings: [],
    },
  },
};

const executeResponse = {
  data: {
    data: {
      runId: 'run-1',
      results: [
        { rowNumber: 2, styleNumber: 'ST-NEW', outcome: 'COMPLETED', styleId: 'style-1' },
        { rowNumber: 3, styleNumber: 'ST-OLD', outcome: 'SKIPPED_EXISTING' },
      ],
    },
  },
};

describe('StyleBulkImportPage', () => {
  it('enables Preview only once a file is chosen, then shows the preflight summary and per-row table', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue(preflightResponse);
    render();

    const previewButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Preview') as HTMLButtonElement;
    expect(previewButton().disabled).toBe(true);

    act(() => selectFile());
    expect(previewButton().disabled).toBe(false);

    act(() => previewButton().click());
    await flush();

    expect(postSpy).toHaveBeenCalledWith('/styles/bulk-import/preflight', expect.any(FormData));
    expect(container.textContent).toContain('ST-NEW');
    expect(container.textContent).toContain('ST-OLD');
    expect(container.textContent).toContain('already exists');
  });

  it('confirming import calls execute with the same file and renders outcomes', async () => {
    vi.spyOn(apiClient, 'post').mockImplementation((url: string) =>
      url.endsWith('/preflight') ? Promise.resolve(preflightResponse) : Promise.resolve(executeResponse),
    );
    render();

    act(() => selectFile());
    const previewButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Preview') as HTMLButtonElement;
    act(() => previewButton.click());
    await flush();

    const confirmButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Confirm')) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    act(() => confirmButton.click());
    await flush();

    expect(container.textContent).toContain('COMPLETED');
    expect(container.textContent).toContain('SKIPPED EXISTING');
  });

  it('disables Confirm & Import when nothing in the file is actionable', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        data: {
          sourceFileChecksum: 'abc',
          summary: { totalRows: 1, create: 0, skipExisting: 0, resumeImagePending: 0, rejected: 1, fileLevelImageWarnings: 0 },
          rows: [{ rowNumber: 2, styleNumber: 'ST-BAD', status: 'REJECTED', reason: 'UNKNOWN_SEASON', imageCount: 0 }],
          fileLevelImageWarnings: [],
        },
      },
    });
    render();
    act(() => selectFile());
    const previewButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Preview') as HTMLButtonElement;
    act(() => previewButton.click());
    await flush();

    const confirmButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Confirm')) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(container.textContent).toContain('Nothing in this file is ready to import');
  });
});
