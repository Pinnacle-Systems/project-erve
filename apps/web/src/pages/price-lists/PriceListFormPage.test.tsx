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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function triggerByLabel(labelText: string): HTMLButtonElement {
  const label = Array.from(container.querySelectorAll('label')).find((el) =>
    el.textContent?.startsWith(labelText),
  );
  if (!label) throw new Error(`Label "${labelText}" not found`);
  const id = label.getAttribute('for');
  const el = id ? (document.getElementById(id) as HTMLButtonElement | null) : null;
  if (!el) throw new Error(`Trigger for label "${labelText}" not found`);
  return el;
}

function selectOptionEls(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

async function renderCreatePage(requestedUrls: string[] = []): Promise<void> {
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    requestedUrls.push(config.url ?? '');
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

describe('PriceListFormPage create — distributor lookup (UXAUTH-013)', () => {
  it('populates the Distributor selector via the Price-List-specific lookup and allows a selection', async () => {
    const requestedUrls: string[] = [];
    await renderCreatePage(requestedUrls);

    await act(async () => triggerByLabel('Distributor *').click());
    await waitFor(() => selectOptionEls().length > 0);
    const labels = selectOptionEls().map((el) => el.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Acme Distributors', 'Bravo Traders']));

    const target = selectOptionEls().find((el) => el.textContent?.trim() === 'Bravo Traders')!;
    await act(async () => target.click());

    expect(requestedUrls).toContain('/price-lists/distributor-options');
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
    await waitFor(() => container.textContent?.includes('Unable to load distributors') ?? false);

    expect(container.textContent).toContain('Unable to load distributors');
  });
});
