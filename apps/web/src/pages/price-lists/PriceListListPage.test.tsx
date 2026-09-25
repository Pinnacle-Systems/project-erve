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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
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
  vi.unstubAllGlobals();
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
    if (url === '/price-lists/distributor-options') {
      return { data: { data: [{ id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' }] } };
    }
    if (url === '/price-lists') return { data: { data: { items: priceLists, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
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

function mockAuthUser(roles: AuthUser['roles']): AuthUser {
  return { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles };
}

function stubAuth(user: AuthUser): void {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function distributorFilter(): HTMLInputElement {
  return document.getElementById('price-list-distributor-filter') as HTMLInputElement;
}

async function searchDistributorFilter(text: string): Promise<void> {
  await act(async () => {
    distributorFilter().focus();
    setInputValue(distributorFilter(), text);
  });
}

function renderWith(getImpl: (url: string) => Promise<unknown>) {
  vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PriceListListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

function priceListDistributorFilters(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/price-lists')
    .map((call) => (call[1] as { params?: { distributorId?: string } } | undefined)?.params?.distributorId);
}

describe('PriceListListPage — ACCOUNTANT distributor lookup (UXAUTH-013, P1L8)', () => {
  it('searches the Price-List-specific lookup, not the broad master, and filters by the pick', async () => {
    stubAuth(mockAuthUser(['ACCOUNTANT']));
    await renderPage([makePriceList()]);

    const calls = () => vi.mocked(apiClient.get).mock.calls;
    // Nothing is preloaded for the filter.
    expect(calls().some((call) => call[0] === '/price-lists/distributor-options')).toBe(false);

    await searchDistributorFilter('acme');
    await waitUntil(() => document.body.querySelectorAll('[role="option"]').length > 0);
    expect(calls().find((call) => call[0] === '/price-lists/distributor-options')?.[1]).toMatchObject({
      params: { search: 'acme', limit: 20 },
    });
    expect(calls().some((call) => call[0] === '/distributors')).toBe(false);

    await act(async () => document.body.querySelector<HTMLElement>('[role="option"]')!.click());
    await waitUntil(() => priceListDistributorFilters().at(-1) === 'dist-1');

    const clearFilters = Array.from(container.querySelectorAll('button')).find((button) =>
      /clear/i.test(button.textContent ?? ''),
    )!;
    await act(async () => clearFilters.click());
    await waitUntil(() => priceListDistributorFilters().at(-1) === undefined);
    expect(distributorFilter().value).toBe('');
  });

  it('shows a truthful error in the lookup when the search fails for ACCOUNTANT', async () => {
    stubAuth(mockAuthUser(['ACCOUNTANT']));
    renderWith(async (url: string) => {
      if (url === '/price-lists/distributor-options') {
        const error = new Error('Forbidden') as Error & { isAxiosError: boolean; response: unknown };
        error.isAxiosError = true;
        error.response = { status: 403, data: { error: { message: 'Forbidden' } } };
        throw error;
      }
      if (url === '/price-lists') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      throw new Error(`Unexpected request: ${url}`);
    });
    await waitUntil(() => distributorFilter() !== null);

    await searchDistributorFilter('acme');
    await waitUntil(
      () => document.body.querySelector('[data-lookup-panel]')?.textContent?.includes('Forbidden') ?? false,
    );
  });

  it('sends no status filter so an inactive distributor stays filterable', async () => {
    stubAuth(mockAuthUser(['ACCOUNTANT']));
    renderWith(async (url: string) => {
      if (url === '/price-lists/distributor-options') {
        return {
          data: {
            data: [
              { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
              { id: 'dist-2', code: 'DIST-2', name: 'Old Traders', status: 'INACTIVE' },
            ],
          },
        };
      }
      if (url === '/price-lists') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      throw new Error(`Unexpected request: ${url}`);
    });
    await waitUntil(() => distributorFilter() !== null);

    // The list-page filter browses historical Price Lists, so it must not
    // scope itself to ACTIVE-only the way the create form does — a Price
    // List belonging to a now-inactive Distributor would otherwise become
    // impossible to filter by.
    await searchDistributorFilter('tra');
    await waitUntil(() => document.body.querySelectorAll('[role="option"]').length > 0);
    const optionCall = vi
      .mocked(apiClient.get)
      .mock.calls.find((call) => call[0] === '/price-lists/distributor-options');
    expect(optionCall?.[1]).toMatchObject({ params: { search: 'tra', limit: 20 } });
    expect((optionCall?.[1] as { params: Record<string, unknown> }).params).not.toHaveProperty('status');

    const options = Array.from(document.body.querySelectorAll('[role="option"]')).map((el) =>
      el.textContent?.trim(),
    );
    expect(options).toContain('Acme DistributorsDIST-1');
    expect(options).toContain('Old TradersDIST-2(inactive)');
  });
});

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
