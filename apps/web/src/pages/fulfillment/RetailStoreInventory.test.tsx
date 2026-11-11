/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthUser,
  RetailStoreInventoryMeasures,
  RetailStoreInventoryResponse,
  RetailStoreInventorySource,
  RetailStoreInventoryStoreGroup,
  RetailStoreInventoryStyleCard,
  Role,
} from '@erve/types';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { RetailStoreInventoryPage } from './RetailStoreInventoryPage.js';
import { evidenceFlags } from './retail-store-inventory/measures.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mockAuth(roles: Role[]) {
  const user: AuthUser = { id: 'u1', email: 'u@test.local', mobile: null, name: 'U', roles };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 't',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

const none: RetailStoreInventoryMeasures = {
  sourceCount: 0,
  shippedQuantity: 0,
  awaitingConfirmationQuantity: 0,
  attestedShippedQuantity: 0,
  attestedReceivedQuantity: null,
  shortageQuantity: null,
  ledgerQuantity: null,
  ledgerBySource: { distributorConfirmed: 0, userConfirmed: 0, legacyAssumedFullReceipt: 0, unspecified: 0 },
  discrepancySourceCount: 0,
  saleReturn: null,
};
const saleReturn = (over: Partial<NonNullable<RetailStoreInventoryMeasures['saleReturn']>> = {}) => ({
  actualSoldQuantity: 0,
  returnedQuantity: 0,
  approvedAwaitingReceiptQuantity: 0,
  pendingRequestedQuantity: 0,
  remainingWithDistributor: 0,
  availableForActualSale: 0,
  availableForNewReturn: 0,
  ...over,
});
const measures = (over: Partial<RetailStoreInventoryMeasures>): RetailStoreInventoryMeasures => ({ ...none, sourceCount: 1, ...over });

const size = (sizeId: string, sizeCode: string, sortOrder: number, active = true) => ({
  sizeId,
  sizeCode,
  sizeLabel: sizeCode,
  sortOrder,
  active,
});

// Tops: S/M/L, shipments only in M and L. Jeans: a different, numeric size system.
const topsCard: RetailStoreInventoryStyleCard = {
  cardKey: 'tops:SALE_RETURN',
  styleId: 'tops',
  styleNumber: 'TOP-1',
  styleName: 'Tee',
  primaryImage: null,
  purchaseMode: 'SALE_RETURN',
  sizes: [size('s', 'S', 1), size('m', 'M', 2), size('l', 'L', 3)],
  cells: {
    m: measures({
      shippedQuantity: 15,
      awaitingConfirmationQuantity: 15,
      saleReturn: saleReturn({ remainingWithDistributor: 0 }),
    }),
    l: measures({
      shippedQuantity: 10,
      attestedShippedQuantity: 10,
      attestedReceivedQuantity: 0,
      shortageQuantity: 10,
      ledgerQuantity: null,
      saleReturn: saleReturn(),
    }),
  },
  total: measures({
    sourceCount: 3,
    shippedQuantity: 25,
    awaitingConfirmationQuantity: 15,
    attestedShippedQuantity: 10,
    attestedReceivedQuantity: 0,
    shortageQuantity: 10,
    ledgerBySource: { distributorConfirmed: 0, userConfirmed: 0, legacyAssumedFullReceipt: 12, unspecified: 0 },
    saleReturn: saleReturn({ remainingWithDistributor: 7 }),
  }),
};
const jeansCard: RetailStoreInventoryStyleCard = {
  cardKey: 'jeans:OUTRIGHT',
  styleId: 'jeans',
  styleNumber: 'JEAN-1',
  styleName: 'Jeans',
  primaryImage: null,
  purchaseMode: 'OUTRIGHT',
  sizes: [size('w30', '30', 30), size('w32', '32', 32)],
  cells: { w32: measures({ shippedQuantity: 6, awaitingConfirmationQuantity: 6 }) },
  total: measures({ shippedQuantity: 6, awaitingConfirmationQuantity: 6 }),
};

const mappedStore: RetailStoreInventoryStoreGroup = {
  storeKey: 'S:store-1',
  mapped: true,
  retailStoreId: 'store-1',
  code: 'MALL1',
  name: 'Alpha Mall',
  city: 'Chennai',
  state: 'Tamil Nadu',
  status: 'ACTIVE',
  distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
  dispatchCount: 2,
  totalsByMode: { SALE_RETURN: topsCard.total, OUTRIGHT: jeansCard.total },
  styles: [topsCard, jeansCard],
};
const unmappedStore: RetailStoreInventoryStoreGroup = {
  ...mappedStore,
  storeKey: 'D:dest-9',
  mapped: false,
  retailStoreId: null,
  code: null,
  name: 'Old Outlet',
  status: null,
  dispatchCount: 1,
  totalsByMode: { OUTRIGHT: jeansCard.total },
  styles: [{ ...jeansCard, cardKey: 'jeans-b:OUTRIGHT' }],
};

function response(items: RetailStoreInventoryStoreGroup[], hasMore = false): RetailStoreInventoryResponse {
  return {
    items,
    summary: {
      storeCount: 5,
      dispatchCount: 9,
      totalsByMode: { SALE_RETURN: topsCard.total, OUTRIGHT: jeansCard.total },
    },
    pageInfo: { limit: 10, hasMore, nextCursor: hasMore ? 'cursor-2' : null },
  };
}

const source: RetailStoreInventorySource = {
  erveDispatchId: 'ed-1',
  erveDispatchNumber: 'ED/26-27/0001',
  dispatchDate: '2026-07-01T00:00:00.000Z',
  ervePackingListNumber: 'EIPL-1',
  saleOrderId: 'so-1',
  saleOrderNumber: 'SO-1',
  saleOrderLineId: 'sol-1',
  purchaseMode: 'SALE_RETURN',
  styleId: 'tops',
  styleNumber: 'TOP-1',
  styleName: 'Tee',
  sizeId: 'm',
  sizeCode: 'M',
  sizeLabel: 'M',
  dispatchDestination: { label: 'Alpha Mall', storeCode: 'MALL1', addressLine1: null, city: 'Chennai', state: 'TN', postalCode: null },
  orderDestination: { destinationId: 'dest-1', retailStoreId: 'store-1', label: 'Alpha Mall', storeCode: 'MALL1', addressLine1: null, city: 'Chennai', state: 'TN', postalCode: null },
  shippedQuantity: 15,
  receipt: { status: 'AWAITING', receivedQuantity: null, receivedAt: null, ledgerDisposition: null },
  ledger: { quantity: 15, source: 'LEGACY_ASSUMED_FULL_RECEIPT' },
  shortageQuantity: null,
  discrepancy: false,
  qr: { cartonCount: 2, confirmedCartonCount: 1 },
  saleReturn: saleReturn({ remainingWithDistributor: 15, availableForActualSale: 15, availableForNewReturn: 15 }),
};

let get: ReturnType<typeof vi.spyOn>;
function mockApi(inventory: RetailStoreInventoryResponse) {
  get = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/retail-store-inventory') return { data: { success: true, data: inventory } };
    if (url === '/retail-store-inventory/sources') {
      return { data: { success: true, data: { items: [source], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
    }
    if (url.startsWith('/distributors/options')) return { data: { success: true, data: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
}

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RetailStoreInventoryPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
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

const tableFor = (label: string) => document.body.querySelector(`table[aria-label="${label}"]`) as HTMLTableElement;
const rowText = (table: HTMLTableElement, label: string) =>
  [...table.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')?.textContent === label)!;

describe('Retail Store Inventory page', () => {
  it('renders each Style with its own native Size columns, never one Size per row', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi(response([mappedStore]));
    await render();

    const tops = tableFor('TOP-1 Sale-or-Return quantities by size');
    const jeans = tableFor('JEAN-1 Outright quantities by size');
    expect([...tops.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Measure', 'S', 'M', 'L', 'Total']);
    expect([...jeans.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Measure', '30', '32', 'Total']);
    // Shipped row: no shipment in S, 15 in M, 10 in L, total 25
    const shipped = rowText(tops, 'Shipped');
    expect(shipped.textContent).toContain('15');
    expect(shipped.querySelector('td:nth-child(2)')!.textContent).toBe('—No shipment');
    expect(shipped.querySelector('td:last-child')!.textContent).toBe('25');
    expect(document.body.textContent).toContain('Distributor: Distributor One');
    expect(document.body.textContent).toContain('Alpha Mall');
  });

  it('never renders missing evidence as zero, keeps a real zero, and labels awaiting confirmation', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi(response([mappedStore]));
    await render();
    const tops = tableFor('TOP-1 Sale-or-Return quantities by size');

    const received = rowText(tops, 'Distributor received');
    // M: no receipt -> n/r (not 0). L: final all-zero receipt -> a real 0.
    expect(received.querySelector('td:nth-child(3)')!.textContent).toBe('n/r');
    expect(received.querySelector('td:nth-child(4)')!.textContent).toBe('0');
    expect(rowText(tops, 'Shortage').querySelector('td:nth-child(3)')!.textContent).toBe('n/r');
    expect(rowText(tops, 'Shortage').querySelector('td:nth-child(4)')!.textContent).toBe('10');
    expect(rowText(tops, 'Received ledger in use').querySelector('td:nth-child(3)')!.textContent).toBe('n/r');
    expect(rowText(tops, 'Awaiting confirmation').querySelector('td:nth-child(3)')!.textContent).toBe('15');
    const buttons = [...tops.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(buttons).toContain('Distributor received, size M: Not recorded: no Distributor receipt yet. Show source dispatches');
    expect(document.body.textContent).toContain('15 pcs awaiting Distributor confirmation');
    expect(document.body.textContent).toContain('Ledger includes 12 pcs of legacy assumed receipt (not verified)');
    expect(document.body.textContent).toContain('Shortage 10 pcs');
  });

  it('shows the Sale-or-Return position only for Sale-or-Return Styles and says Outright has no store stock', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi(response([mappedStore]));
    await render();
    const tops = tableFor('TOP-1 Sale-or-Return quantities by size');
    const jeans = tableFor('JEAN-1 Outright quantities by size');
    for (const label of ['Actual sold', 'Remaining with Distributor', 'Available for actual sale', 'Available for new return']) {
      expect(rowText(tops, label)).toBeTruthy();
    }
    expect(rowText(tops, 'Remaining with Distributor').querySelector('td:last-child')!.textContent).toBe('7');
    expect([...jeans.querySelectorAll('tbody th')].map((th) => th.textContent)).not.toContain('Remaining with Distributor');
    expect(document.body.textContent).toContain('Retailer sell-through and live store on-hand are not available for Outright shipments');
    // The derived grid has no mutation of its own; store-level actions (ISS-089) are covered in StoreFifoActions.test.tsx.
    expect(document.body.querySelectorAll('[data-testid="store-fifo-actions"]').length).toBeLessThanOrEqual(1);
  });

  it('marks unmapped historical destinations and keeps them as their own group', async () => {
    mockAuth(['ADMIN']);
    mockApi(response([mappedStore, unmappedStore]));
    await render();
    const sections = [...document.body.querySelectorAll('section[aria-label^="Retail Store"]')];
    expect(sections).toHaveLength(2);
    expect(sections[1]!.textContent).toContain('Unmapped historical destination');
    expect(sections[0]!.textContent).not.toContain('Unmapped historical destination');
  });

  it('expands and collapses a Store section by keyboard-accessible toggle', async () => {
    mockAuth(['ADMIN']);
    mockApi(response([mappedStore, unmappedStore]));
    await render();
    const toggles = [...document.body.querySelectorAll('section[aria-label^="Retail Store"] h3 button')] as HTMLButtonElement[];
    expect(toggles.map((t) => t.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    await act(async () => toggles[0]!.click());
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('table')).toBeNull();
    await act(async () => toggles[1]!.click());
    expect(document.body.querySelector('table[aria-label="JEAN-1 Outright quantities by size"]')).not.toBeNull();
  });

  it('drills a cell into its source Dispatches with receipt, ledger and QR labelled separately', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi(response([mappedStore]));
    await render();
    const tops = tableFor('TOP-1 Sale-or-Return quantities by size');
    const cell = tops.querySelector('button[aria-label^="Shipped, size M"]') as HTMLButtonElement;
    await act(async () => cell.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const call = get.mock.calls.find((c: unknown[]) => c[0] === '/retail-store-inventory/sources')!;
    expect(call[1]).toMatchObject({
      params: { distributorId: 'dist-1', storeKey: 'S:store-1', styleId: 'tops', sizeId: 'm', purchaseMode: 'SALE_RETURN' },
    });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('ED/26-27/0001');
    expect(dialog.textContent).toContain('Awaiting confirmation');
    expect(dialog.textContent).toContain('Legacy assumed full receipt (assumption)');
    expect(dialog.textContent).toContain('1 of 2 cartons');
    expect(dialog.textContent).toContain('Physical delivery only, not accepted quantity');
    expect(dialog.querySelector('a[href="/fulfillment/erve-dispatches/ed-1"]')).not.toBeNull();
  });

  it('loads more Stores with the server cursor and shows whole-result totals', async () => {
    mockAuth(['ADMIN']);
    mockApi(response([mappedStore], true));
    await render();
    expect(document.body.textContent).toContain('5 stores · 9 dispatches');
    const loadMore = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Load more')!;
    await act(async () => loadMore.click());
    const calls = get.mock.calls.filter((c: unknown[]) => c[0] === '/retail-store-inventory');
    expect(calls.at(-1)![1]).toMatchObject({ params: { cursor: 'cursor-2' } });
  });

  it('denies roles without inventory access and does not call the API', async () => {
    mockAuth(['FACTORY_USER']);
    mockApi(response([mappedStore]));
    await render();
    expect(document.body.textContent).toContain('Retail Store Inventory access unavailable');
    expect(get).not.toHaveBeenCalled();
  });

  it('offers the Distributor picker only to roles that can look Distributors up', async () => {
    for (const [roles, picker] of [
      [['ADMIN'], true],
      [['MERCHANDISER'], true],
      [['SENIOR_MANAGEMENT'], true],
      [['ACCOUNTANT'], false],
      [['DISTRIBUTOR'], false],
    ] as const) {
      mockAuth([...roles]);
      mockApi(response([mappedStore]));
      await render();
      expect([...document.body.querySelectorAll('label')].some((l) => l.textContent === 'Distributor')).toBe(picker);
      act(() => root.unmount());
      vi.restoreAllMocks();
      root = createRoot(container);
    }
  });
});

describe('evidenceFlags', () => {
  it('flags awaiting, shortage, discrepancy and non-Distributor ledger sources without inventing any', () => {
    expect(evidenceFlags(none)).toEqual([]);
    const flags = evidenceFlags(
      measures({
        awaitingConfirmationQuantity: 4,
        shortageQuantity: 2,
        discrepancySourceCount: 2,
        ledgerBySource: { distributorConfirmed: 9, userConfirmed: 3, legacyAssumedFullReceipt: 5, unspecified: 1 },
      }),
    );
    expect(flags.map((f) => f.key)).toEqual(['awaiting', 'shortage', 'discrepancy', 'legacy', 'user', 'unspecified']);
    // A shortage of exactly 0 with a receipt is not flagged.
    expect(evidenceFlags(measures({ shortageQuantity: 0 }))).toEqual([]);
  });
});
