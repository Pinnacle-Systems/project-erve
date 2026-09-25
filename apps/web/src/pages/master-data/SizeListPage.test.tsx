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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// jsdom does not implement CSS.escape, and the ids this app derives from
// labels can contain "*" (e.g. "Code *" -> "field-code-*") — escape manually.
function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function findInput(label: string): HTMLInputElement {
  const labelEl = Array.from(container.querySelectorAll('label')).find(
    (el) => el.textContent === label,
  );
  if (!labelEl) throw new Error(`Label "${label}" not found`);
  const forId = labelEl.getAttribute('for');
  const input = forId ? container.querySelector<HTMLInputElement>(`#${cssEscapeId(forId)}`) : null;
  if (!input) throw new Error(`Input for label "${label}" not found`);
  return input;
}

// Clicking a PDF action triggers a dynamic import() of the PDF generation code (kept out of the
// eager bundle), which takes an unpredictable number of extra ticks beyond a single
// flushMicrotasks() to settle — poll instead (see StyleListPage.test.tsx).
// Time-based rather than a fixed tick count: the list PDF first fetches every
// page and then dynamically imports the PDF module, which can exceed a few
// macrotask ticks when the suite runs under load.
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await act(async () => {
      await flushMicrotasks();
    });
  }
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
    if (url === '/sizes') return { data: { data: { items: sizes, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
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

describe('SizeListPage inline Create', () => {
  it('successfully creates a Size and clears the form', async () => {
    await renderPageWithSizes([]);
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: { id: 'size-2' } } });

    setInputValue(findInput('Code *'), 'AGE_4');
    setInputValue(findInput('Label *'), '4 years');
    setInputValue(findInput('Sort Order *'), '4');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add',
    );
    await act(async () => submit!.click());
    await act(async () => {
      await flushMicrotasks();
    });

    expect(postSpy).toHaveBeenCalledWith(
      '/sizes',
      expect.objectContaining({ code: 'AGE_4', label: '4 years', sortOrder: 4 }),
    );
    expect(findInput('Code *').value).toBe('');
    expect(findInput('Label *').value).toBe('');
    expect(findInput('Sort Order *').value).toBe('');
  });

  it('a duplicate/error create surfaces a visible error instead of failing silently', async () => {
    await renderPageWithSizes([]);
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      Object.assign(new Error('A size with this code already exists'), {
        isAxiosError: true,
        response: { data: { error: { message: 'A size with this code already exists' } } },
      }),
    );

    setInputValue(findInput('Code *'), 'AGE_3');
    setInputValue(findInput('Label *'), '3 years');
    setInputValue(findInput('Sort Order *'), '3');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add',
    );
    await act(async () => submit!.click());
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('A size with this code already exists');
  });

  it('a failed create preserves the entered input instead of clearing the form', async () => {
    await renderPageWithSizes([]);
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('boom'));

    setInputValue(findInput('Code *'), 'AGE_5');
    setInputValue(findInput('Label *'), '5 years');
    setInputValue(findInput('Sort Order *'), '5');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add',
    );
    await act(async () => submit!.click());
    await act(async () => {
      await flushMicrotasks();
    });

    expect(findInput('Code *').value).toBe('AGE_5');
    expect(findInput('Label *').value).toBe('5 years');
    expect(findInput('Sort Order *').value).toBe('5');
  });

  it('shows a required-field error and does not call the API when submitted blank', async () => {
    await renderPageWithSizes([]);
    const postSpy = vi.spyOn(apiClient, 'post');

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add',
    );
    await act(async () => submit!.click());
    await act(async () => {
      await flushMicrotasks();
    });

    expect(postSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Code, label, and sort order are required');
    expect(findInput('Code *').getAttribute('aria-invalid')).toBe('true');
  });
});
