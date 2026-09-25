/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@erve/theme';
import type { PurchaseOrderDetail } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { JobOrderCreatePage } from './JobOrderCreatePage.js';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

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
  distributorName?: string;
  jobOrderId?: string | null;
  orderedQuantity?: number;
  requiredDeliveryDate?: string | null;
  styleId?: string;
  styleNumber?: string;
  styleName?: string;
}): PurchaseOrderDetail {
  const orderedQuantity = overrides.orderedQuantity ?? 10;
  return {
    id: overrides.id,
    poNumber: overrides.poNumber,
    distributor: { id: 'dist-1', code: 'D1', name: overrides.distributorName ?? 'ABC Distributors' },
    financialYear: { id: 'fy-1', code: '2026-2027' },
    poDate: '2026-08-18T00:00:00.000Z',
    requiredDeliveryDate: overrides.requiredDeliveryDate ?? null,
    purchaseMode: 'OUTRIGHT',
    status: 'SUBMITTED',
    jobOrderId: overrides.jobOrderId ?? null,
    lockedByJobOrder: null,
    totalOrderedQuantity: orderedQuantity,
    createdAt: '2026-08-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-08-01T00:00:00.000Z',
    merchandiser: null,
    creator: { id: 'user-1', name: 'Admin', email: 'admin@test.local' },
    remarks: null,
    lines: [
      {
        id: 'line-1',
        styleId: overrides.styleId ?? 'style-1',
        styleNumber: overrides.styleNumber ?? 'ST-1',
        styleName: overrides.styleName ?? 'Test Style',
        lineStatus: 'ACTIVE',
        remarks: null,
        seasonSnapshots: [],
        totalOrderedQuantity: orderedQuantity,
        sizes: [
          {
            id: 'size-1',
            sizeId: 'sz-1',
            sizeCode: 'S',
            sizeLabel: 'Small',
            orderedQuantity,
            saleOrderedQuantity: 0,
            dispatchedQuantity: 0,
            deliveredQuantity: 0,
            actualSoldQuantity: 0,
            returnedQuantity: 0,
            reassignedQuantity: 0,
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

function purchaseOrderStyleFilters(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/purchase-orders')
    .map((call) => (call[1] as { params?: { styleId?: string } } | undefined)?.params?.styleId);
}

function orderSheetDetailCalls(): string[] {
  return vi
    .mocked(apiClient.get)
    .mock.calls.map((call) => call[0] as string)
    .filter((url) => /^\/purchase-orders\/[^/]+$/.test(url));
}

function searchInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(
    'input[placeholder="Search by Order Sheet number..."]',
  )!;
}

async function selectSearchResult(poNumber: string) {
  const resultButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.includes(poNumber),
  )!;
  act(() => resultButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flush();
}

async function searchAndSelect(poNumber: string) {
  act(() => setInputValue(searchInput(), poNumber));
  await settle(600);
  await selectSearchResult(poNumber);
}

// Common non-Order-Sheet endpoints most tests don't care about.
const emptyFactories = { data: { data: [] } };
const emptyProcessFlows = { data: { data: [] } };
// The Production Plan's size columns come from the Style's own canonical
// valid-size list (Phase 2.1) — matches makePurchaseOrder's default
// sizeId/sizeCode/sizeLabel ('sz-1' / 'S' / 'Small') so it renders as an
// editable (ACTIVE) row rather than falling back to the "size inactive"
// display path.
const benignStyleLookup = {
  data: {
    data: {
      id: 'style-1',
      factories: [],
      sizes: [
        {
          id: 'sz-1',
          code: 'S',
          label: 'Small',
          sizeType: 'ALPHA',
          sortOrder: 1,
          status: 'ACTIVE',
          mappingStatus: 'ACTIVE',
        },
      ],
    },
  },
};

describe('Job Order Process Flow assignment', () => {
  it('selects supported Production and Quality versions and explains unsupported versions', async () => {
    const po = makePurchaseOrder({ id: 'po-flow-1', poNumber: 'EIOS/26-27/0009' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/styles/style-1') return benignStyleLookup;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [po], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      if (url === '/process-flows/options') {
        return {
          data: {
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
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await renderJobOrderCreatePage();
    // The Factory Assignment panel (and the Process Flow Version select in
    // it) only renders once at least one Order Sheet has been selected.
    await searchAndSelect('EIOS/26-27/0009');

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
// Order Sheet multi-select (Order Sheet Phase 2, ERVE-003) — one Job Order
// may now consolidate several Order Sheets sharing one Style, so the old
// single-lookup-then-fetch-detail flow was replaced by
// OrderSheetMultiSelectField: search results already carry the full Order
// Sheet detail, selection just appends to a running list, and each source
// gets its own per-size quantity table.
// ---------------------------------------------------------------------------

describe('Order Sheet multi-select', () => {
  it('searches using the human-readable Order Sheet number, debounced, not per keystroke', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    const input = searchInput();
    const callsBeforeTyping = purchaseOrderSearchCalls().length;

    vi.useFakeTimers();
    for (const value of ['E', 'EI', 'EIO', 'EIOS', 'EIOS/', 'EIOS/2', 'EIOS/26', 'EIOS/26-27/0001']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(purchaseOrderSearchCalls().length).toBe(callsBeforeTyping);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    const searches = purchaseOrderSearchCalls();
    expect(searches.at(-1)).toBe('EIOS/26-27/0001');
  });

  it('renders matching results by poNumber with distributor/mode/date context, never a raw id', async () => {
    const poA = makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIOS/26-27/0001' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [poA], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    act(() => setInputValue(searchInput(), 'EIOS/26-27/0001'));
    await settle(600);

    expect(container.textContent).toContain('EIOS/26-27/0001');
    expect(container.textContent).toContain('ABC Distributors');
    expect(container.textContent).toContain('Outright');
    expect(container.textContent).not.toContain('po-internal-123');
  });

  it('selecting a result adds it to the Source Order Sheets table and clears the search text', async () => {
    const poA = makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIOS/26-27/0001' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/styles/style-1') return benignStyleLookup;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [poA], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    await searchAndSelect('EIOS/26-27/0001');

    // Search results already carry the full Order Sheet detail — selecting
    // one must never fetch it again by id.
    expect(orderSheetDetailCalls()).toEqual([]);
    expect(container.textContent).toContain('EIOS/26-27/0001');
    expect(container.textContent).not.toContain('po-internal-123');
    expect(searchInput().value).toBe('');
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Remove'),
    ).toBe(true);
  });

  it('cannot submit from typed-but-unselected search text', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/purchase-orders') {
        return {
          data: {
            data: {
              items: [makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIOS/26-27/0001' })],
              pageInfo: { limit: 10, hasMore: false, nextCursor: null },
            },
          },
        };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    act(() => setInputValue(searchInput(), 'EIOS/26-27/0001'));
    await settle(600);

    // No Order Sheet selected yet — the Factory Assignment / quantities
    // panels (and therefore "Create Draft") must never appear from typed
    // search text alone.
    expect(container.textContent).toContain('Select at least one Order Sheet');
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Create Draft'),
    ).toBe(false);
  });

  it('shows an empty state when no Order Sheets match', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    act(() => setInputValue(searchInput(), 'ZZZZZ'));
    await settle(600);

    expect(container.textContent).toContain('No eligible Order Sheets');
    expect(container.textContent).toContain('No available Order Sheets match this search.');
  });

  it('shows a loading state while the Order Sheet search is in flight', async () => {
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
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/purchase-orders') return { data: { data: await pendingSearch } };
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    act(() => setInputValue(searchInput(), 'EIOS/26-27/0001'));
    await settle(600);

    expect(container.textContent).toContain('Loading Order Sheets');

    resolveSearch({
      items: [makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIOS/26-27/0001' })],
      pageInfo: { limit: 10, hasMore: false, nextCursor: null },
    });
    await settle(100);
    expect(container.textContent).not.toContain('Loading Order Sheets');
    expect(container.textContent).toContain('EIOS/26-27/0001');
  });

  it('shows an error state when the search fails, without creating a selection', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/purchase-orders') throw new Error('Search backend unavailable');
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    act(() => setInputValue(searchInput(), 'EIOS/26-27/0001'));
    await settle(600);

    expect(container.textContent).toContain('Unable to search Order Sheets');
    expect(container.textContent).toContain('Search backend unavailable');
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Remove'),
    ).toBe(false);
  });

  it('removes a selected Order Sheet, clears its quantities, and can select a different one', async () => {
    const poA = makePurchaseOrder({ id: 'po-internal-a', poNumber: 'EIOS/26-27/0001' });
    const poB = makePurchaseOrder({
      id: 'po-internal-b',
      poNumber: 'EIOS/26-27/0004',
      distributorName: 'XYZ Distributors',
    });
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url: string, config?: { params?: { search?: string } }) => {
        if (url === '/factories/options') return emptyFactories;
        if (url === '/process-flows/options') return emptyProcessFlows;
        if (url === '/styles/style-1') return benignStyleLookup;
        if (url === '/purchase-orders') {
          const search = config?.params?.search ?? '';
          const items = [poA, poB].filter((po) => po.poNumber.includes(search));
          return { data: { data: { items, pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
        }
        throw new Error(`Unexpected GET request: ${url}`);
      },
    );

    await renderJobOrderCreatePage();
    await searchAndSelect('EIOS/26-27/0001');
    expect(container.textContent).toContain('Combined Forecast vs Production Plan');

    const removeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Remove',
    )!;
    act(() => removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(container.textContent).not.toContain('Combined Forecast vs Production Plan');
    expect(container.textContent).toContain('Select at least one Order Sheet');
    // The removed Order Sheet is no longer selected (no Remove action left
    // for it) — it may still reappear in the always-live search results
    // below, since removing it makes it available for planning again.
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Remove'),
    ).toBe(false);

    await searchAndSelect('EIOS/26-27/0004');
    expect(container.textContent).toContain('EIOS/26-27/0004');
    expect(container.textContent).toContain('XYZ Distributors');
  });

  it('resolves a ?purchaseOrderId= deep link to a pre-selected Order Sheet without requiring a search', async () => {
    const deepLinkedPo = makePurchaseOrder({ id: 'po-deep-1', poNumber: 'EIOS/26-27/0007' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/styles/style-1') return benignStyleLookup;
      if (url === `/purchase-orders/${deepLinkedPo.id}`) {
        return { data: { data: deepLinkedPo } };
      }
      if (url === '/purchase-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage(['/job-orders/new?purchaseOrderId=po-deep-1']);

    expect(orderSheetDetailCalls()).toEqual([`/purchase-orders/${deepLinkedPo.id}`]);
    expect(container.textContent).toContain('EIOS/26-27/0007');
    expect(container.textContent).not.toContain('po-deep-1');
    // The multi-select search stays available so further Order Sheets can
    // still be added on top of the deep-linked pre-selection.
    expect(searchInput()).not.toBeNull();
  });

  it('pre-fills the Production Plan from the Combined Forecast, allows editing, and submits the new orderSheetIds/sizes payload', async () => {
    const po = makePurchaseOrder({ id: 'po-internal-123', poNumber: 'EIOS/26-27/0001', orderedQuantity: 10 });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') {
        return {
          data: { data: [{ id: 'factory-1', code: 'F1', name: 'Factory One', status: 'ACTIVE' }] },
        };
      }
      if (url === '/process-flows/options') {
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
      if (url === '/styles/style-1') return benignStyleLookup;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [po], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'job-order-created-1' } },
    } as never);

    await renderJobOrderCreatePage();
    await searchAndSelect('EIOS/26-27/0001');

    const factoryTrigger = container.querySelector<HTMLButtonElement>('#select-factory')!;
    act(() => factoryTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const factoryOption = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('Factory One'),
    )!;
    act(() => factoryOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const quantityInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Production quantity for Small"]',
    )!;
    // Pre-filled from the Combined Forecast (10), not empty.
    expect(quantityInput.value).toBe('10');
    // Freely editable beyond the forecast — no remaining-balance cap.
    act(() => setInputValue(quantityInput, '15'));
    await flush();

    const unitPriceInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter factory unit price"]',
    )!;
    act(() => setInputValue(unitPriceInput, '250'));
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
    const payload = body as {
      orderSheetIds: string[];
      sizes: Array<{ sizeId: string; quantity: number }>;
      factoryId: string;
      processFlowVersionId: string;
      unitPrice: string;
    };
    expect(payload.orderSheetIds).toEqual(['po-internal-123']);
    expect(payload.orderSheetIds).not.toContain('EIOS/26-27/0001');
    expect(payload.sizes).toHaveLength(1);
    expect(payload.sizes[0]).toEqual({ sizeId: 'sz-1', quantity: 15 });
    expect(payload.factoryId).toBe('factory-1');
    expect(payload.processFlowVersionId).toBe('pfv-1');
    expect(payload.unitPrice).toBe('250');
  });

  it('supports selecting two Order Sheets of the same Style, enforced via the search filter, and submits one combined Production Plan', async () => {
    const poA = makePurchaseOrder({ id: 'po-multi-a', poNumber: 'EIOS/26-27/0010', orderedQuantity: 10 });
    const poB = makePurchaseOrder({
      id: 'po-multi-b',
      poNumber: 'EIOS/26-27/0011',
      distributorName: 'XYZ Distributors',
      orderedQuantity: 6,
    });
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url: string, config?: { params?: { search?: string } }) => {
        if (url === '/factories/options') {
          return {
            data: { data: [{ id: 'factory-1', code: 'F1', name: 'Factory One', status: 'ACTIVE' }] },
          };
        }
        if (url === '/process-flows/options') {
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
        if (url === '/styles/style-1') return benignStyleLookup;
        if (url === '/purchase-orders') {
          const search = config?.params?.search ?? '';
          const items = [poA, poB].filter((po) => po.poNumber.includes(search));
          return { data: { data: { items, pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
        }
        throw new Error(`Unexpected GET request: ${url}`);
      },
    );
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'job-order-created-2' } },
    } as never);

    await renderJobOrderCreatePage();
    await searchAndSelect('EIOS/26-27/0010');
    await searchAndSelect('EIOS/26-27/0011');

    // Once one Order Sheet is selected, its Style filters every subsequent
    // search — "one Job Order = one Style" is enforced through the request
    // itself, not left for the user to notice.
    expect(purchaseOrderStyleFilters().at(-1)).toBe('style-1');

    expect(container.textContent).toContain('EIOS/26-27/0010');
    expect(container.textContent).toContain('EIOS/26-27/0011');
    expect(container.textContent).toContain('XYZ Distributors');

    const factoryTrigger = container.querySelector<HTMLButtonElement>('#select-factory')!;
    act(() => factoryTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    const factoryOption = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('Factory One'),
    )!;
    act(() => factoryOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const unitPriceInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Enter factory unit price"]',
    )!;
    act(() => setInputValue(unitPriceInput, '300'));
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

    // Combined forecast totals both sources' default quantities (10 + 6).
    const combinedRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Small'),
    )!;
    expect(combinedRow.textContent).toContain('16');

    const submitButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Create Draft',
    )!;
    expect(submitButton.disabled).toBe(false);
    act(() => submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(apiClient.post).mock.calls[0]!;
    const payload = body as {
      orderSheetIds: string[];
      sizes: Array<{ sizeId: string; quantity: number }>;
    };
    expect(payload.orderSheetIds).toEqual(['po-multi-a', 'po-multi-b']);
    // ONE flat production-plan entry per size — never split per source —
    // defaulting to the Combined Forecast total (10 + 6).
    expect(payload.sizes).toHaveLength(1);
    expect(payload.sizes[0]).toEqual({ sizeId: 'sz-1', quantity: 16 });
  });

  it('keeps a manually edited Production Plan quantity when a new source changes the Combined Forecast (§8/§9)', async () => {
    const poA = makePurchaseOrder({ id: 'po-touch-a', poNumber: 'EIOS/26-27/0020', orderedQuantity: 10 });
    const poB = makePurchaseOrder({ id: 'po-touch-b', poNumber: 'EIOS/26-27/0021', orderedQuantity: 15 });
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url: string, config?: { params?: { search?: string } }) => {
        if (url === '/factories/options') return emptyFactories;
        if (url === '/process-flows/options') return emptyProcessFlows;
        if (url === '/styles/style-1') return benignStyleLookup;
        if (url === '/purchase-orders') {
          const search = config?.params?.search ?? '';
          const items = [poA, poB].filter((po) => po.poNumber.includes(search));
          return { data: { data: { items, pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
        }
        throw new Error(`Unexpected GET request: ${url}`);
      },
    );

    await renderJobOrderCreatePage();
    await searchAndSelect('EIOS/26-27/0020');

    const quantityInput = () =>
      container.querySelector<HTMLInputElement>('[aria-label="Production quantity for Small"]')!;
    expect(quantityInput().value).toBe('10');
    act(() => setInputValue(quantityInput(), '4'));
    await flush();
    expect(quantityInput().value).toBe('4');

    await searchAndSelect('EIOS/26-27/0021');

    // Combined Forecast now reflects both sources (10 + 15 = 25)...
    const forecastRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Small'),
    )!;
    expect(forecastRow.textContent).toContain('25');
    // ...but the manually-touched Production Plan quantity is untouched.
    expect(quantityInput().value).toBe('4');
  });

  it('shows a historical forecast size that is no longer an active Style size as read-only, without dropping it', async () => {
    const po = makePurchaseOrder({ id: 'po-inactive-size', poNumber: 'EIOS/26-27/0030' });
    // Style-1 currently maps only 'sz-1' (Small) as ACTIVE — the Order
    // Sheet's own forecast still references a second size ('sz-legacy',
    // 'Large') whose StyleSize mapping has since been removed entirely.
    po.lines[0]!.sizes.push({
      id: 'size-legacy',
      sizeId: 'sz-legacy',
      sizeCode: 'L',
      sizeLabel: 'Large',
      orderedQuantity: 7,
      saleOrderedQuantity: 0,
      dispatchedQuantity: 0,
      deliveredQuantity: 0,
      actualSoldQuantity: 0,
      returnedQuantity: 0,
      reassignedQuantity: 0,
    });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/factories/options') return emptyFactories;
      if (url === '/process-flows/options') return emptyProcessFlows;
      if (url === '/styles/style-1') return benignStyleLookup;
      if (url === '/purchase-orders') {
        return { data: { data: { items: [po], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected GET request: ${url}`);
    });

    await renderJobOrderCreatePage();
    await searchAndSelect('EIOS/26-27/0030');

    // The historical forecast (7) for the inactive size is still shown...
    const largeRow = Array.from(container.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Large'),
    )!;
    expect(largeRow.textContent).toContain('7');
    expect(largeRow.textContent).toContain('Size inactive — cannot be produced');
    // ...but it is never rendered as an editable Production Plan input.
    expect(
      container.querySelector('[aria-label="Production quantity for Large"]'),
    ).toBeNull();
    // The still-active size is unaffected and remains editable.
    expect(
      container.querySelector('[aria-label="Production quantity for Small"]'),
    ).not.toBeNull();
  });
});
