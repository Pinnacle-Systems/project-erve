/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ThemeProvider } from '@erve/theme';
import type { PurchaseOrderDetail } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { JobOrderCreatePage } from './JobOrderCreatePage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('Job Order Process Flow assignment', () => {
  it('selects supported Production and Quality versions and explains unsupported versions', async () => {
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/factories') return ok(config, { success: true, data: [] });
      if (config.url === '/process-flows')
        return ok(config, {
          success: true,
          data: [
            {
              id: 'flow-production',
              code: 'PROD',
              name: 'Production Only',
              description: null,
              status: 'ACTIVE',
              versions: [
                {
                  id: 'version-production',
                  versionNumber: 1,
                  status: 'ACTIVE',
                  hasQualityActivities: false,
                  runtimeSupport: { supported: true, reasons: [] },
                  effectiveFrom: null,
                  createdAt: '2026-01-01T00:00:00.000Z',
                },
              ],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'flow-quality',
              code: 'QUALITY',
              name: 'Quality Flow',
              description: null,
              status: 'ACTIVE',
              versions: [
                {
                  id: 'version-quality',
                  versionNumber: 2,
                  status: 'ACTIVE',
                  hasQualityActivities: true,
                  runtimeSupport: { supported: true, reasons: [] },
                  effectiveFrom: null,
                  createdAt: '2026-01-02T00:00:00.000Z',
                },
              ],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 'flow-unsupported',
              code: 'FUTURE',
              name: 'External Audit Flow',
              description: null,
              status: 'ACTIVE',
              versions: [
                {
                  id: 'version-unsupported',
                  versionNumber: 1,
                  status: 'ACTIVE',
                  hasQualityActivities: true,
                  runtimeSupport: {
                    supported: false,
                    reasons: [
                      'Quality activity "External Audit" uses an unsupported runtime pattern.',
                    ],
                  },
                  effectiveFrom: null,
                  createdAt: '2026-01-03T00:00:00.000Z',
                },
              ],
              createdAt: '2026-01-03T00:00:00.000Z',
              updatedAt: '2026-01-03T00:00:00.000Z',
            },
          ],
        });
      throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    }) satisfies AxiosAdapter;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    act(() => {
      root.render(
        <MemoryRouter>
          <ThemeProvider theme="default" density="comfortable">
            <QueryClientProvider client={queryClient}>
              <JobOrderCreatePage />
            </QueryClientProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await flush();

    expect(container.textContent).toContain(
      'Unsupported versions remain configurable in Process Flow Master but cannot be assigned to new Job Orders.',
    );
    const trigger = container.querySelector<HTMLButtonElement>('#select-process-flow-version');
    expect(trigger).not.toBeNull();
    act(() => trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
    const productionOption = options.find((option) =>
      option.textContent?.includes('Production Only v1'),
    );
    const qualityOption = options.find((option) => option.textContent?.includes('Quality Flow v2'));
    const unsupportedOption = options.find((option) =>
      option.textContent?.includes('External Audit Flow v1'),
    );
    expect(productionOption?.getAttribute('data-disabled')).toBeNull();
    expect(qualityOption?.getAttribute('data-disabled')).toBeNull();
    expect(unsupportedOption?.getAttribute('data-disabled')).not.toBeNull();
    expect(unsupportedOption?.textContent).toContain('External Audit');
  });
});

// ---------------------------------------------------------------------------
// Purchase Order lookup (ERVE-003)
// ---------------------------------------------------------------------------

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly.
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A single long `act(async () => await wait(600))` reliably lets the 300ms
// debounce timer fire, but does NOT reliably flush the React state update
// from the query's fetch promise resolving mid-wait — that update needs its
// own act() boundary. Polling in short steps gives every settled promise a
// fresh boundary to flush into.
async function settle(totalMs: number, stepMs = 20): Promise<void> {
  const iterations = Math.ceil(totalMs / stepMs);
  for (let i = 0; i < iterations; i++) {
    await act(async () => {
      await wait(stepMs);
    });
  }
}

function makePurchaseOrder(overrides: {
  id: string;
  poNumber: string;
  status?: PurchaseOrderDetail['status'];
  distributorName?: string;
  poDate?: string;
}): PurchaseOrderDetail {
  return {
    id: overrides.id,
    poNumber: overrides.poNumber,
    distributor: { id: 'dist-1', code: 'D1', name: overrides.distributorName ?? 'ABC Distributors' },
    financialYear: { id: 'fy-1', code: '2026-2027' },
    poDate: overrides.poDate ?? '2026-08-18T00:00:00.000Z',
    requiredDeliveryDate: null,
    purchaseMode: 'OUTRIGHT',
    status: overrides.status ?? 'SUBMITTED',
    totalOrderedQuantity: 10,
    createdAt: '2026-08-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    merchandiser: null,
    creator: { id: 'user-1', name: 'Admin', email: 'admin@test.local' },
    remarks: null,
    lines: [],
  };
}

function makeBalance(po: PurchaseOrderDetail) {
  return {
    poId: po.id,
    poNumber: po.poNumber,
    version: 1,
    styleFactoryPrices: { 'style-1': 250 },
    lines: [
      {
        lineId: 'line-1',
        styleId: 'style-1',
        styleNumber: 'ST-1',
        styleName: 'Test Style',
        colour: null,
        sizes: [
          {
            purchaseOrderLineSizeId: 'size-1',
            sizeId: 'sz-1',
            sizeCode: 'S',
            sizeLabel: 'Small',
            orderedQuantity: 10,
            jobOrderedQuantity: 0,
            balanceQuantity: 10,
          },
        ],
      },
    ],
  };
}

async function renderJobOrderCreatePage(initialEntries: string[] = ['/job-orders/new']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root.render(
      <MemoryRouter initialEntries={initialEntries}>
        <ThemeProvider theme="default" density="comfortable">
          <QueryClientProvider client={queryClient}>
            <JobOrderCreatePage />
          </QueryClientProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  });
  await flush();
}

function purchaseOrderSearchCalls(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/purchase-orders')
    .map((call) => (call[1] as { params?: { search?: string } } | undefined)?.params?.search);
}

function balanceCalls(): string[] {
  return vi
    .mocked(apiClient.get)
    .mock.calls.map((call) => call[0] as string)
    .filter((url) => url.endsWith('/job-order-balance'));
}

describe('Purchase Order lookup', () => {
  it('searches using the human-readable PO number, debounced, not per keystroke', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 8, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;

    vi.useFakeTimers();
    for (const value of ['E', 'EI', 'EIP', 'EIPO', 'EIPO/', 'EIPO/2', 'EIPO/26', 'EIPO/26-27/0001']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(purchaseOrderSearchCalls().length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    const searches = purchaseOrderSearchCalls();
    expect(searches).toEqual(['EIPO/26-27/0001']);
  });

  it('renders matching results by poNumber with distributor/date/status context, never a raw id', async () => {
    const poA = makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIPO/26-27/0001' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') {
        return { data: { data: { items: [poA], pageInfo: { limit: 8, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(input, 'EIPO/26-27/0001'));
    await settle(600);

    expect(container.textContent).toContain('EIPO/26-27/0001');
    expect(container.textContent).toContain('ABC Distributors');
    expect(container.textContent).not.toContain('po-internal-123');
  });

  it('selecting a result stores the internal id and drives the balance query, not the poNumber', async () => {
    const poA = makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIPO/26-27/0001' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') {
        return { data: { data: { items: [poA], pageInfo: { limit: 8, hasMore: false, nextCursor: null } } } };
      }
      if (url === `/purchase-orders/${poA.id}/job-order-balance`) {
        return { data: { data: makeBalance(poA) } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(input, 'EIPO/26-27/0001'));
    await settle(600);

    const resultButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('EIPO/26-27/0001'),
    )!;
    act(() => resultButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(balanceCalls()).toEqual([`/purchase-orders/${poA.id}/job-order-balance`]);
    expect(balanceCalls().some((url) => url.includes('EIPO'))).toBe(false);
    expect(container.textContent).toContain('EIPO/26-27/0001');
    expect(container.textContent).not.toContain('po-internal-123');
    expect(container.textContent).toContain('Change');
  });

  it('cannot submit from typed-but-unselected search text', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') {
        return {
          data: {
            data: {
              items: [makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIPO/26-27/0001' })],
              pageInfo: { limit: 8, hasMore: false, nextCursor: null },
            },
          },
        };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(input, 'EIPO/26-27/0001'));
    await settle(600);

    // No PO selected yet — the balance query (and therefore the "Create
    // Draft" panel it gates) must never fire off typed search text alone.
    expect(balanceCalls()).toEqual([]);
    expect(container.textContent).toContain('Select a purchase order');
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Create Draft'),
    ).toBe(false);
  });

  it('shows an empty state when no purchase orders match', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 8, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(input, 'ZZZZZ'));
    await settle(600);

    expect(container.textContent).toContain('No matches');
    expect(container.textContent).toContain('No purchase orders match "ZZZZZ"');
  });

  it('shows a loading state while the purchase order search is in flight', async () => {
    let resolveSearch!: (value: {
      items: PurchaseOrderDetail[];
      pageInfo: { limit: number; hasMore: boolean; nextCursor: null };
    }) => void;
    const pendingSearch = new Promise<{
      items: PurchaseOrderDetail[];
      pageInfo: { limit: number; hasMore: boolean; nextCursor: null };
    }>((resolve) => {
      resolveSearch = resolve;
    });

    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') return { data: { data: await pendingSearch } };
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(input, 'EIPO/26-27/0001'));
    await settle(600);

    expect(container.textContent).toContain('Searching purchase orders');

    resolveSearch({
      items: [makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIPO/26-27/0001' })],
      pageInfo: { limit: 8, hasMore: false, nextCursor: null },
    });
    await settle(100);
    expect(container.textContent).not.toContain('Searching purchase orders');
    expect(container.textContent).toContain('EIPO/26-27/0001');
  });

  it('shows an error state when the search fails, without creating a selection', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') throw new Error('Search backend unavailable');
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(input, 'EIPO/26-27/0001'));
    await settle(600);

    expect(container.textContent).toContain('Unable to search purchase orders');
    expect(container.textContent).not.toContain('Change');
    expect(balanceCalls()).toEqual([]);
  });

  it('resets downstream state when the PO is cleared, and can switch to a different PO', async () => {
    const poA = makePurchaseOrder({ id: 'po-internal-a', poNumber: 'EIPO/26-27/0001' });
    const poB = makePurchaseOrder({
      id: 'po-internal-b',
      poNumber: 'EIPO/26-27/0004',
      distributorName: 'XYZ Distributors',
    });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string, config?: { params?: { search?: string } }) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === '/purchase-orders') {
        const search = config?.params?.search ?? '';
        const items = [poA, poB].filter((po) => po.poNumber.includes(search));
        return { data: { data: { items, pageInfo: { limit: 8, hasMore: false, nextCursor: null } } } };
      }
      if (url === `/purchase-orders/${poA.id}/job-order-balance`) {
        return { data: { data: makeBalance(poA) } };
      }
      if (url === `/purchase-orders/${poB.id}/job-order-balance`) {
        return { data: { data: makeBalance(poB) } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();

    async function searchAndSelect(text: string, expectedPoNumber: string) {
      const input = container.querySelector<HTMLInputElement>(
        'input[placeholder="Search by PO number..."]',
      )!;
      act(() => setInputValue(input, text));
      await settle(600);
      const resultButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.includes(expectedPoNumber),
      )!;
      act(() => resultButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await flush();
    }

    await searchAndSelect('EIPO/26-27/0001', 'EIPO/26-27/0001');
    expect(balanceCalls()).toEqual([`/purchase-orders/${poA.id}/job-order-balance`]);

    // Select a style so the "Remaining PO Balance" panel is visible, proving
    // it disappears once the PO is cleared.
    const styleTrigger = document.getElementById('select-style-(one-per-job-order)') as HTMLButtonElement;
    act(() => styleTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const styleOption = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('ST-1 Test Style'),
    )!;
    act(() => styleOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(container.textContent).toContain('Remaining PO Balance');

    const changeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Change',
    )!;
    act(() => changeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(container.textContent).not.toContain('Remaining PO Balance');
    expect(container.textContent).toContain('Select a purchase order');
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Search by PO number..."]'),
    ).not.toBeNull();

    await searchAndSelect('EIPO/26-27/0004', 'EIPO/26-27/0004');
    expect(balanceCalls()).toEqual([
      `/purchase-orders/${poA.id}/job-order-balance`,
      `/purchase-orders/${poB.id}/job-order-balance`,
    ]);
    expect(container.textContent).toContain('EIPO/26-27/0004');
    expect(container.textContent).not.toContain('Remaining PO Balance');
  });

  it('resolves a ?purchaseOrderId= deep link to the internal id without requiring a search', async () => {
    const deepLinkedPo = makePurchaseOrder({ id: 'po-deep-1', poNumber: 'EIPO/26-27/0007' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') return { data: { data: [] } };
      if (url === '/process-flows') return { data: { data: [] } };
      if (url === `/purchase-orders/${deepLinkedPo.id}/job-order-balance`) {
        return { data: { data: makeBalance(deepLinkedPo) } };
      }
      if (url === '/purchase-orders') {
        throw new Error('The deep-link flow must not need to search for the PO');
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage(['/job-orders/new?purchaseOrderId=po-deep-1']);

    expect(balanceCalls()).toEqual([`/purchase-orders/${deepLinkedPo.id}/job-order-balance`]);
    expect(purchaseOrderSearchCalls()).toEqual([]);
    expect(container.textContent).toContain('EIPO/26-27/0007');
    expect(container.textContent).toContain('Change');
    expect(container.textContent).not.toContain('po-deep-1');
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Search by PO number..."]'),
    ).toBeNull();
  });

  it('submits the selected PO internal id, never the poNumber or typed search text', async () => {
    const po = makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIPO/26-27/0001' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories') {
        return {
          data: { data: [{ id: 'factory-1', code: 'F1', name: 'Factory One', status: 'ACTIVE' }] },
        };
      }
      if (url === '/process-flows') {
        return {
          data: {
            data: [
              {
                id: 'flow-1',
                code: 'PF',
                name: 'Standard',
                description: null,
                status: 'ACTIVE',
                versions: [
                  {
                    id: 'pfv-1',
                    versionNumber: 1,
                    status: 'ACTIVE',
                    hasQualityActivities: false,
                    runtimeSupport: { supported: true, reasons: [] },
                    effectiveFrom: null,
                    createdAt: '2026-01-01T00:00:00.000Z',
                  },
                ],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        };
      }
      if (url === '/purchase-orders') {
        return { data: { data: { items: [po], pageInfo: { limit: 8, hasMore: false, nextCursor: null } } } };
      }
      if (url === `/purchase-orders/${po.id}/job-order-balance`) {
        return { data: { data: makeBalance(po) } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'job-order-created-1' } },
    } as never);

    await renderJobOrderCreatePage();

    const factoryTrigger = container.querySelector<HTMLButtonElement>('#select-factory')!;
    act(() => factoryTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const factoryOption = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('Factory One'),
    )!;
    act(() => factoryOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const poInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by PO number..."]',
    )!;
    act(() => setInputValue(poInput, 'EIPO/26-27/0001'));
    await settle(600);
    const poResultButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('EIPO/26-27/0001'),
    )!;
    act(() => poResultButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const styleTrigger = document.getElementById('select-style-(one-per-job-order)') as HTMLButtonElement;
    act(() => styleTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const styleOption = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('ST-1 Test Style'),
    )!;
    act(() => styleOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const quantityInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Quantity for ST-1 Test Style S"]',
    )!;
    act(() => setInputValue(quantityInput, '5'));
    await flush();

    const processFlowTrigger = container.querySelector<HTMLButtonElement>(
      '#select-process-flow-version',
    )!;
    act(() => processFlowTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const processFlowOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes('Standard v1'))!;
    act(() => processFlowOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const submitButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Create Draft',
    )!;
    expect(submitButton.disabled).toBe(false);
    act(() => submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(apiClient.post).mock.calls[0]!;
    const payload = body as { purchaseOrderId: string };
    expect(payload.purchaseOrderId).toBe('po-internal-123');
    expect(payload.purchaseOrderId).not.toBe('EIPO/26-27/0001');
  });
});
