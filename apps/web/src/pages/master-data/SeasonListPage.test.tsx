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

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly.
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

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

interface AdapterOverrides {
  createSeason?: AxiosAdapter;
  updateStatus?: AxiosAdapter;
}

function baseAdapter(overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/seasons' && config.method === 'get') {
      return ok(config, { success: true, data: { items: seasons, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } });
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
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await flush();
  }
}

function submitButton(): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Add Season',
  )!;
}

// ISS-SEASON-FY: Season has no Financial Year field any more — the form is
// just Code, Name and an optional Barcode Serial, and Season Code is
// globally unique (enforced server-side; see master-data.test.ts).
describe('SeasonListPage (no Financial Year)', () => {
  it('renders Season code and name fields without any Financial Year control', async () => {
    await renderPage(baseAdapter());

    expect(container.textContent).toContain('Season code');
    expect(container.textContent).toContain('Season name');
    expect(Array.from(container.querySelectorAll('label')).some((el) => el.textContent?.includes('Financial Year'))).toBe(false);
    expect(container.querySelector('#select-financial-year')).toBeNull();
  });

  it('sends the Barcode Serial when entered and omits it when left blank', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await renderPage(
      baseAdapter({
        createSeason: async (config) => {
          bodies.push(JSON.parse(config.data as string) as Record<string, unknown>);
          return ok(config, {
            success: true,
            data: { id: 'season-1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', barcodeSerial: 3, status: 'ACTIVE' },
          });
        },
      }),
    );

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');
    await act(async () => submitButton().click());
    await flush();
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss27');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 27');
    setInputValue(container.querySelector<HTMLInputElement>('#field-barcode-serial')!, '3');
    await act(async () => submitButton().click());
    await flush();

    expect(bodies[0]).not.toHaveProperty('barcodeSerial');
    expect(bodies[1]).toMatchObject({ code: 'SS27', barcodeSerial: 3 });
  });

  it('rejects a non-numeric Barcode Serial before calling the API', async () => {
    let called = false;
    await renderPage(baseAdapter({ createSeason: async (config) => { called = true; return ok(config, { success: true, data: {} }); } }));

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-barcode-serial')!, '12ab');
    await act(async () => submitButton().click());
    await flush();

    expect(called).toBe(false);
    expect(container.textContent).toContain('Barcode Serial must be a whole number');
  });

  it('renders a search input and status filter', async () => {
    await renderPage(baseAdapter());
    expect(container.querySelector('input[aria-label="Search"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Status"]')).not.toBeNull();
  });

  it('sends the selected status to the /seasons query', async () => {
    const seasonsParams: Array<Record<string, unknown>> = [];
    const inner = baseAdapter();
    const recordingAdapter: AxiosAdapter = (async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/seasons' && config.method === 'get') {
        seasonsParams.push(config.params as Record<string, unknown>);
      }
      return inner(config);
    }) as AxiosAdapter;
    await renderPage(recordingAdapter);
    seasonsParams.length = 0;

    const statusTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Status"]')!;
    await act(async () => statusTrigger.click());
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (el) => el.textContent?.trim() === 'Active',
    )!;
    await act(async () => option.click());
    await flush();

    expect(seasonsParams.some((params) => params.status === 'ACTIVE')).toBe(true);
  });

  it('creates a Season sending only code and name (and omitted Barcode Serial)', async () => {
    let createBody: Record<string, unknown> | undefined;
    await renderPage(
      baseAdapter({
        createSeason: async (config) => {
          createBody = JSON.parse(config.data as string) as Record<string, unknown>;
          return ok(config, {
            success: true,
            data: { id: 'season-1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', status: 'ACTIVE' },
          });
        },
      }),
    );

    setInputValue(container.querySelector<HTMLInputElement>('#field-season-code')!, 'ss26');
    setInputValue(container.querySelector<HTMLInputElement>('#field-season-name')!, 'Summer 26');
    await act(async () => submitButton().click());
    await flush();

    expect(createBody).toMatchObject({ code: 'SS26', name: 'Summer 26' });
    expect(createBody).not.toHaveProperty('financialYearId');
  });

  it('still validates Season code and name as required', async () => {
    await renderPage(baseAdapter());

    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Season code and name are required');
    expect(container.querySelector('#field-season-code')?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#field-season-name')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('U4-AUDIT-NEW-02: maintains top-alignment layout on FormGrid when field errors appear', async () => {
    await renderPage(baseAdapter());
    const formGrid = container.querySelector('form > div');
    expect(formGrid?.className).toContain('items-start');
    expect(formGrid?.className).not.toContain('items-end');

    await act(async () => submitButton().click());
    await flush();

    expect(formGrid?.className).toContain('items-start');
    expect(formGrid?.className).not.toContain('items-end');
  });

  // U4-AUDIT-NEW-02 (root cause): TextField/SelectField reserve a fixed-height
  // slot for their error/help text, so a field's own box does not grow the
  // instant a validation error first appears — the growth is what previously
  // misaligned the Add/Save button next to it. Verified structurally (the
  // reserved-height slot is present) since jsdom does not compute real layout.
  it('reserves the error-text slot under Season code before any error is shown', async () => {
    await renderPage(baseAdapter());
    const codeField = container.querySelector<HTMLInputElement>('#field-season-code');
    const reservedSlot = codeField?.closest('div[data-width]')?.querySelector('.min-h-\\[0\\.75rem\\]');
    expect(reservedSlot).not.toBeNull();

    await act(async () => submitButton().click());
    await flush();

    // Same slot, now carrying the "Required" text — not a newly-mounted node.
    const reservedSlotAfterError = codeField?.closest('div[data-width]')?.querySelector('.min-h-\\[0\\.75rem\\]');
    expect(reservedSlotAfterError).not.toBeNull();
    expect(reservedSlotAfterError?.textContent).toBe('Required');
  });
});

describe('SeasonListPage Activate/Deactivate confirmation', () => {
  it('does not call the status API until the confirmation dialog is confirmed', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', status: 'ACTIVE' }];
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
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', status: 'INACTIVE' }];
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
  it('shows Download PDF and Print actions', async () => {
    await renderPage(baseAdapter());
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', status: 'ACTIVE' }];
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
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', status: 'ACTIVE' }];
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
    seasons = [{ id: 's1', code: 'SS26', name: 'Summer 26', displayName: 'SS26', status: 'ACTIVE' }];
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
