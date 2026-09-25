/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { PriceListFormPage } from './PriceListFormPage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number, message: string): never {
  const error = new Error(message) as Error & { response: unknown; isAxiosError: boolean };
  error.isAxiosError = true;
  error.response = { status, data: { error: { message } }, statusText: '', headers: {}, config };
  throw error;
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Polls with real timers — the lookup debounces (300 ms) before searching.
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function selectOptionEls(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

function lookupPanelText(): string {
  return document.body.querySelector('[data-lookup-panel]')?.textContent ?? '';
}

async function typeDistributorSearch(text: string): Promise<void> {
  const input = document.getElementById('lookup-distributor-*') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function renderCreatePage(
  requestedUrls: string[] = [],
  requestedParams: unknown[] = [],
): Promise<void> {
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    requestedUrls.push(config.url ?? '');
    requestedParams.push(config.params);
    if (config.url === '/price-lists/distributor-options') {
      return ok(config, {
        success: true,
        data: [
          { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
          { id: 'dist-2', code: 'DIST-2', name: 'Bravo Traders', status: 'ACTIVE' },
        ],
      });
    }
    // The broad master endpoint must never be called from this page — ACCOUNTANT
    // (and other Price-List-capable roles) are denied on it.
    if (config.url === '/distributors') {
      fail(config, 403, 'Forbidden');
    }
    throw new Error(`Unexpected request: ${config.url}`);
  }) satisfies AxiosAdapter;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/price-lists/new']}>
        <ThemeProvider theme="default" density="comfortable">
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/price-lists/new" element={<PriceListFormPage />} />
            </Routes>
          </QueryClientProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('PriceListFormPage create — distributor lookup (UXAUTH-013, P1L8)', () => {
  it('searches the Price-List-specific lookup (bounded, ACTIVE only) and allows a selection', async () => {
    const requestedUrls: string[] = [];
    const requestedParams: unknown[] = [];
    await renderCreatePage(requestedUrls, requestedParams);
    // No option list is preloaded.
    expect(requestedUrls).not.toContain('/price-lists/distributor-options');

    await typeDistributorSearch('tra');
    await waitFor(
      () =>
        selectOptionEls().length > 0 && document.body.querySelector('[role="listbox"][aria-busy]') === null,
    );
    const labels = selectOptionEls().map((el) => el.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Acme DistributorsDIST-1', 'Bravo TradersDIST-2']));
    expect(requestedParams[requestedUrls.indexOf('/price-lists/distributor-options')]).toEqual({
      status: 'ACTIVE',
      search: 'tra',
      limit: 20,
    });

    const target = selectOptionEls().find((el) => el.textContent?.includes('Bravo Traders'))!;
    await act(async () => target.click());

    expect((document.getElementById('lookup-distributor-*') as HTMLInputElement).value).toBe('Bravo Traders');
    expect(requestedUrls).not.toContain('/distributors');
  });

  it('shows a truthful lookup error instead of an empty Distributor selector when the lookup fails', async () => {
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/price-lists/distributor-options') {
        fail(config, 500, 'Unable to load distributors');
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/price-lists/new']}>
          <ThemeProvider theme="default" density="comfortable">
            <QueryClientProvider client={queryClient}>
              <Routes>
                <Route path="/price-lists/new" element={<PriceListFormPage />} />
              </Routes>
            </QueryClientProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await waitFor(() => document.getElementById('lookup-distributor-*') !== null);
    await typeDistributorSearch('acme');
    await waitFor(() => lookupPanelText().includes('Unable to load distributors'));
  });
});
