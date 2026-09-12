/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
import { PriceListListPage } from './PriceListListPage.js';
import type { PriceListSummary } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const user: AuthUser = {
    id: 'admin-1',
    email: 'admin@test.local',
    mobile: null,
    name: 'Admin',
    roles: ['ADMIN'],
  };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly (see UserPages.test.tsx).
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function priceListSearchCalls(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/price-lists')
    .map((call) => (call[1] as { params?: { search?: string } } | undefined)?.params?.search);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function makePriceList(overrides: Partial<PriceListSummary> = {}): PriceListSummary {
  return {
    id: 'pl-1',
    code: 'PL-2026-000001',
    name: 'FY 2026 Prices',
    distributor: { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    lineCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

async function renderPage(priceLists: PriceListSummary[] = []) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/distributors') {
      return { data: { data: [{ id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' }] } };
    }
    if (url === '/price-lists') return { data: { data: priceLists } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PriceListListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('PriceListListPage search debounce', () => {
  it('debounces the price list search so rapid typing issues only the final request', async () => {
    await renderPage();

    const requestsBeforeTyping = priceListSearchCalls().length;
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search code or name"]',
    )!;

    vi.useFakeTimers();
    for (const value of ['P', 'PL', 'PL-', 'PL-001']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(priceListSearchCalls().length).toBe(requestsBeforeTyping);
    expect(input.value).toBe('PL-001');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    const searches = priceListSearchCalls();
    expect(searches.length).toBe(requestsBeforeTyping + 1);
    expect(searches.at(-1)).toBe('PL-001');
  });
});

describe('PriceListListPage PDF actions', () => {
  it('shows Download PDF and Print actions above the table', async () => {
    await renderPage([]);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPage([makePriceList()]);
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

  it('downloads the price list PDF under the expected filename', async () => {
    await renderPage([makePriceList()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy.mock.calls[0]![1]).toMatch(/^ERVE-Price-Lists-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    await renderPage([makePriceList()]);
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

  it('still generates successfully after the search filter changes', async () => {
    await renderPage([makePriceList()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search code or name"]')!;
    vi.useFakeTimers();
    act(() => setInputValue(input, 'PL-2026'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();
    await act(async () => {
      await flushMicrotasks();
    });

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });
});
