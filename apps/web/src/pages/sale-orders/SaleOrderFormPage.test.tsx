/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { SaleOrderFormPage } from './SaleOrderFormPage.js';

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

const distributor = { id: 'dist-1', code: 'DIST-1', name: 'Acme Distribution', status: 'ACTIVE' };

const draftSaleOrder = {
  id: 'so-1',
  saleOrderNumber: 'EISO/26-27/0001',
  distributor,
  financialYear: { id: 'fy-1', code: '2026-27' },
  soDate: '2026-08-27T00:00:00.000Z',
  status: 'DRAFT',
  creator: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
  reviewedBy: null,
  remarks: 'Please expedite',
  submittedAt: null,
  reviewedAt: null,
  decisionReason: null,
  lines: [
    {
      id: 'line-1',
      purchaseOrderLineSizeId: 'pols-1',
      purchaseOrderId: 'po-1',
      poNumber: 'EIPO/26-27/0001',
      styleId: 'style-1',
      styleNumber: 'ST-001',
      styleName: 'Classic Tee',
      sizeId: 'size-1',
      sizeCode: 'M',
      sizeLabel: 'M',
      orderedQuantity: 300,
      qaPassedQuantity: 50,
      requestedQuantity: 15,
      approvedQuantity: null,
      remarks: null,
      allocations: [],
    },
  ],
  totalRequestedQuantity: 15,
  totalApprovedQuantity: 0,
  createdAt: '2026-08-27T02:00:00.000Z',
  version: 1,
};

const requestableCatalogLine = {
  purchaseOrderLineSizeId: 'pols-1',
  purchaseOrderId: 'po-1',
  poNumber: 'EIPO/26-27/0001',
  styleId: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  sizeId: 'size-1',
  sizeCode: 'M',
  sizeLabel: 'M',
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

interface AdapterOverrides {
  distributorsCalls?: number[];
  patch?: AxiosAdapter;
}

function editAdapter(overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/sale-orders/so-1' && config.method === 'get') {
      return ok(config, { success: true, data: draftSaleOrder });
    }
    if (config.url === '/sale-orders/requestable-catalog' && config.method === 'get') {
      return ok(config, { success: true, data: [requestableCatalogLine] });
    }
    if (config.url === '/distributors' && config.method === 'get') {
      overrides.distributorsCalls?.push(1);
      return ok(config, { success: true, data: [distributor] });
    }
    if (config.url === '/sale-orders/so-1' && config.method === 'patch') {
      return overrides.patch
        ? overrides.patch(config)
        : ok(config, { success: true, data: { ...draftSaleOrder, totalRequestedQuantity: 22 } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

async function renderEditPage(adapter: AxiosAdapter): Promise<void> {
  apiClient.defaults.adapter = adapter;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/sale-orders/so-1/edit']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/sale-orders/:id/edit" element={<SaleOrderFormPage />} />
            <Route path="/sale-orders/:id" element={<div>Sale Order Detail Page</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
}

function qtyInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label*="Requested quantity"]');
  if (!input) throw new Error('Requested quantity input not found');
  return input;
}

function saveButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save Changes');
  if (!button) throw new Error('Save Changes button not found');
  return button;
}

describe('SaleOrderFormPage edit hydration', () => {
  it('hydrates Distributor, Sale Order Date, Remarks, and Requested Qty from the loaded DRAFT record', async () => {
    await renderEditPage(editAdapter());

    const distributorInput = Array.from(container.querySelectorAll('input')).find(
      (i) => i.value === 'Acme Distribution',
    );
    expect(distributorInput).toBeTruthy();
    expect(container.textContent).not.toContain('Select a distributor');
    expect(container.textContent).not.toContain('No orderable styles/sizes found');
    expect(qtyInput().value).toBe('15');

    const remarksInput = Array.from(container.querySelectorAll('input')).find(
      (i) => i.value === 'Please expedite',
    );
    expect(remarksInput).toBeTruthy();
  });

  it('never requests the selectable-distributor list while editing (Distributor is immutable on edit)', async () => {
    const distributorsCalls: number[] = [];
    await renderEditPage(editAdapter({ distributorsCalls }));

    expect(distributorsCalls.length).toBe(0);
  });

  it('saves an edited requested quantity and navigates to the detail page', async () => {
    let patchedQuantity: number | undefined;
    await renderEditPage(
      editAdapter({
        patch: async (config) => {
          const lines = JSON.parse(config.data as string).lines as { requestedQuantity: number }[];
          patchedQuantity = lines[0]?.requestedQuantity;
          return ok(config, { success: true, data: { ...draftSaleOrder, totalRequestedQuantity: 22 } });
        },
      }),
    );

    setInputValue(qtyInput(), '22');
    await act(async () => saveButton().click());
    await flush();

    expect(patchedQuantity).toBe(22);
    expect(container.textContent).toContain('Sale Order Detail Page');
  });
});

function createAdapter(overrides: { post?: AxiosAdapter } = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/distributors' && config.method === 'get') {
      return ok(config, { success: true, data: [distributor] });
    }
    if (config.url === '/sale-orders/requestable-catalog' && config.method === 'get') {
      return ok(config, { success: true, data: [requestableCatalogLine] });
    }
    if (config.url === '/sale-orders' && config.method === 'post') {
      return overrides.post
        ? overrides.post(config)
        : ok(config, { success: true, data: { ...draftSaleOrder, id: 'so-2' } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

async function renderCreatePage(adapter: AxiosAdapter): Promise<void> {
  apiClient.defaults.adapter = adapter;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/sale-orders/new']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/sale-orders/new" element={<SaleOrderFormPage />} />
            <Route path="/sale-orders/:id" element={<div>Sale Order Detail Page</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  await flush();
}

function triggerByLabel(labelText: string): HTMLButtonElement {
  const label = Array.from(container.querySelectorAll('label')).find((el) => el.textContent === labelText);
  if (!label) throw new Error(`Label "${labelText}" not found`);
  const id = label.getAttribute('for');
  const el = id ? (document.getElementById(id) as HTMLButtonElement | null) : null;
  if (!el) throw new Error(`Trigger for "${labelText}" not found`);
  return el;
}

// Radix Select renders its option list in a body-level portal, not inside
// `container` — query document.body, not container, for [role="option"].
async function selectOption(labelText: string, optionText: string): Promise<void> {
  await act(async () => triggerByLabel(labelText).click());
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`Option "${optionText}" not found for "${labelText}"`);
  await act(async () => option.click());
}

function createSubmitButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Create Sale Order');
  if (!button) throw new Error('Create Sale Order button not found');
  return button;
}

// The distributor demand-request enhancement: a Distributor with zero (or
// insufficient) own QA-released stock must still be able to open the create
// form, see their orderable styles/sizes (sourced from their own PO
// line/sizes via the requestable-catalog endpoint, never from
// QaReleaseLine/eligible-stock), and submit a quantity with no
// stock-availability number shown anywhere on the page.
describe('SaleOrderFormPage create — demand request without stock', () => {
  it('shows the requestable catalog once a distributor is selected, with no stock/availability quantity anywhere', async () => {
    await renderCreatePage(createAdapter());
    await selectOption('Distributor', 'Acme Distribution');
    await flush();

    expect(container.textContent).toContain('ST-001');
    expect(container.textContent).toContain('Classic Tee');
    // No own-stock or central-stock figure is shown — the catalog carries no
    // quantity field at all, matching the demand-oriented UX (Style/Size/
    // Requested quantity only).
    expect(container.textContent).not.toContain('QA Released');
    expect(container.textContent).not.toContain('Committed');
    expect(container.textContent).not.toContain('Available');
    expect(container.textContent).not.toContain('No orderable styles/sizes found');
  });

  it('lets a distributor enter and submit a requested quantity with no stock backing it', async () => {
    let posted: { distributorId?: string; lines?: { requestedQuantity: number }[] } | undefined;
    await renderCreatePage(
      createAdapter({
        post: async (config) => {
          posted = JSON.parse(config.data as string);
          return ok(config, { success: true, data: { ...draftSaleOrder, id: 'so-2' } });
        },
      }),
    );
    await selectOption('Distributor', 'Acme Distribution');
    await flush();

    setInputValue(qtyInput(), '999');
    await act(async () => createSubmitButton().click());
    await flush();

    expect(posted?.distributorId).toBe(distributor.id);
    expect(posted?.lines?.[0]).toMatchObject({ requestedQuantity: 999 });
    expect(container.textContent).toContain('Sale Order Detail Page');
  });
});
