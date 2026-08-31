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

const eligibleStockLine = {
  purchaseOrderLineSizeId: 'pols-1',
  purchaseOrderId: 'po-1',
  poNumber: 'EIPO/26-27/0001',
  styleId: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  sizeId: 'size-1',
  sizeCode: 'M',
  sizeLabel: 'M',
  releasedQuantity: 50,
  committedQuantity: 15,
  availableQuantity: 35,
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
    if (config.url === '/sale-orders/eligible-stock' && config.method === 'get') {
      return ok(config, { success: true, data: [eligibleStockLine] });
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
    expect(container.textContent).not.toContain('No QA-released stock available');
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
