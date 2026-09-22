/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const testStyle = {
  id: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  status: 'ACTIVE',
  sizes: [
    { id: 'size-1', code: 'M', label: 'Medium', sizeType: 'ALPHA', sortOrder: 1, status: 'ACTIVE', mappingStatus: 'ACTIVE' },
  ],
  season: { id: 'season-1', code: 'SS26', name: 'Summer 26', displayName: 'SS26 26-27', status: 'ACTIVE' },
};

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

function triggerByLabel(labelText: string): HTMLButtonElement {
  const label = Array.from(container.querySelectorAll('label')).find((el) => el.textContent === labelText);
  if (!label) throw new Error(`Label "${labelText}" not found`);
  const id = label.getAttribute('for');
  const el = id ? (document.getElementById(id) as HTMLButtonElement | null) : null;
  if (!el) throw new Error(`Trigger for label "${labelText}" not found`);
  return el;
}

async function selectOption(labelText: string, optionText: string): Promise<void> {
  await act(async () => triggerByLabel(labelText).click());
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`Option "${optionText}" not found for "${labelText}"`);
  await act(async () => option.click());
}

interface AdapterOverrides {
  createPO?: AxiosAdapter;
}

function baseAdapter(styles: unknown[], overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/distributors' && config.method === 'get') {
      return ok(config, { success: true, data: [distributor] });
    }
    if (config.url === '/styles' && config.method === 'get') {
      return ok(config, { success: true, data: styles });
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
      remarks: '',
      sizes: [{ sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', orderedQuantity: 12 }],
    },
  ],
};

interface EditAdapterOverrides {
  getPO?: AxiosAdapter;
  patchPO?: AxiosAdapter;
}

function editAdapter(styles: unknown[], overrides: EditAdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/purchase-orders/po-1' && config.method === 'get') {
      return overrides.getPO ? overrides.getPO(config) : ok(config, { success: true, data: existingPO });
    }
    if (config.url === '/distributors' && config.method === 'get') {
      return ok(config, { success: true, data: [distributor] });
    }
    if (config.url === '/styles' && config.method === 'get') {
      return ok(config, { success: true, data: styles });
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

async function fillValidStyleLine(styleOption: string, sizeLabel: string): Promise<void> {
  await selectOption('Distributor *', 'Acme Distribution');
  await flush();
  await selectOption('Style *', styleOption);
  await flush();
  const qtyInput = document.getElementById(`field-${sizeLabel.toLowerCase()}`) as HTMLInputElement | null;
  if (!qtyInput) throw new Error(`Quantity input for size "${sizeLabel}" not found`);
  setInputValue(qtyInput, '5');
}

function submitButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save');
  if (!button) throw new Error('Save button not found');
  return button;
}

describe('PurchaseOrderFormPage save error handling', () => {
  it('surfaces a VALIDATION_ERROR business message rather than the raw Axios error', async () => {
    await renderPage(
      baseAdapter([testStyle], {
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

    await fillValidStyleLine('ST-001 - Classic Tee', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Required delivery date cannot be before the PO date');
    expect(container.textContent).not.toContain('Request failed with status code 400');
  });

  it('falls back to a generic message when the API provides no usable business message', async () => {
    await renderPage(baseAdapter([testStyle], { createPO: async () => networkFail() }));

    await fillValidStyleLine('ST-001 - Classic Tee', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Unable to save the Order Sheet');
    expect(container.textContent).not.toContain('Request failed with status code');
    expect(container.textContent).not.toContain('Network Error');
  });

  it('saves the draft successfully and navigates away when the request is valid', async () => {
    await renderPage(baseAdapter([testStyle]));

    await fillValidStyleLine('ST-001 - Classic Tee', 'M');
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
    await renderPage(baseAdapter([testStyle]));

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
      editAdapter([testStyle], {
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
      editAdapter([testStyle], {
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
    await renderEditPage(editAdapter([testStyle]));
    // Two independent queries (Order Sheet GET, active Styles GET) must both
    // resolve, plus the deferred hydration macrotask, before the form
    // reflects the loaded Order Sheet.
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
    expect(document.getElementById('select-style-*')?.textContent).toContain('Classic Tee');

    const save = saveButton();
    expect(save).not.toBeNull();
    await act(async () => save!.click());
    await flush();

    expect(container.textContent).toContain('Purchase Order Detail Page');
  });

  it('does not re-hydrate and clobber an in-progress edit when poQuery refetches in the background (e.g. a reconnect)', async () => {
    let getCallCount = 0;
    const queryClient = await renderEditPage(
      editAdapter([testStyle], {
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
