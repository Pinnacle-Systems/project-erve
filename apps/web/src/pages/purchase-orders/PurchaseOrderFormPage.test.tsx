/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { PurchaseOrderFormPage } from './PurchaseOrderFormPage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number, body: unknown): never {
  const error = new Error(`Request failed with status code ${status}`) as Error & {
    response: unknown;
    isAxiosError: boolean;
  };
  error.isAxiosError = true;
  error.response = { status, data: body, statusText: '', headers: {}, config };
  throw error;
}

function networkFail(): never {
  const error = new Error('Network Error') as Error & { isAxiosError: boolean };
  error.isAxiosError = true;
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

const distributor = {
  id: 'dist-1',
  code: 'DIST-1',
  name: 'Acme Distribution',
  purchaseMode: 'OUTRIGHT' as const,
  status: 'ACTIVE',
};

interface StyleFixture {
  id: string;
  styleNumber: string;
  styleName: string;
  lmixNumber: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  season: { code: string; displayName: string };
  sizes: Array<{ id: string; code: string; label: string; sortOrder: number }>;
}

const season = { code: 'SS26', displayName: 'SS26 26-27' };

const testStyle: StyleFixture = {
  id: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  lmixNumber: 'LMIX5526011',
  status: 'ACTIVE',
  season,
  sizes: [{ id: 'size-1', code: 'M', label: 'Medium', sortOrder: 1 }],
};

// Same name as testStyle on purpose — real Style names repeat, so LMIX and
// Style No. are what tell results apart.
const twinStyle: StyleFixture = {
  id: 'style-2',
  styleNumber: 'SS26-TEE-2',
  styleName: 'Classic Tee',
  lmixNumber: 'LMIX5526022',
  status: 'ACTIVE',
  season,
  sizes: [
    { id: 'size-s', code: 'S', label: 'Small', sortOrder: 1 },
    { id: 'size-l', code: 'L', label: 'Large', sortOrder: 3 },
  ],
};

const retiredStyle: StyleFixture = {
  id: 'style-9',
  styleNumber: 'AW24-OLD',
  styleName: 'Old Hoody',
  lmixNumber: 'LMIX1111111',
  status: 'INACTIVE',
  season: { code: 'AW24', displayName: 'AW24 24-25' },
  sizes: [{ id: 'size-1', code: 'M', label: 'Medium', sortOrder: 1 }],
};

const catalog = [testStyle, twinStyle, retiredStyle];

// Every request a test makes — lets tests prove the form never asks for the
// full Style master (GET /styles).
let requestLog: Array<{ method: string; url: string; params: Record<string, unknown> | undefined }> = [];

function slimOption(style: StyleFixture) {
  const { sizes: _sizes, ...option } = style;
  return option;
}

// Mirrors GET /purchase-orders/style-options: ACTIVE only, LMIX/Style
// No./Style Name contains, bounded by limit.
function searchCatalog(styles: StyleFixture[], params: { search?: string; limit?: number }) {
  const needle = (params.search ?? '').toLowerCase();
  return styles
    .filter((style) => style.status === 'ACTIVE')
    .filter((style) =>
      [style.lmixNumber ?? '', style.styleNumber, style.styleName].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    )
    .slice(0, params.limit ?? 20)
    .map(slimOption);
}

interface StyleEndpointOverrides {
  searchStyles?: AxiosAdapter;
  styleDetail?: AxiosAdapter;
}

function styleEndpoints(
  config: InternalAxiosRequestConfig,
  styles: StyleFixture[],
  overrides: StyleEndpointOverrides,
): Promise<AxiosResponse> | AxiosResponse | undefined {
  if (config.method !== 'get') return undefined;
  if (config.url === '/purchase-orders/style-options') {
    return overrides.searchStyles
      ? overrides.searchStyles(config)
      : ok(config, { success: true, data: searchCatalog(styles, config.params ?? {}) });
  }
  const detailMatch = config.url?.match(/^\/purchase-orders\/style-options\/(.+)$/);
  if (detailMatch) {
    if (overrides.styleDetail) return overrides.styleDetail(config);
    const style = styles.find((candidate) => candidate.id === detailMatch[1]);
    return style
      ? ok(config, { success: true, data: style })
      : fail(config, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Style not found' } });
  }
  return undefined;
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

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
  requestLog = [];
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

// Polls until the assertion holds — the Style lookup debounces (300 ms)
// before it searches, so fixed short flushes aren't enough.
async function waitFor(assertion: () => void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (caught) {
      if (Date.now() > deadline) throw caught;
      await flush();
    }
  }
}

// Mirrors GET /distributors/options: name/code contains, bounded by limit.
function searchDistributors(
  distributors: Array<{ name: string; code: string }>,
  params: { search?: string; limit?: number } | undefined,
) {
  const needle = (params?.search ?? '').toLowerCase();
  return distributors
    .filter((d) => [d.name, d.code].some((field) => field.toLowerCase().includes(needle)))
    .slice(0, params?.limit ?? 20);
}

function distributorInput(): HTMLInputElement {
  const input = document.getElementById('lookup-distributor-*') as HTMLInputElement | null;
  if (!input) throw new Error('Distributor lookup input not found');
  return input;
}

// Types part of the name into the Distributor lookup, waits for fresh
// results and clicks the matching option.
async function chooseDistributor(name: string): Promise<void> {
  await act(async () => {
    distributorInput().focus();
    setInputValue(distributorInput(), name.slice(0, 4));
  });
  await waitFor(() => {
    expect(document.body.querySelector('[role="listbox"][aria-busy]')).toBeNull();
    expect(lookupOptions().some((option) => option.textContent?.includes(name))).toBe(true);
  });
  const option = lookupOptions().find((candidate) => candidate.textContent?.includes(name))!;
  await act(async () => option.click());
}

interface AdapterOverrides extends StyleEndpointOverrides {
  createPO?: AxiosAdapter;
}

function baseAdapter(styles: StyleFixture[], overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    requestLog.push({ method: config.method ?? '', url: config.url ?? '', params: config.params });
    const styleResponse = styleEndpoints(config, styles, overrides);
    if (styleResponse) return styleResponse;
    if (config.url === '/distributors/options' && config.method === 'get') {
      return ok(config, { success: true, data: searchDistributors([distributor], config.params) });
    }
    if (config.url === '/financial-years/resolve' && config.method === 'get') {
      return ok(config, { success: true, data: { code: '2026-27' } });
    }
    if (config.url === '/purchase-orders' && config.method === 'post') {
      return overrides.createPO
        ? overrides.createPO(config)
        : ok(config, { success: true, data: { id: 'po-1' } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

async function renderPage(adapter: AxiosAdapter): Promise<void> {
  apiClient.defaults.adapter = adapter;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/purchase-orders/new']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/purchase-orders/new" element={<PurchaseOrderFormPage />} />
            <Route path="/purchase-orders/:id" element={<div>Purchase Order Detail Page</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
}

async function renderEditPage(adapter: AxiosAdapter): Promise<QueryClient> {
  apiClient.defaults.adapter = adapter;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/purchase-orders/po-1/edit']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
            <Route path="/purchase-orders/:id" element={<div>Purchase Order Detail Page</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  return queryClient;
}

const existingPO = {
  id: 'po-1',
  poNumber: 'EIPO/26-27/0001',
  distributor,
  purchaseMode: 'OUTRIGHT',
  poDate: '2026-09-01T00:00:00.000Z',
  requiredDeliveryDate: null,
  remarks: 'existing remarks',
  status: 'DRAFT',
  lines: [
    {
      styleId: 'style-1',
      styleNumber: 'ST-001',
      styleName: 'Classic Tee',
      remarks: '',
      sizes: [{ sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', orderedQuantity: 12 }],
    },
  ],
};

interface EditAdapterOverrides extends StyleEndpointOverrides {
  getPO?: AxiosAdapter;
  patchPO?: AxiosAdapter;
}

function editAdapter(styles: StyleFixture[], overrides: EditAdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    requestLog.push({ method: config.method ?? '', url: config.url ?? '', params: config.params });
    const styleResponse = styleEndpoints(config, styles, overrides);
    if (styleResponse) return styleResponse;
    if (config.url === '/purchase-orders/po-1' && config.method === 'get') {
      return overrides.getPO ? overrides.getPO(config) : ok(config, { success: true, data: existingPO });
    }
    if (config.url === '/financial-years/resolve' && config.method === 'get') {
      return ok(config, { success: true, data: { code: '2026-27' } });
    }
    if (config.url === '/purchase-orders/po-1' && config.method === 'patch') {
      return overrides.patchPO ? overrides.patchPO(config) : ok(config, { success: true, data: { id: 'po-1' } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

function saveButton(): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save') ?? null;
}

function styleInput(): HTMLInputElement {
  const input = document.getElementById('lookup-style-*') as HTMLInputElement | null;
  if (!input) throw new Error('Style lookup input not found');
  return input;
}

function lookupOptions(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

function lookupPanelText(): string {
  return document.body.querySelector('[data-lookup-panel]')?.textContent ?? '';
}

async function typeStyleSearch(text: string): Promise<void> {
  await act(async () => {
    styleInput().focus();
    setInputValue(styleInput(), text);
  });
}

async function pressKey(key: string): Promise<boolean> {
  let notPrevented = true;
  await act(async () => {
    notPrevented = styleInput().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
  return notPrevented;
}

async function waitForFreshResults(): Promise<void> {
  await waitFor(() => {
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.body.querySelector('[role="listbox"][aria-busy]')).toBeNull();
  });
}

// Types a search, waits for fresh (non-busy) results, clicks the option for
// `styleNumber`.
async function chooseStyle(search: string, styleNumber: string): Promise<void> {
  await typeStyleSearch(search);
  await waitFor(() => {
    expect(document.body.querySelector('[role="listbox"][aria-busy]')).toBeNull();
    expect(lookupOptions().some((option) => option.textContent?.includes(styleNumber))).toBe(true);
  });
  const option = lookupOptions().find((candidate) => candidate.textContent?.includes(styleNumber))!;
  await act(async () => option.click());
}

function sizeInput(sizeCode: string): HTMLInputElement | null {
  return document.getElementById(`field-${sizeCode.toLowerCase()}`) as HTMLInputElement | null;
}

async function fillValidStyleLine(search: string, styleNumber: string, sizeCode: string): Promise<void> {
  await chooseDistributor('Acme Distribution');
  await flush();
  await chooseStyle(search, styleNumber);
  await waitFor(() => expect(sizeInput(sizeCode)).not.toBeNull());
  setInputValue(sizeInput(sizeCode)!, '5');
}

function styleMasterRequests() {
  return requestLog.filter((request) => request.url === '/styles' || request.url.startsWith('/styles/'));
}

function submitButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save');
  if (!button) throw new Error('Save button not found');
  return button;
}

describe('PurchaseOrderFormPage save error handling', () => {
  it('surfaces a VALIDATION_ERROR business message rather than the raw Axios error', async () => {
    await renderPage(
      baseAdapter(catalog, {
        createPO: async (config) =>
          fail(config, 400, {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Required delivery date cannot be before the PO date',
              details: {},
            },
          }),
      }),
    );

    await fillValidStyleLine('ST-001', 'ST-001', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Required delivery date cannot be before the PO date');
    expect(container.textContent).not.toContain('Request failed with status code 400');
  });

  it('falls back to a generic message when the API provides no usable business message', async () => {
    await renderPage(baseAdapter(catalog, { createPO: async () => networkFail() }));

    await fillValidStyleLine('ST-001', 'ST-001', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Unable to save the Order Sheet');
    expect(container.textContent).not.toContain('Request failed with status code');
    expect(container.textContent).not.toContain('Network Error');
  });

  it('saves the draft successfully and navigates away when the request is valid', async () => {
    await renderPage(baseAdapter(catalog));

    await fillValidStyleLine('ST-001', 'ST-001', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Purchase Order Detail Page');
    expect(container.textContent).not.toContain('Unable to save');
  });
});

// NEW-AUTH-001: an EDIT-mode load that is still pending, or that fails, must
// never fall through to the same writable default form CREATE renders — an
// authorized actor could otherwise submit those defaults and PATCH the
// existing Order Sheet incorrectly.
describe('PurchaseOrderFormPage edit-load safety (NEW-AUTH-001)', () => {
  it('CREATE mode renders the blank form immediately, with no loading/error state', async () => {
    await renderPage(baseAdapter(catalog));

    expect(container.textContent).not.toContain('Loading Order Sheet');
    expect(container.textContent).not.toContain('Unable to load Order Sheet');
    expect(submitButton()).not.toBeNull();
  });

  it('EDIT + pending GET shows LoadingState, not the writable form, and no Save action', async () => {
    let resolveGet!: (value: AxiosResponse<unknown>) => void;
    const pending = new Promise<AxiosResponse<unknown>>((resolve) => {
      resolveGet = resolve;
    });
    let patchCalled = false;
    await renderEditPage(
      editAdapter(catalog, {
        getPO: async () => pending,
        patchPO: async (config) => {
          patchCalled = true;
          return ok(config, { success: true, data: { id: 'po-1' } });
        },
      }),
    );

    expect(container.textContent).toContain('Loading Order Sheet');
    expect(container.textContent).not.toContain('existing remarks');
    expect(container.querySelector('form')).toBeNull();
    expect(saveButton()).toBeNull();
    expect(patchCalled).toBe(false);

    // Resolve after assertions so the pending promise doesn't leak across tests.
    resolveGet!(ok({} as InternalAxiosRequestConfig, { success: true, data: existingPO }));
    await flush();
  });

  it('EDIT + failed GET shows ErrorState, not the writable form, and no Save action', async () => {
    let patchCalled = false;
    await renderEditPage(
      editAdapter(catalog, {
        getPO: async (config) => fail(config, 500, { success: false, error: { code: 'INTERNAL', message: 'boom' } }),
        patchPO: async (config) => {
          patchCalled = true;
          return ok(config, { success: true, data: { id: 'po-1' } });
        },
      }),
    );
    await flush();

    expect(container.textContent).toContain('Unable to load Order Sheet');
    expect(container.textContent).not.toContain('existing remarks');
    expect(container.querySelector('form')).toBeNull();
    expect(saveButton()).toBeNull();
    expect(patchCalled).toBe(false);
  });

  it('EDIT + successful GET hydrates the existing Order Sheet into a writable form', async () => {
    await renderEditPage(editAdapter(catalog));
    await flush();
    await flush();

    expect(container.textContent).not.toContain('Loading Order Sheet');
    expect(container.textContent).not.toContain('Unable to load Order Sheet');
    expect(container.querySelector('form')).not.toBeNull();

    const remarksInputs = Array.from(container.querySelectorAll('input')).filter(
      (i) => (i as HTMLInputElement).value === 'existing remarks',
    );
    expect(remarksInputs.length).toBeGreaterThan(0);
    const qtyInput = document.getElementById('field-m') as HTMLInputElement | null;
    expect(qtyInput?.value).toBe('12');
    expect((document.getElementById('field-distributor-*') as HTMLInputElement | null)?.value).toBe(
      'Acme Distribution',
    );
    expect((document.getElementById('field-purchase-mode') as HTMLInputElement | null)?.value).toBe('Outright');
    expect(styleInput().value).toContain('ST-001');
    expect(styleInput().value).toContain('Classic Tee');

    const save = saveButton();
    expect(save).not.toBeNull();
    await act(async () => save!.click());
    await flush();

    expect(container.textContent).toContain('Purchase Order Detail Page');
  });

  it('does not re-hydrate and clobber an in-progress edit when poQuery refetches in the background (e.g. a reconnect)', async () => {
    let getCallCount = 0;
    const queryClient = await renderEditPage(
      editAdapter(catalog, {
        getPO: async (config) => {
          getCallCount += 1;
          // The background refetch returns genuinely different content —
          // TanStack Query's structural sharing would otherwise keep the old
          // data reference (and never re-run the hydration effect at all) if
          // the refetched payload were merely an identical clone.
          const data = getCallCount === 1 ? existingPO : { ...existingPO, remarks: 'server-side changed remarks' };
          return ok(config, { success: true, data });
        },
      }),
    );
    await flush();
    await flush();

    const remarksInput = document.getElementById('field-remarks') as HTMLInputElement | null;
    expect(remarksInput?.value).toBe('existing remarks');

    // User edits the header Remarks field locally, without saving yet.
    setInputValue(remarksInput!, 'user edited remarks');
    expect(remarksInput!.value).toBe('user edited remarks');

    // Simulate a background refetch of the same query (e.g. refetchOnReconnect).
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['purchase-order', 'po-1'] });
    });
    await flush();
    await flush();

    expect(remarksInput!.value).toBe('user edited remarks');
    expect(container.textContent).not.toContain('server-side changed remarks');
    expect(getCallCount).toBe(2);
  });
});

// Purchase Mode is owned by the Distributor master and derived on CREATE from
// the selected option returned by GET /distributors/options. The API side of
// this contract (purchaseMode present in the option response) is pinned in
// master-data.test.ts — this test covers the form's derivation only.
describe('PurchaseOrderFormPage derived Purchase Mode (CREATE)', () => {
  it('shows the selected Distributor purchase mode read-only and follows Distributor changes', async () => {
    const saleReturnDistributor = {
      id: 'dist-2',
      code: 'DIST-2',
      name: 'Beta Consignment',
      purchaseMode: 'SALE_RETURN' as const,
      status: 'ACTIVE',
    };
    const adapter = baseAdapter([testStyle]);
    await renderPage((async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/distributors/options' && config.method === 'get') {
        return ok(config, {
          success: true,
          data: searchDistributors([distributor, saleReturnDistributor], config.params),
        });
      }
      return adapter(config);
    }) as AxiosAdapter);

    const purchaseMode = () =>
      document.getElementById('field-purchase-mode') as HTMLInputElement | null;
    expect(purchaseMode()?.value).toBe('');
    expect(purchaseMode()?.disabled).toBe(true);

    await chooseDistributor('Acme Distribution');
    await flush();
    expect(purchaseMode()?.value).toBe('Outright');

    await chooseDistributor('Beta Consignment');
    await flush();
    expect(purchaseMode()?.value).toBe('Sale or Return');
    expect(purchaseMode()?.disabled).toBe(true);

    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear Distributor *"]')!;
    await act(async () => clear.click());
    await flush();
    expect(purchaseMode()?.value).toBe('');
    // The Distributor master list is never downloaded for the selector.
    expect(requestLog.some((request) => request.url === '/distributors')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1L1 — Order Sheet Style lookup
// ---------------------------------------------------------------------------

function NavigateButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="nav" onClick={() => navigate(to)}>
      go
    </button>
  );
}

const retiredPO = {
  ...existingPO,
  id: 'po-2',
  poNumber: 'EIPO/26-27/0002',
  remarks: 'retired style remarks',
  lines: [
    {
      styleId: 'style-9',
      styleNumber: 'AW24-OLD',
      styleName: 'Old Hoody',
      remarks: '',
      sizes: [{ sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', orderedQuantity: 7 }],
    },
  ],
};

describe('PurchaseOrderFormPage Style lookup (P1L1)', () => {
  it('shows a search prompt, not a preloaded list, before anything is typed', async () => {
    await renderPage(baseAdapter(catalog));

    await act(async () => styleInput().focus());
    await pressKey('ArrowDown');
    await typeStyleSearch('5');
    await flush();

    expect(styleInput().getAttribute('role')).toBe('combobox');
    expect(lookupPanelText()).toContain('Type to search by LMIX, Style No. or Style Name');
    expect(lookupOptions()).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requestLog.filter((request) => request.url === '/purchase-orders/style-options')).toHaveLength(0);
  });

  it('sends one debounced, bounded server search for the final text and renders LMIX in the results', async () => {
    await renderPage(baseAdapter(catalog));

    for (const text of ['55', '552', '5526', '55260']) {
      await typeStyleSearch(text);
    }
    await waitForFreshResults();

    const searches = requestLog.filter((request) => request.url === '/purchase-orders/style-options');
    expect(searches).toHaveLength(1);
    expect(searches[0]!.params).toEqual({ search: '55260', limit: 20 });
    const optionTexts = lookupOptions().map((option) => option.textContent ?? '');
    expect(optionTexts).toHaveLength(2);
    // Duplicate names are told apart by Style No. + LMIX.
    expect(optionTexts[0]).toContain('ST-001');
    expect(optionTexts[0]).toContain('LMIX5526011');
    expect(optionTexts[1]).toContain('SS26-TEE-2');
    expect(optionTexts[1]).toContain('LMIX5526022');
    expect(optionTexts.every((text) => text.includes('Classic Tee'))).toBe(true);
  });

  it('selecting a Style loads its sizes from the selected-Style request and saves them', async () => {
    let posted: { lines: Array<{ styleId: string; sizes: unknown[] }> } | undefined;
    await renderPage(
      baseAdapter(catalog, {
        createPO: async (config) => {
          posted = JSON.parse(config.data as string);
          return ok(config, { success: true, data: { id: 'po-1' } });
        },
      }),
    );
    await chooseDistributor('Acme Distribution');

    await chooseStyle('5526022', 'SS26-TEE-2');

    await waitFor(() => expect(sizeInput('S')).not.toBeNull());
    expect(sizeInput('L')).not.toBeNull();
    expect(sizeInput('M')).toBeNull();
    expect(styleInput().value).toBe('SS26-TEE-2 · LMIX5526022 · Classic Tee');
    expect(requestLog.some((request) => request.url === '/purchase-orders/style-options/style-2')).toBe(true);

    setInputValue(sizeInput('L')!, '9');
    await act(async () => submitButton().click());
    await flush();

    expect(posted?.lines).toEqual([
      { styleId: 'style-2', remarks: null, sizes: [{ sizeId: 'size-l', orderedQuantity: 9 }] },
    ]);
  });

  it('switching Style replaces the size rows with the new Style’s sizes', async () => {
    await renderPage(baseAdapter(catalog));
    await chooseStyle('ST-001', 'ST-001');
    await waitFor(() => expect(sizeInput('M')).not.toBeNull());
    setInputValue(sizeInput('M')!, '4');

    await chooseStyle('SS26-TEE', 'SS26-TEE-2');

    await waitFor(() => expect(sizeInput('S')).not.toBeNull());
    expect(sizeInput('M')).toBeNull();
    expect(sizeInput('S')!.value).toBe('');
  });

  it('ArrowDown/ArrowUp move the highlight and Enter selects the highlighted Style', async () => {
    await renderPage(baseAdapter(catalog));
    await typeStyleSearch('Classic');
    await waitForFreshResults();

    const highlighted = () =>
      lookupOptions().find((option) => option.getAttribute('aria-selected') === 'true')?.textContent ?? '';
    expect(highlighted()).toContain('ST-001');
    await pressKey('ArrowDown');
    expect(highlighted()).toContain('SS26-TEE-2');
    await pressKey('ArrowUp');
    await pressKey('ArrowDown');

    expect(await pressKey('Enter')).toBe(false);

    expect(styleInput().value).toContain('SS26-TEE-2');
    expect(lookupOptions()).toHaveLength(0);
    await waitFor(() => expect(sizeInput('S')).not.toBeNull());
  });

  it('Escape closes the results; Enter is not consumed once the lookup is closed', async () => {
    await renderPage(baseAdapter(catalog));
    await typeStyleSearch('Classic');
    await waitForFreshResults();

    expect(await pressKey('Escape')).toBe(false);

    expect(document.body.querySelector('[data-lookup-panel]')).toBeNull();
    expect(styleInput().getAttribute('aria-expanded')).toBe('false');
    expect(await pressKey('Enter')).toBe(true);
  });

  it('shows the no-result state', async () => {
    await renderPage(baseAdapter(catalog));
    await typeStyleSearch('ZZZ-NOPE');

    await waitFor(() => expect(lookupPanelText()).toContain('No active Styles match'));
    expect(lookupOptions()).toHaveLength(0);
  });

  it('shows the server-error state', async () => {
    await renderPage(
      baseAdapter(catalog, {
        searchStyles: async (config) =>
          fail(config, 500, { success: false, error: { code: 'INTERNAL', message: 'Style search is down' } }),
      }),
    );
    await typeStyleSearch('Classic');

    await waitFor(() => expect(lookupPanelText()).toContain('Style search is down'));
    expect(lookupOptions()).toHaveLength(0);
  });

  it('EDIT hydrates a saved ACTIVE Style from the Order Sheet itself, then enriches it with LMIX', async () => {
    await renderEditPage(editAdapter(catalog));
    await flush();

    expect(styleInput().value).toContain('ST-001');
    await waitFor(() => expect(styleInput().value).toBe('ST-001 · LMIX5526011 · Classic Tee'));
    expect(sizeInput('M')?.value).toBe('12');
    // No search was needed to show the saved value.
    expect(requestLog.filter((request) => request.url === '/purchase-orders/style-options')).toHaveLength(0);
  });

  it('EDIT keeps a saved INACTIVE Style visible, marked inactive, with its saved quantities', async () => {
    await renderEditPage(
      editAdapter(catalog, { getPO: async (config) => ok(config, { success: true, data: retiredPO }) }),
    );
    await flush();

    await waitFor(() => expect(styleInput().value).toBe('AW24-OLD · LMIX1111111 · Old Hoody (inactive)'));
    expect(container.textContent).toContain('This Style is no longer active');
    expect(sizeInput('M')?.value).toBe('7');

    // Once cleared, the retired Style is not offered as a new selection.
    const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear Style *"]')!;
    await act(async () => clear.click());
    expect(styleInput().value).toBe('');
    expect(sizeInput('M')).toBeNull();
    await typeStyleSearch('LMIX1111');
    await waitFor(() => expect(lookupPanelText()).toContain('No active Styles match'));
  });

  it('the selected Style does not disappear when the search results change', async () => {
    await renderEditPage(editAdapter(catalog));
    await waitFor(() => expect(styleInput().value).toBe('ST-001 · LMIX5526011 · Classic Tee'));

    await typeStyleSearch('SS26-TEE');
    await waitForFreshResults();
    expect(lookupOptions().map((option) => option.textContent ?? '').join()).not.toContain('ST-001');
    await pressKey('Escape');
    await pressKey('Escape');

    expect(styleInput().value).toBe('ST-001 · LMIX5526011 · Classic Tee');
    expect(sizeInput('M')?.value).toBe('12');
  });

  it('moving from one Order Sheet’s edit route to another shows the second Order Sheet’s Style', async () => {
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      requestLog.push({ method: config.method ?? '', url: config.url ?? '', params: config.params });
      const styleResponse = styleEndpoints(config, catalog, {});
      if (styleResponse) return styleResponse;
      if (config.url === '/purchase-orders/po-1') return ok(config, { success: true, data: existingPO });
      if (config.url === '/purchase-orders/po-2') return ok(config, { success: true, data: retiredPO });
      if (config.url === '/financial-years/resolve') return ok(config, { success: true, data: { code: '2026-27' } });
      throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    }) as AxiosAdapter;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/purchase-orders/po-1/edit']}>
          <QueryClientProvider client={queryClient}>
            <NavigateButton to="/purchase-orders/po-2/edit" />
            <Routes>
              <Route path="/purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await waitFor(() => expect(styleInput().value).toBe('ST-001 · LMIX5526011 · Classic Tee'));

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="nav"]')!.click());

    await waitFor(() => expect(styleInput().value).toBe('AW24-OLD · LMIX1111111 · Old Hoody (inactive)'));
    expect(sizeInput('M')?.value).toBe('7');
    expect((document.getElementById('field-remarks') as HTMLInputElement).value).toBe('retired style remarks');
  });

  it('never requests the Style master (GET /styles) in create or edit', async () => {
    await renderPage(baseAdapter(catalog));
    await fillValidStyleLine('ST-001', 'ST-001', 'M');
    act(() => root.unmount());
    root = createRoot(container);
    await renderEditPage(editAdapter(catalog));
    await waitFor(() => expect(styleInput().value).toContain('LMIX5526011'));

    expect(requestLog.length).toBeGreaterThan(0);
    expect(styleMasterRequests()).toEqual([]);
  });
});
