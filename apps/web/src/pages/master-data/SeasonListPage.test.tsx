/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { SeasonListPage } from './SeasonListPage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number, message: string): never {
  const error = new Error(message) as Error & { response: unknown; isAxiosError: boolean };
  error.isAxiosError = true;
  error.response = { status, data: { error: { message } }, statusText: '', headers: {}, config };
  throw error;
}

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly.
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const financialYears = [
  { id: 'fy-2025-26', code: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31' },
  { id: 'fy-2026-27', code: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
  { id: 'fy-2027-28', code: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' },
];
const currentFinancialYear = financialYears[1]!;

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let seasons: unknown[];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  seasons = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function trigger(id: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`#${id}`);
  if (!el) throw new Error(`Trigger #${id} not found`);
  return el;
}

async function selectOption(triggerId: string, optionText: string): Promise<void> {
  await act(async () => trigger(triggerId).click());
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`Option "${optionText}" not found`);
  await act(async () => option.click());
}

interface AdapterOverrides {
  financialYears?: AxiosAdapter;
  current?: AxiosAdapter;
  createSeason?: AxiosAdapter;
}

function baseAdapter(overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/financial-years') {
      return overrides.financialYears
        ? overrides.financialYears(config)
        : ok(config, { success: true, data: financialYears });
    }
    if (config.url === '/financial-years/current') {
      return overrides.current ? overrides.current(config) : ok(config, { success: true, data: currentFinancialYear });
    }
    if (config.url === '/seasons' && config.method === 'get') {
      return ok(config, { success: true, data: seasons });
    }
    if (config.url === '/seasons' && config.method === 'post') {
      return overrides.createSeason
        ? overrides.createSeason(config)
        : ok(config, { success: true, data: { id: 'season-1' } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

async function renderPage(adapter: AxiosAdapter): Promise<QueryClient> {
  apiClient.defaults.adapter = adapter;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <SeasonListPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  return queryClient;
}

describe('SeasonListPage Financial Year integration', () => {
  it('renders visible Season code, Season name, and Financial Year labels', async () => {
    await renderPage(baseAdapter());

    const financialYearLabel = Array.from(container.querySelectorAll('label')).find(
      (el) => el.textContent === 'Financial Year',
    );
    expect(financialYearLabel).toBeDefined();
    expect(financialYearLabel?.getAttribute('for')).toBe('select-financial-year');
    expect(container.querySelector('#select-financial-year')).not.toBeNull();
    expect(container.textContent).toContain('Season code');
    expect(container.textContent).toContain('Season name');
  });

  it('defaults the create form to the current Financial Year and keeps a manual selection across a refetch', async () => {
    const queryClient = await renderPage(baseAdapter());

    await vi.waitFor(() => expect(trigger('select-financial-year').textContent).toContain('26-27'));

    await selectOption('select-financial-year', '27-28');
    expect(trigger('select-financial-year').textContent).toContain('27-28');

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['financial-years', 'current'] });
    });
    await flush();

    expect(trigger('select-financial-year').textContent).toContain('27-28');
  });

  it('keeps the Season list filter defaulted to All Financial Years', async () => {
    await renderPage(baseAdapter());

    const filterTrigger = container.querySelector('[aria-label="Filter by Financial Year"]');
    expect(filterTrigger?.textContent).toContain('All Financial Years');
  });

  it('creates a Season sending the defaulted Financial Year id', async () => {
    let createBody: Record<string, unknown> | undefined;
    await renderPage(
      baseAdapter({
        createSeason: async (config) => {
          createBody = JSON.parse(config.data as string) as Record<string, unknown>;
          return ok(config, {
            success: true,
            data: { id: 'season-1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' },
          });
        },
      }),
    );
    await vi.waitFor(() => expect(trigger('select-financial-year').textContent).toContain('26-27'));

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add Season',
    );
    await act(async () => submit!.click());
    await flush();

    expect(createBody).toMatchObject({
      code: 'SS26',
      name: 'Summer 26',
      financialYearId: currentFinancialYear.id,
    });
  });

  it('shows a field-level Required error for Financial Year when no default can be resolved and the user submits', async () => {
    await renderPage(
      baseAdapter({
        current: async (config) => fail(config, 500, 'Financial Year 2026-27 is expected to already exist but was not found'),
      }),
    );
    await vi.waitFor(() => expect(container.textContent).toContain('Season code'));

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add Season',
    );
    await act(async () => submit!.click());
    await flush();

    expect(container.textContent).toContain('Season code, name, and Financial Year are required');
    const errorText = trigger('select-financial-year').closest('div')?.parentElement?.textContent ?? '';
    expect(container.querySelector('#select-financial-year')?.getAttribute('aria-invalid')).toBe('true');
    expect(errorText).toContain('Required');
  });

  it('still validates Season code and name as required, independent of Financial Year', async () => {
    await renderPage(baseAdapter());
    await vi.waitFor(() => expect(trigger('select-financial-year').textContent).toContain('26-27'));

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add Season',
    );
    await act(async () => submit!.click());
    await flush();

    expect(container.textContent).toContain('Season code, name, and Financial Year are required');
    expect(container.querySelector('#field-season-code')?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#field-season-name')?.getAttribute('aria-invalid')).toBe('true');
  });
});
