/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import type {
  AuthUser,
  RetailStoreInventoryMeasures,
  RetailStoreInventorySaleReturnPosition,
  Role,
  SaleOrReturnStockSource,
  SaleOrReturnStockStoreBreakdown,
  SaleOrReturnStockStyleDetail,
  SaleOrReturnStockStyleSummary,
} from '@erve/types';
import { apiClient } from '../../../lib/api-client.js';
import * as AuthContext from '../../../auth/AuthContext.js';
import { SaleOrReturnStockPage } from './SaleOrReturnStockPage.js';
import { SaleOrReturnStyleDetailPage } from './SaleOrReturnStyleDetailPage.js';

let container: HTMLDivElement;
let root: Root;

function mockAuth(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
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

const wait = (ms = 20) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const settle = async () => {
  await wait();
  await wait();
};
const content = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll('button'));
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
const click = async (element: Element | undefined) => {
  expect(element).toBeDefined();
  await act(async () => (element as HTMLElement).click());
  await settle();
};

// ---- fixtures ---------------------------------------------------------------

const saleReturn = (o: Partial<RetailStoreInventorySaleReturnPosition> = {}): RetailStoreInventorySaleReturnPosition => ({
  actualSoldQuantity: 10,
  returnedQuantity: 5,
  approvedAwaitingReceiptQuantity: 0,
  pendingRequestedQuantity: 0,
  remainingWithDistributor: 75,
  availableForActualSale: 75,
  availableForNewReturn: 75,
  ...o,
});

function measures(o: Partial<RetailStoreInventoryMeasures> = {}): RetailStoreInventoryMeasures {
  return {
    sourceCount: 3,
    shippedQuantity: 100,
    awaitingConfirmationQuantity: 0,
    attestedShippedQuantity: 100,
    attestedReceivedQuantity: 90,
    shortageQuantity: 0,
    ledgerQuantity: 90,
    ledgerBySource: { distributorConfirmed: 90, userConfirmed: 0, legacyAssumedFullReceipt: 0, unspecified: 0 },
    discrepancySourceCount: 0,
    saleReturn: saleReturn(),
    ...o,
  };
}

function styleSummary(o: Partial<SaleOrReturnStockStyleSummary> = {}): SaleOrReturnStockStyleSummary {
  return {
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    primaryImage: null,
    distributorCount: 2,
    storeCount: 3,
    measures: measures(),
    ...o,
  };
}

const stylesBody = (items: SaleOrReturnStockStyleSummary[], pageInfo = { limit: 25, hasMore: false, nextCursor: null as string | null }) => ({
  items,
  summary: { styleCount: items.length, distributorCount: 2, storeCount: 3, measures: measures({ shippedQuantity: 555 }) },
  pageInfo,
});

function detailBody(o: Partial<SaleOrReturnStockStyleDetail> = {}): SaleOrReturnStockStyleDetail {
  return {
    card: {
      cardKey: 'style-1:SALE_RETURN',
      styleId: 'style-1',
      styleNumber: 'ST-001',
      styleName: 'Classic Tee',
      primaryImage: null,
      purchaseMode: 'SALE_RETURN',
      sizes: [
        { sizeId: 'size-m', sizeCode: 'M', sizeLabel: 'Medium', sortOrder: 2, active: true },
        { sizeId: 'size-l', sizeCode: 'L', sizeLabel: 'Large', sortOrder: 3, active: true },
      ],
      cells: {
        'size-m': measures({ shippedQuantity: 60, ledgerQuantity: 50 }),
        'size-l': measures({ shippedQuantity: 40, ledgerQuantity: null, attestedReceivedQuantity: null }),
      },
      total: measures({ shippedQuantity: 100, ledgerQuantity: 50, saleReturn: saleReturn({ approvedAwaitingReceiptQuantity: 7, pendingRequestedQuantity: 4 }) }),
    },
    distributors: [
      { distributor: { id: 'dist-A', code: 'DIST-A', name: 'Distributor A' }, storeCount: 2, measures: measures({ shippedQuantity: 70 }) },
      { distributor: { id: 'dist-B', code: 'DIST-B', name: 'Distributor B' }, storeCount: 1, measures: measures({ shippedQuantity: 30 }) },
    ],
    ...o,
  };
}

function storeRow(o: Partial<SaleOrReturnStockStoreBreakdown> = {}): SaleOrReturnStockStoreBreakdown {
  return {
    storeKey: 'S:store-1',
    mapped: true,
    retailStoreId: 'store-1',
    code: 'ST1',
    name: 'Central Mall',
    city: 'Chennai',
    state: 'TN',
    status: 'ACTIVE',
    distributor: { id: 'dist-A', code: 'DIST-A', name: 'Distributor A' },
    measures: measures({ shippedQuantity: 25 }),
    ...o,
  };
}

function sourceRow(o: Partial<SaleOrReturnStockSource> = {}): SaleOrReturnStockSource {
  return {
    erveDispatchId: 'ed-1',
    erveDispatchNumber: 'EIED/26-27/0001',
    dispatchDate: '2026-08-01T00:00:00.000Z',
    ervePackingListNumber: 'EIPL/26-27/0001',
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    saleOrderLineId: 'sol-1',
    purchaseMode: 'SALE_RETURN',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeId: 'size-m',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    dispatchDestination: { label: 'Central Mall', storeCode: 'ST1', addressLine1: null, city: 'Chennai', state: 'TN', postalCode: null },
    orderDestination: { destinationId: 'dest-1', retailStoreId: 'store-1', label: 'Central Mall', storeCode: 'ST1', addressLine1: null, city: 'Chennai', state: 'TN', postalCode: null },
    shippedQuantity: 20,
    receipt: { status: 'ATTESTED', receivedQuantity: 18, receivedAt: '2026-08-03T00:00:00.000Z', ledgerDisposition: 'EVIDENCE_ONLY_EXISTING' },
    ledger: { quantity: 20, source: 'USER_CONFIRMED' },
    shortageQuantity: 2,
    discrepancy: true,
    qr: { cartonCount: 1, confirmedCartonCount: 1 },
    saleReturn: saleReturn({ actualSoldQuantity: 5, returnedQuantity: 2, approvedAwaitingReceiptQuantity: 3, pendingRequestedQuantity: 4, remainingWithDistributor: 13, availableForActualSale: 10, availableForNewReturn: 6 }),
    distributor: { id: 'dist-A', code: 'DIST-A', name: 'Distributor A' },
    storeKey: 'S:store-1',
    ...o,
  };
}

function notFound(): AxiosError {
  return new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 404,
    statusText: 'Not Found',
    data: { error: { message: 'No Sale-or-Return stock found for this Style' } },
    headers: {},
    config: {} as never,
  });
}

const OPTIONS = [
  { id: 'dist-A', code: 'DIST-A', name: 'Distributor A', status: 'ACTIVE' as const },
  { id: 'dist-B', code: 'DIST-B', name: 'Distributor B', status: 'INACTIVE' as const },
];
function distributorGet(url: string) {
  const byId = url.match(/^\/distributors\/options\/(.+)$/);
  if (byId) {
    const found = OPTIONS.find((option) => option.id === decodeURIComponent(byId[1]!));
    return found ? Promise.resolve({ data: { data: found } }) : Promise.reject(notFound());
  }
  if (url === '/distributors/options') return Promise.resolve({ data: { data: OPTIONS } });
  return null;
}

type GetImpl = (url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: { data: unknown } }>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

async function renderAt(role: Role, initialUrl: string, getImpl: GetImpl) {
  mockAuth(role);
  const getSpy = vi.spyOn(apiClient, 'get').mockImplementation(((url: string, config?: { params?: Record<string, unknown> }) => {
    return distributorGet(url) ?? getImpl(url, config);
  }) as never);
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <LocationProbe />
          <Routes>
            <Route path="/fulfillment/sale-or-return" element={<SaleOrReturnStockPage />} />
            <Route path="/fulfillment/sale-or-return/styles/:styleId" element={<SaleOrReturnStyleDetailPage />} />
            <Route path="/fulfillment/sale-or-return/by-dispatch" element={<div>By dispatch screen</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  await settle();
  return { getSpy };
}

const stockCalls = (spy: { mock: { calls: unknown[][] } }, path: string) =>
  spy.mock.calls.filter((call) => call[0] === path).map((call) => (call[1] as { params?: Record<string, unknown> } | undefined)?.params ?? {});
const hasDistributorField = () => container.querySelector('input[placeholder="All Distributors"]') !== null;
const locationText = () => container.querySelector('[data-testid="location"]')!.textContent;

// ---- Level 1 ----------------------------------------------------------------

describe('SaleOrReturnStockPage — Style-first consolidated list', () => {
  const listImpl =
    (items: SaleOrReturnStockStyleSummary[] = [styleSummary()]): GetImpl =>
    async (url) => {
      if (url === '/sale-or-return-stock/styles') return ok(stylesBody(items));
      throw new Error(`Unexpected GET: ${url}`);
    };

  it('DISTRIBUTOR: no Distributor selector, requests carry no distributorId, one row per Style with the stock figures', async () => {
    const { getSpy } = await renderAt('DISTRIBUTOR', '/fulfillment/sale-or-return', listImpl());
    expect(hasDistributorField()).toBe(false);
    const calls = stockCalls(getSpy, '/sale-or-return-stock/styles');
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('distributorId');
    const rows = container.querySelectorAll('[data-testid="stock-style"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('ST-001');
    expect(rows[0]!.textContent).toContain('Classic Tee');
    for (const label of ['Dispatched', 'Received ledger', 'Sold', 'Returned', 'Remaining', 'Available to sell']) {
      expect(rows[0]!.textContent).toContain(label);
    }
    // The all-Styles summary is shown separately from the rows.
    expect(content()).toContain('All Styles');
    expect(content()).toContain('555');
  });

  it('DISTRIBUTOR: keeps the Report Sold / Request Return entry point (by Dispatch)', async () => {
    await renderAt('DISTRIBUTOR', '/fulfillment/sale-or-return', listImpl());
    expect(buttonByText('Report Sold / Request Return by Dispatch')).toBeDefined();
    expect(buttonByText('Report History')).toBeDefined();
    expect(buttonByText('Return History')).toBeDefined();
    await click(buttonByText('Report Sold / Request Return by Dispatch'));
    expect(content()).toContain('By dispatch screen');
  });

  it('MERCHANDISER: all Distributors by default, with a read-only Dispatch-wise link and no submit actions', async () => {
    const { getSpy } = await renderAt('MERCHANDISER', '/fulfillment/sale-or-return', listImpl());
    expect(hasDistributorField()).toBe(true);
    expect(stockCalls(getSpy, '/sale-or-return-stock/styles')[0]).not.toHaveProperty('distributorId');
    expect(buttonByText('Dispatch-wise positions')).toBeDefined();
    expect(buttonByText('Report Sold / Request Return by Dispatch')).toBeUndefined();
    expect(buttonByText('Report History')).toBeUndefined();
    expect(buttonByText('Clear Distributor filter (show all Distributors)')).toBeUndefined();
  });

  it('ADMIN: optional Distributor filter from the URL narrows the request; clearing it returns to all Distributors', async () => {
    const { getSpy } = await renderAt('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', listImpl());
    const calls = stockCalls(getSpy, '/sale-or-return-stock/styles');
    expect(calls.at(-1)).toMatchObject({ distributorId: 'dist-A' });
    expect(buttonByText('Clear Distributor filter (show all Distributors)')).toBeDefined(); // the filter resolved

    await click(buttonByText('Clear Distributor filter (show all Distributors)'));
    expect(locationText()).toBe('/fulfillment/sale-or-return');
    const after = stockCalls(getSpy, '/sale-or-return-stock/styles');
    expect(after.at(-1)).not.toHaveProperty('distributorId');
    expect(buttonByText('Clear Distributor filter (show all Distributors)')).toBeUndefined();
  });

  it('ADMIN keeps the transactional per-Dispatch entry point and carries the selected Distributor to it', async () => {
    await renderAt('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', listImpl());
    // Admin can submit Sales Reports and Returns, so the by-Dispatch screen is offered with its Distributor context.
    await click(buttonByText('Report Sold / Request Return by Dispatch'));
    expect(locationText()).toBe('/fulfillment/sale-or-return/by-dispatch?distributorId=dist-A');
  });

  it('a stale distributorId in the URL is never sent: it asks for a valid Distributor and issues no stock request', async () => {
    const { getSpy } = await renderAt('MERCHANDISER', '/fulfillment/sale-or-return?distributorId=unknown', listImpl());
    expect(content()).toContain('Select a valid Distributor');
    expect(stockCalls(getSpy, '/sale-or-return-stock/styles')).toHaveLength(0);
    await click(buttonByText('Clear Distributor filter'));
    expect(stockCalls(getSpy, '/sale-or-return-stock/styles')).toHaveLength(1);
  });

  it('ACCOUNTANT / SENIOR_MANAGEMENT: consolidated read, no selector, no submit actions', async () => {
    for (const role of ['ACCOUNTANT', 'SENIOR_MANAGEMENT'] as const) {
      const { getSpy } = await renderAt(role, '/fulfillment/sale-or-return', listImpl());
      expect(stockCalls(getSpy, '/sale-or-return-stock/styles')[0]).not.toHaveProperty('distributorId');
      expect(buttonByText('Report Sold / Request Return by Dispatch')).toBeUndefined();
      expect(buttonByText('Report History')).toBeUndefined();
      act(() => root.unmount());
      root = createRoot(container);
      vi.restoreAllMocks();
    }
  });

  it('shows missing evidence as n/r (not recorded), never as 0, and keeps pending / approved returns and evidence notes visible', async () => {
    const row = styleSummary({
      measures: measures({
        ledgerQuantity: null,
        attestedReceivedQuantity: null,
        shortageQuantity: null,
        awaitingConfirmationQuantity: 30,
        saleReturn: saleReturn({ approvedAwaitingReceiptQuantity: 7, pendingRequestedQuantity: 4, actualSoldQuantity: 0, returnedQuantity: 0, remainingWithDistributor: 0, availableForActualSale: 0 }),
      }),
    });
    await renderAt('MERCHANDISER', '/fulfillment/sale-or-return', listImpl([row]));
    const card = container.querySelector('[data-testid="stock-style"]')!;
    const stat = (label: string) => Array.from(card.querySelectorAll('dt')).find((dt) => dt.textContent === label)!.nextElementSibling!.textContent;
    expect(stat('Received ledger')).toContain('n/r');
    expect(stat('Received ledger')).toContain('Not recorded');
    expect(stat('Remaining')).toBe('0'); // a genuine computed zero stays a number
    expect(card.textContent).toContain('4 pcs in pending return requests');
    expect(card.textContent).toContain('7 pcs in approved returns awaiting receipt');
    expect(card.textContent).toContain('30 pcs awaiting Distributor receipt evidence');
  });

  it('searches Styles on the server (debounced) and paginates on Styles with Load more', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const impl: GetImpl = async (url, config) => {
      if (url !== '/sale-or-return-stock/styles') throw new Error(`Unexpected GET: ${url}`);
      const params = config?.params ?? {};
      calls.push(params);
      if (params.style) return ok(stylesBody([styleSummary({ styleId: 'style-9', styleNumber: 'ST-009' })]));
      if (params.cursor === 'CUR1') return ok(stylesBody([styleSummary({ styleId: 'style-2', styleNumber: 'ST-002' })]));
      return ok(stylesBody([styleSummary()], { limit: 25, hasMore: true, nextCursor: 'CUR1' }));
    };
    await renderAt('MERCHANDISER', '/fulfillment/sale-or-return', impl);
    await click(buttonByText('Load more'));
    expect(calls.at(-1)).toMatchObject({ cursor: 'CUR1' });
    expect(Array.from(container.querySelectorAll('[data-testid="stock-style"]')).map((el) => el.getAttribute('aria-label'))).toEqual(['ST-001', 'ST-002']);
    expect(content()).toContain('Showing 2 Styles (all loaded)');
    // Whole-result totals still come from the first page's summary, not from the rows loaded.
    expect(content()).toContain('555');

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Style number or name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'ST-009');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(450);
    await settle();
    expect(calls.at(-1)).toMatchObject({ style: 'ST-009' });
    expect(Array.from(container.querySelectorAll('[data-testid="stock-style"]')).map((el) => el.getAttribute('aria-label'))).toEqual(['ST-009']);
  });

  it('links a Style to its detail, keeping the Distributor filter', async () => {
    await renderAt('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', listImpl());
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'ST-001')!;
    expect(link.getAttribute('href')).toBe('/fulfillment/sale-or-return/styles/style-1?distributorId=dist-A');
  });

  it('distinguishes loading, empty and error states', async () => {
    await renderAt('MERCHANDISER', '/fulfillment/sale-or-return', async () => ok(stylesBody([])));
    expect(content()).toContain('No Sale-or-Return stock');
    act(() => root.unmount());
    root = createRoot(container);
    vi.restoreAllMocks();
    await renderAt('MERCHANDISER', '/fulfillment/sale-or-return', async () => {
      throw new Error('boom');
    });
    expect(content()).toContain('Unable to load Sale-or-Return stock');
    expect(content()).not.toContain('No Sale-or-Return stock');
  });
});

// ---- Levels 2-4 -------------------------------------------------------------

describe('SaleOrReturnStyleDetailPage — Size matrix, Distributor / Store and Dispatch drilldown', () => {
  const calls = { detail: [] as Array<Record<string, unknown>>, stores: [] as Array<Record<string, unknown>>, sources: [] as Array<Record<string, unknown>> };
  const reset = () => {
    calls.detail.length = 0;
    calls.stores.length = 0;
    calls.sources.length = 0;
  };
  const impl =
    (o: { detail?: () => Promise<{ data: { data: unknown } }>; sourcePages?: SaleOrReturnStockSource[][] } = {}): GetImpl =>
    async (url, config) => {
      const params = config?.params ?? {};
      if (url === '/sale-or-return-stock/styles/style-1') {
        calls.detail.push(params);
        return o.detail ? o.detail() : ok(detailBody());
      }
      if (url === '/sale-or-return-stock/styles/style-1/stores') {
        calls.stores.push(params);
        return ok({
          items: [
            storeRow(),
            storeRow({ storeKey: 'D:dest-9', mapped: false, retailStoreId: null, code: null, name: 'Old warehouse', city: null, state: null, status: null, measures: measures({ shippedQuantity: 5 }) }),
          ],
        });
      }
      if (url === '/sale-or-return-stock/styles/style-1/sources') {
        calls.sources.push(params);
        const pages = o.sourcePages ?? [[sourceRow()]];
        const index = params.cursor ? Number(String(params.cursor).replace('P', '')) : 0;
        const hasMore = index + 1 < pages.length;
        return ok({ items: pages[index]!, pageInfo: { limit: 25, hasMore, nextCursor: hasMore ? `P${index + 1}` : null } });
      }
      throw new Error(`Unexpected GET: ${url}`);
    };
  const render = (role: Role, search = '', o: Parameters<typeof impl>[0] = {}) => {
    reset();
    return renderAt(role, `/fulfillment/sale-or-return/styles/style-1${search}`, impl(o));
  };

  it('shows one consolidated Style block with its own native Size columns across and the measures down', async () => {
    await render('MERCHANDISER');
    const table = container.querySelector<HTMLTableElement>('table[aria-label="ST-001 consolidated stock by size"]')!;
    expect(Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Measure', 'M', 'L', 'Total']);
    const rowLabels = Array.from(table.querySelectorAll('tbody th[scope="row"]')).map((th) => th.textContent);
    expect(rowLabels).toEqual([
      'Dispatched',
      'Received ledger',
      'Distributor-attested receipt',
      'Awaiting Distributor receipt',
      'Actual sold',
      'Returned to Erve',
      'Pending return requests',
      'Approved returns awaiting receipt',
      'Remaining with Distributor',
      'Available for actual sale',
      'Available for new return',
    ]);
    // The ambiguous label is never used; the approved-return measure is named for what it is.
    expect(content()).not.toContain('Awaiting Receipt');
    const row = (label: string) =>
      Array.from(Array.from(table.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === label)!.children).map((c) => c.textContent);
    expect(row('Dispatched')).toEqual(['Dispatched', '60', '40', '100']);
    expect(row('Approved returns awaiting receipt')[3]).toBe('7');
    expect(row('Pending return requests')[3]).toBe('4');
    // One Style, one table: never one Size per row, never a second block for the same Style.
    expect(container.querySelectorAll('table[aria-label$="consolidated stock by size"]')).toHaveLength(1);
  });

  it('shows missing receipt evidence as n/r, separate from the ledger, never as 0', async () => {
    await render('MERCHANDISER');
    const table = container.querySelector<HTMLTableElement>('table[aria-label="ST-001 consolidated stock by size"]')!;
    const row = (label: string) =>
      Array.from(Array.from(table.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('th')?.textContent === label)!.children).map((c) => c.textContent);
    // Size L has no ledger and no Distributor receipt.
    expect(row('Received ledger')[2]).toContain('n/r');
    expect(row('Distributor-attested receipt')[2]).toContain('n/r');
    expect(row('Received ledger')[1]).toBe('50');
    expect(content()).toContain('n/r = not recorded');
  });

  it('keeps wide content in its own scroller so a 375px screen cannot overflow the page', async () => {
    await render('MERCHANDISER');
    const table = container.querySelector('table[aria-label="ST-001 consolidated stock by size"]')!;
    expect(table.parentElement!.className).toContain('overflow-x-auto');
    const sources = container.querySelector('table[aria-label="Contributing dispatches"]')!;
    expect(sources.parentElement!.className).toContain('overflow-x-auto');
    expect(container.querySelector('[data-testid="stock-distributor"]')!.className).toContain('min-w-0');
  });

  it('lists Distributor-wise totals, and opens Store-wise details on demand (not before)', async () => {
    await render('MERCHANDISER');
    const sections = container.querySelectorAll('[data-testid="stock-distributor"]');
    expect(sections).toHaveLength(2);
    expect(sections[0]!.textContent).toContain('Distributor A');
    expect(sections[1]!.textContent).toContain('Distributor B');
    expect(calls.stores).toHaveLength(0); // lazy: no Store request until opened

    await click(Array.from(sections[0]!.querySelectorAll('button')).find((b) => b.textContent === 'Show stores'));
    expect(calls.stores).toEqual([{ distributorId: 'dist-A' }]);
    expect(container.querySelectorAll('[data-testid="stock-store"]')).toHaveLength(2);
    expect(content()).toContain('Central Mall');
    expect(content()).toContain('Old warehouse');
    expect(content()).toContain('Unmapped historical destination');
    // The other Distributor's Stores were not requested.
    expect(calls.stores).toHaveLength(1);
  });

  it('a Size cell drills into the contributing Dispatches of that Size, and "Show all dispatches" clears it', async () => {
    await render('MERCHANDISER');
    expect(calls.sources).toHaveLength(1);
    expect(calls.sources[0]).not.toHaveProperty('sizeId');
    await click(buttonByText('60') ?? Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.startsWith('Dispatched, size M')));
    expect(calls.sources.at(-1)).toMatchObject({ sizeId: 'size-m' });
    expect(content()).toContain('Showing dispatches for:');
    expect(content()).toContain('Size M');
    await click(buttonByText('Show all dispatches'));
    expect(calls.sources.at(-1)).not.toHaveProperty('sizeId');
    expect(content()).not.toContain('Showing dispatches for:');
  });

  it('a Distributor row and a Store row filter the Dispatch table by Distributor / Store', async () => {
    await render('MERCHANDISER');
    const dist = container.querySelectorAll('[data-testid="stock-distributor"]')[0]!;
    await click(Array.from(dist.querySelectorAll('button')).find((b) => b.textContent === 'Show dispatches'));
    expect(calls.sources.at(-1)).toMatchObject({ distributorId: 'dist-A' });
    expect(content()).toContain('Distributor Distributor A');

    await click(Array.from(dist.querySelectorAll('button')).find((b) => b.textContent === 'Show stores'));
    const store = container.querySelector('[data-testid="stock-store"]')!;
    await click(Array.from(store.querySelectorAll('button')).find((b) => b.textContent === 'Show dispatches'));
    expect(calls.sources.at(-1)).toMatchObject({ distributorId: 'dist-A', storeKey: 'S:store-1' });
    expect(content()).toContain('Store Central Mall');
  });

  it('shows each contributing Dispatch with its Order, Store, receipt evidence, ledger and returns, and pages with Load more', async () => {
    await render('MERCHANDISER', '', {
      sourcePages: [
        [sourceRow()],
        [sourceRow({ erveDispatchId: 'ed-2', erveDispatchNumber: 'EIED/26-27/0002', saleOrderLineId: 'sol-2', receipt: { status: 'AWAITING', receivedQuantity: null, receivedAt: null, ledgerDisposition: null }, ledger: { quantity: null, source: null }, discrepancy: false })],
      ],
    });
    const first = container.querySelectorAll('[data-testid="stock-source"]');
    expect(first).toHaveLength(1);
    const text = first[0]!.textContent!;
    expect(text).toContain('EIED/26-27/0001');
    expect(text).toContain('EISO/26-27/0001');
    expect(text).toContain('Distributor A');
    expect(text).toContain('Central Mall');
    expect(text).toContain('differs from ledger');
    expect(first[0]!.querySelector('a')!.getAttribute('href')).toBe('/fulfillment/erve-dispatches/ed-1');

    await click(buttonByText('Load more'));
    expect(calls.sources.at(-1)).toMatchObject({ cursor: 'P1' });
    const all = container.querySelectorAll('[data-testid="stock-source"]');
    expect(all).toHaveLength(2);
    expect(all[1]!.textContent).toContain('Awaiting receipt'); // no Distributor receipt yet
    expect(all[1]!.textContent).toContain('n/r'); // no ledger: not recorded, not 0
    expect(content()).toContain('Showing 2 dispatch lines (all loaded)');
  });

  it('DISTRIBUTOR: no Distributor selector, requests carry no distributorId', async () => {
    await render('DISTRIBUTOR');
    expect(hasDistributorField()).toBe(false);
    expect(calls.detail[0]).not.toHaveProperty('distributorId');
    expect(calls.sources[0]).not.toHaveProperty('distributorId');
  });

  it('ADMIN: the URL Distributor scopes every level, and clearing it restores all Distributors', async () => {
    await render('ADMIN', '?distributorId=dist-A');
    expect(calls.detail.at(-1)).toMatchObject({ distributorId: 'dist-A' });
    expect(calls.sources.at(-1)).toMatchObject({ distributorId: 'dist-A' });
    await click(buttonByText('Clear Distributor filter (show all Distributors)'));
    expect(calls.detail.at(-1)).not.toHaveProperty('distributorId');
    expect(locationText()).toBe('/fulfillment/sale-or-return/styles/style-1');
  });

  it('a Style with no stock in the selected Distributor says so and offers to clear the filter', async () => {
    await render('MERCHANDISER', '?distributorId=dist-A', {
      detail: () => Promise.reject(notFound()),
    });
    expect(content()).toContain('No Sale-or-Return stock for this Style');
    expect(content()).toContain('Distributor A has no Sale-or-Return stock of this Style');
    expect(container.querySelector('table[aria-label="ST-001 consolidated stock by size"]')).toBeNull();
    expect(buttonByText('Clear Distributor filter')).toBeDefined();
  });

  it('distinguishes a load error from not-found', async () => {
    await render('MERCHANDISER', '', { detail: () => Promise.reject(new Error('boom')) });
    expect(content()).toContain('Unable to load Style stock');
    expect(content()).not.toContain('No Sale-or-Return stock for this Style');
  });
});
