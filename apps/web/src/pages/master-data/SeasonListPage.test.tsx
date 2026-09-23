/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
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
  updateStatus?: AxiosAdapter;
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
    if (config.url?.match(/^\/seasons\/.+\/status$/) && config.method === 'patch') {
      return overrides.updateStatus
        ? overrides.updateStatus(config)
        : ok(config, { success: true, data: {} });
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
          <AuthProvider>
            <SeasonListPage />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  return queryClient;
}

// Clicking a PDF action triggers a dynamic import() of the PDF generation code (kept out of the
// eager bundle), which takes an unpredictable number of extra ticks beyond a single flush() to
// settle — poll instead (same rationale as StyleListPage.test.tsx).
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('Timed out waiting for condition');
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

describe('SeasonListPage Activate/Deactivate confirmation', () => {
  it('does not call the status API until the confirmation dialog is confirmed', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' }];
    let statusCalls = 0;
    await renderPage(baseAdapter({ updateStatus: async (config) => { statusCalls += 1; return ok(config, { success: true, data: {} }); } }));
    await vi.waitFor(() => expect(container.textContent).toContain('SS26'));

    const deactivateButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Deactivate',
    );
    await act(async () => deactivateButton!.click());

    expect(statusCalls).toBe(0);
    const dialogTitle = Array.from(document.body.querySelectorAll('h2, [role="heading"]')).find(
      (el) => el.textContent === 'Deactivate SS26?',
    );
    expect(dialogTitle).toBeDefined();

    const confirmButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Deactivate' && button.closest('[role="dialog"]'),
    );
    await act(async () => confirmButton!.click());
    await flush();

    expect(statusCalls).toBe(1);
  });

  it('cancelling the dialog does not call the status API', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'INACTIVE' }];
    let statusCalls = 0;
    await renderPage(baseAdapter({ updateStatus: async (config) => { statusCalls += 1; return ok(config, { success: true, data: {} }); } }));
    await vi.waitFor(() => expect(container.textContent).toContain('SS26'));

    const activateButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Activate',
    );
    await act(async () => activateButton!.click());

    const cancelButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel' && button.closest('[role="dialog"]'),
    );
    await act(async () => cancelButton!.click());
    await flush();

    expect(statusCalls).toBe(0);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('SeasonListPage PDF actions', () => {
  it('shows Download PDF and Print actions near the Financial Year filter', async () => {
    await renderPage(baseAdapter());
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' }];
    await renderPage(baseAdapter());
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    await act(async () => printBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.find((b) => b.textContent === 'Print')!.disabled).toBe(false);
    expect(buttons.find((b) => b.textContent === 'Download PDF')!.disabled).toBe(false);
  });

  it('downloads the season list PDF under the expected filename', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' }];
    await renderPage(baseAdapter());
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    await act(async () => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy.mock.calls[0]![1]).toMatch(/^ERVE-Seasons-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' }];
    await renderPage(baseAdapter());
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const printSpy = vi.spyOn(printModule, 'printPdfBlob').mockImplementation(() => {});
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    await act(async () => printBtn.click());
    await waitFor(() => printSpy.mock.calls.length > 0);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});

// U3A audit: the Add-Season form's default Financial Year comes from
// useCurrentFinancialYearQuery while the Select's options come from the
// independently-timed useFinancialYearsQuery. These tests deliberately
// control resolution order to prove whether the Radix Select's controlled
// `value` prop (which changes from '' to a real id once currentFinancialYearQuery
// resolves, after the Select has already mounted) gets clobbered back to
// empty — the same shape of bug documented for Style Season in
// erve-radix-select-hydration-race-general-pattern.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('SeasonListPage Financial Year hydration race (regression)', () => {
  it('Case A: financial-year options resolve before current FY — final Select value is correct', async () => {
    const optionsGate = deferred<void>();
    const currentGate = deferred<void>();
    let createBody: Record<string, unknown> | undefined;

    await renderPage(
      baseAdapter({
        financialYears: async (config) => {
          await optionsGate.promise;
          return ok(config, { success: true, data: financialYears });
        },
        current: async (config) => {
          await currentGate.promise;
          return ok(config, { success: true, data: currentFinancialYear });
        },
        createSeason: async (config) => {
          createBody = JSON.parse(config.data as string) as Record<string, unknown>;
          return ok(config, {
            success: true,
            data: { id: 'season-1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' },
          });
        },
      }),
    );

    optionsGate.resolve();
    await flush();
    currentGate.resolve();
    await flush();
    await flush();

    expect(trigger('select-financial-year').textContent).toContain('26-27');

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add Season',
    );
    await act(async () => submit!.click());
    await flush();

    expect(createBody).toMatchObject({ financialYearId: currentFinancialYear.id });
  });

  it('Case B: current FY resolves before financial-year options — final Select value is correct', async () => {
    const optionsGate = deferred<void>();
    const currentGate = deferred<void>();
    let createBody: Record<string, unknown> | undefined;

    await renderPage(
      baseAdapter({
        financialYears: async (config) => {
          await optionsGate.promise;
          return ok(config, { success: true, data: financialYears });
        },
        current: async (config) => {
          await currentGate.promise;
          return ok(config, { success: true, data: currentFinancialYear });
        },
        createSeason: async (config) => {
          createBody = JSON.parse(config.data as string) as Record<string, unknown>;
          return ok(config, {
            success: true,
            data: { id: 'season-1', code: 'SS26', name: 'Summer 26', financialYear: currentFinancialYear, displayName: 'SS26', status: 'ACTIVE' },
          });
        },
      }),
    );

    currentGate.resolve();
    await flush();
    optionsGate.resolve();
    await flush();
    await flush();

    expect(trigger('select-financial-year').textContent).toContain('26-27');

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Add Season',
    );
    await act(async () => submit!.click());
    await flush();

    expect(createBody).toMatchObject({ financialYearId: currentFinancialYear.id });
  });

  it('Case C: opening Edit before financial-year options resolve keeps the existing Season FY selected', async () => {
    seasons = [
      {
        id: 'season-old',
        code: 'AW25',
        name: 'Autumn 25',
        financialYear: financialYears[0],
        displayName: 'AW25',
        status: 'ACTIVE',
      },
    ];
    const optionsGate = deferred<void>();

    await renderPage(
      baseAdapter({
        financialYears: async (config) => {
          await optionsGate.promise;
          return ok(config, { success: true, data: financialYears });
        },
      }),
    );

    const editButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Edit',
    );
    await act(async () => editButton!.click());
    await flush();

    optionsGate.resolve();
    await flush();
    await flush();

    expect(trigger('select-financial-year').textContent).toContain('25-26');
  });
});
