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

const distributor = { id: 'dist-1', code: 'DIST-1', name: 'Acme Distribution', status: 'ACTIVE' };

const styleWithSeasons = {
  id: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  status: 'ACTIVE',
  sizes: [
    { id: 'size-1', code: 'M', label: 'Medium', sizeType: 'ALPHA', sortOrder: 1, status: 'ACTIVE', mappingStatus: 'ACTIVE' },
  ],
  seasons: [{ id: 'season-1', code: 'SS26', name: 'Summer 26', displayName: 'SS26 26-27', status: 'ACTIVE' }],
};

const styleWithoutSeasons = {
  id: 'style-2',
  styleNumber: 'ST-002',
  styleName: 'Winter Jacket',
  status: 'ACTIVE',
  sizes: [
    { id: 'size-2', code: 'L', label: 'Large', sizeType: 'ALPHA', sortOrder: 1, status: 'ACTIVE', mappingStatus: 'ACTIVE' },
  ],
  seasons: [] as unknown[],
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
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save Draft');
  if (!button) throw new Error('Save Draft button not found');
  return button;
}

describe('PurchaseOrderFormPage save error handling', () => {
  it('shows the backend business validation message for the Seasons rule, not the raw Axios error', async () => {
    await renderPage(
      baseAdapter([styleWithSeasons], {
        createPO: async (config) =>
          fail(config, 400, {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Every purchase-order Style must have Seasons assigned',
              details: {},
            },
          }),
      }),
    );

    await fillValidStyleLine('ST-001 - Classic Tee', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Seasons');
    expect(container.textContent).not.toContain('Request failed with status code 400');
    expect(container.textContent).not.toContain('status code');
  });

  it('surfaces a different VALIDATION_ERROR business message without hardcoding only the Seasons case', async () => {
    await renderPage(
      baseAdapter([styleWithSeasons], {
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
    await renderPage(baseAdapter([styleWithSeasons], { createPO: async () => networkFail() }));

    await fillValidStyleLine('ST-001 - Classic Tee', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Unable to save the Purchase Order');
    expect(container.textContent).not.toContain('Request failed with status code');
    expect(container.textContent).not.toContain('Network Error');
  });

  it('saves the draft successfully and navigates away when the request is valid', async () => {
    await renderPage(baseAdapter([styleWithSeasons]));

    await fillValidStyleLine('ST-001 - Classic Tee', 'M');
    await act(async () => submitButton().click());
    await flush();

    expect(container.textContent).toContain('Purchase Order Detail Page');
    expect(container.textContent).not.toContain('Unable to save');
  });
});

describe('PurchaseOrderFormPage proactive Seasons validation', () => {
  it('shows no warning for a Style that already has Seasons assigned', async () => {
    await renderPage(baseAdapter([styleWithSeasons]));

    await selectOption('Style *', 'ST-001 - Classic Tee');
    await flush();

    expect(container.textContent).not.toContain('has no Seasons assigned');
    expect(submitButton().disabled).toBe(false);
  });

  it('warns and blocks submission for a Style with no Seasons assigned', async () => {
    let createCalled = false;
    await renderPage(
      baseAdapter([styleWithoutSeasons], {
        createPO: async (config) => {
          createCalled = true;
          return ok(config, { success: true, data: { id: 'po-1' } });
        },
      }),
    );

    await selectOption('Distributor *', 'Acme Distribution');
    await flush();
    await selectOption('Style *', 'ST-002 - Winter Jacket');
    await flush();

    expect(container.textContent).toContain('has no Seasons assigned');
    expect(submitButton().disabled).toBe(true);

    await act(async () => submitButton().click());
    await flush();

    expect(createCalled).toBe(false);
  });
});
