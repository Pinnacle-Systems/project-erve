/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
import { SizeListPage } from './SizeListPage.js';
import type { Size } from './types.js';

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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Clicking a PDF action triggers a dynamic import() of the PDF generation code (kept out of the
// eager bundle), which takes an unpredictable number of extra ticks beyond a single
// flushMicrotasks() to settle — poll instead (see StyleListPage.test.tsx).
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function makeSize(overrides: Partial<Size> = {}): Size {
  return {
    id: 'size-1',
    code: 'AGE_3',
    label: '3 years',
    sizeType: 'AGE',
    sortOrder: 3,
    status: 'ACTIVE',
    ...overrides,
  };
}

async function renderPageWithSizes(sizes: Size[]) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/sizes') return { data: { data: sizes } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <SizeListPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('SizeListPage PDF actions', () => {
  it('shows Download PDF and Print actions above the table', async () => {
    await renderPageWithSizes([]);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPageWithSizes([makeSize()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.find((b) => b.textContent === 'Print')!.disabled).toBe(false);
    expect(buttons.find((b) => b.textContent === 'Download PDF')!.disabled).toBe(false);
  });

  it('downloads the size list PDF under the expected filename', async () => {
    await renderPageWithSizes([makeSize()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy.mock.calls[0]![1]).toMatch(/^ERVE-Sizes-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    await renderPageWithSizes([makeSize()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const printSpy = vi.spyOn(printModule, 'printPdfBlob').mockImplementation(() => {});
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => printSpy.mock.calls.length > 0);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});
