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
  RetailStoreInventoryStoreGroup,
  RetailStoreInventoryStyleCard,
  Role,
  StoreFifoAvailability,
} from '@erve/types';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { RetailStoreInventoryPage } from './RetailStoreInventoryPage.js';
import { todayInIndia } from './retail-store-inventory/StoreFifoActionDialog.js';

// ISS-089 UI: Store-level Report sold / Request return on the Style x Size grid.

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

const position = (over: Partial<NonNullable<RetailStoreInventoryMeasures['saleReturn']>> = {}) => ({
  actualSoldQuantity: 0,
  returnedQuantity: 0,
  approvedAwaitingReceiptQuantity: 0,
  pendingRequestedQuantity: 0,
  remainingWithDistributor: 0,
  availableForActualSale: 0,
  availableForNewReturn: 0,
  ...over,
});
const measures = (over: Partial<RetailStoreInventoryMeasures>): RetailStoreInventoryMeasures => ({
  sourceCount: 1,
  shippedQuantity: 100,
  awaitingConfirmationQuantity: 0,
  attestedShippedQuantity: 100,
  attestedReceivedQuantity: 100,
  shortageQuantity: 0,
  ledgerQuantity: 100,
  ledgerBySource: { distributorConfirmed: 100, userConfirmed: 0, legacyAssumedFullReceipt: 0, unspecified: 0 },
  discrepancySourceCount: 0,
  saleReturn: null,
  ...over,
});
const size = (sizeId: string, sizeCode: string, sortOrder: number) => ({ sizeId, sizeCode, sizeLabel: sizeCode, sortOrder, active: true });

const topsCard: RetailStoreInventoryStyleCard = {
  cardKey: 'tops:SALE_RETURN',
  styleId: 'tops',
  styleNumber: 'TOP-1',
  styleName: 'Tee',
  primaryImage: null,
  purchaseMode: 'SALE_RETURN',
  sizes: [size('s', 'S', 1), size('m', 'M', 2), size('l', 'L', 3)],
  cells: {
    m: measures({ saleReturn: position({ remainingWithDistributor: 100, availableForActualSale: 100, availableForNewReturn: 100 }) }),
    // L has no available stock at all: both actions are present but disabled.
    l: measures({ saleReturn: position({ remainingWithDistributor: 0 }) }),
  },
  total: measures({ saleReturn: position({ remainingWithDistributor: 100, availableForActualSale: 100, availableForNewReturn: 100 }) }),
};
const jeansCard: RetailStoreInventoryStyleCard = {
  cardKey: 'jeans:OUTRIGHT',
  styleId: 'jeans',
  styleNumber: 'JEAN-1',
  styleName: 'Jeans',
  primaryImage: null,
  purchaseMode: 'OUTRIGHT',
  sizes: [size('w32', '32', 32)],
  cells: { w32: measures({}) },
  total: measures({}),
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
  name: 'Old Outlet',
  styles: [{ ...topsCard, cardKey: 'tops-b:SALE_RETURN' }],
};

const inventory = (items: RetailStoreInventoryStoreGroup[]): RetailStoreInventoryResponse => ({
  items,
  summary: { storeCount: items.length, dispatchCount: 2, totalsByMode: { SALE_RETURN: topsCard.total } },
  pageInfo: { limit: 10, hasMore: false, nextCursor: null },
});

const availabilityFor = (over: Partial<StoreFifoAvailability> = {}): StoreFifoAvailability => ({
  storeKey: 'S:store-1',
  styleId: 'tops',
  sizeId: 'm',
  asOfDate: todayInIndia(),
  availableForSale: 100,
  availableForReturn: 80,
  eligibleSourceCount: 2,
  excluded: { receivedAfterDateUnits: 0, unverifiedReceiptUnits: 0 },
  ...over,
});

let get: ReturnType<typeof vi.spyOn>;
let post: ReturnType<typeof vi.spyOn>;
function mockApi(items: RetailStoreInventoryStoreGroup[], availability: StoreFifoAvailability = availabilityFor()) {
  get = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/retail-store-inventory') return { data: { success: true, data: inventory(items) } };
    if (url === '/retail-store-inventory/store-fifo/availability') return { data: { success: true, data: availability } };
    if (url.startsWith('/distributors/options')) return { data: { success: true, data: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
  post = vi.spyOn(apiClient, 'post');
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
  await flush();
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

const button = (label: string) => document.body.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function enterQuantity(value: string) {
  // The quantity is the first field of the form (before the date).
  const quantity = dialog()!.querySelector('form input') as HTMLInputElement;
  setValue(quantity, value);
  act(() => quantity.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  return quantity;
}
const submitButton = (text: string) =>
  [...dialog()!.querySelectorAll('button[type="submit"]')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('Store-level FIFO actions on the Retail Store Inventory grid', () => {
  it('offers Report sold / Request return to a Distributor on Sale-or-Return sizes of mapped Stores only', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi([mappedStore, unmappedStore]);
    await render();

    // Sale-or-Return card of the mapped Store: actions in the size with stock, disabled where nothing is available.
    expect(button('Report sold, size M')).not.toBeNull();
    expect(button('Report sold, size M')!.disabled).toBe(false);
    expect(button('Request return, size M')!.disabled).toBe(false);
    expect(button('Report sold, size L')!.disabled).toBe(true);
    expect(button('Request return, size L')!.disabled).toBe(true);
    // No shipment in S: no actions there.
    expect(button('Report sold, size S')).toBeNull();
    // Outright has no actions; only one action row exists for the visible mapped Sale-or-Return card.
    expect(document.body.querySelectorAll('[data-testid="store-fifo-actions"]')).toHaveLength(1);
    const outrightTable = document.body.querySelector('table[aria-label="JEAN-1 Outright quantities by size"]')!;
    expect(outrightTable.querySelector('[data-testid="store-fifo-actions"]')).toBeNull();

    // Unmapped historical destination (expand it): never offers store-level actions.
    const toggles = [...document.body.querySelectorAll('section[aria-label^="Retail Store"] h3 button')] as HTMLButtonElement[];
    await act(async () => toggles[1]!.click());
    expect(document.body.querySelectorAll('[data-testid="store-fifo-actions"]')).toHaveLength(1);
  });

  it('offers no actions to internal roles', async () => {
    for (const role of ['ADMIN', 'MERCHANDISER', 'ACCOUNTANT'] as const) {
      mockAuth([role]);
      mockApi([mappedStore]);
      await render();
      expect(document.body.querySelector('[data-testid="store-fifo-actions"]')).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
      vi.restoreAllMocks();
    }
  });

  it('reports sold without choosing a Dispatch, then confirms with the source allocation and a link to the Sales Report', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi([mappedStore]);
    post.mockResolvedValue({
      data: {
        success: true,
        data: {
          replayed: false,
          salesReport: {
            id: 'sr-1',
            distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
            reportDate: todayInIndia(),
            remarks: null,
            submittedBy: { id: 'u1', name: 'U', email: 'u@test.local' },
            submittedAt: new Date().toISOString(),
            lines: [
              { id: 'l1', erveDispatch: { id: 'ed-a', erveDispatchNumber: 'ED/26-27/0001' }, quantitySold: 60 },
              { id: 'l2', erveDispatch: { id: 'ed-b', erveDispatchNumber: 'ED/26-27/0002' }, quantitySold: 15 },
            ],
          },
        },
      },
    });
    await render();

    await act(async () => button('Report sold, size M')!.click());
    await flush();
    const d = dialog()!;
    expect(d.textContent).toContain('Alpha Mall');
    expect(d.textContent).toContain('TOP-1');
    expect(d.querySelector('[data-testid="store-fifo-available"]')!.textContent).toBe('100');
    const availabilityCall = get.mock.calls.find((c: unknown[]) => c[0] === '/retail-store-inventory/store-fifo/availability')!;
    expect(availabilityCall[1]).toMatchObject({ params: { storeKey: 'S:store-1', styleId: 'tops', sizeId: 'm', date: todayInIndia() } });
    // The Distributor is never asked for a Dispatch.
    expect(d.textContent).not.toMatch(/dispatch id|select dispatch|choose dispatch/i);

    enterQuantity('75');
    await act(async () => submitButton('Report sold').click());
    await flush();

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0] as [string, Record<string, unknown>, { headers: Record<string, string> }];
    expect(url).toBe('/retail-store-inventory/store-fifo/sales-reports');
    expect(body).toMatchObject({ storeKey: 'S:store-1', styleId: 'tops', sizeId: 'm', quantity: 75, reportDate: todayInIndia() });
    expect(JSON.stringify(body)).not.toMatch(/erveDispatchId|saleOrderLineId/);
    expect(config.headers['Idempotency-Key']).toBeTruthy();

    const confirmation = dialog()!;
    expect(confirmation.textContent).toContain('Sales Report recorded');
    expect(confirmation.textContent).toContain('75 units');
    const items = [...confirmation.querySelectorAll('ul[aria-label="Allocation by Dispatch"] li')].map((li) => li.textContent);
    expect(items).toEqual(['ED/26-27/000160', 'ED/26-27/000215']);
    expect(confirmation.querySelector('a[href="/fulfillment/distributor-sales-reports/sr-1"]')).not.toBeNull();
  });

  it('keeps entered values when validation or the server rejects the request, and reuses the same key for a safe retry', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi([mappedStore]);
    await render();
    await act(async () => button('Report sold, size M')!.click());
    await flush();

    // Client-side limit message; nothing is sent and the entry is kept.
    const quantity = enterQuantity('150');
    expect(dialog()!.textContent).toContain('Only 100 available');
    await act(async () => submitButton('Report sold').click());
    expect(post).not.toHaveBeenCalled();
    expect(quantity.value).toBe('150');

    // A network failure keeps the entry and the retry reuses the same Idempotency-Key.
    enterQuantity('40');
    const networkError = Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined });
    post.mockRejectedValueOnce(networkError);
    await act(async () => submitButton('Report sold').click());
    await flush();
    expect(dialog()!.textContent).toContain('Retry safely');
    expect(quantity.value).toBe('40');
    post.mockRejectedValueOnce(networkError);
    await act(async () => submitButton('Report sold').click());
    await flush();
    const keys = post.mock.calls.map((c: unknown[]) => (c[2] as { headers: Record<string, string> }).headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);

    // Editing the quantity makes it a different request: a fresh key.
    enterQuantity('41');
    post.mockRejectedValueOnce(networkError);
    await act(async () => submitButton('Report sold').click());
    await flush();
    const third = (post.mock.calls[2] as [string, unknown, { headers: Record<string, string> }])[2].headers['Idempotency-Key'];
    expect(third).not.toBe(keys[0]);

    // A server rejection shows its message and keeps the entry.
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed'), {
        isAxiosError: true,
        response: { status: 400, data: { error: { message: 'Requested quantity 41 exceeds the 25 unit(s) available for Actual Sale' } } },
      }),
    );
    await act(async () => submitButton('Report sold').click());
    await flush();
    expect(dialog()!.textContent).toContain('exceeds the 25 unit(s) available');
    expect(quantity.value).toBe('41');
  });

  it('requires a reason for a return, posts to the return endpoint and links the Return', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi([mappedStore]);
    post.mockResolvedValue({
      data: {
        success: true,
        data: {
          replayed: false,
          distributorReturn: {
            id: 'ret-1',
            returnNumber: 'RET/26-27/0007',
            lines: [{ id: 'rl1', erveDispatch: { id: 'ed-a', erveDispatchNumber: 'ED/26-27/0001' }, requestedQuantity: 30 }],
          },
        },
      },
    });
    await render();
    await act(async () => button('Request return, size M')!.click());
    await flush();
    expect(dialog()!.querySelector('[data-testid="store-fifo-available"]')!.textContent).toBe('80');

    enterQuantity('30');
    await act(async () => submitButton('Request return').click());
    expect(post).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain('A return reason is required');

    const reason = [...dialog()!.querySelectorAll('input')].find((i) => i.getAttribute('placeholder')?.startsWith('e.g.'))!;
    setValue(reason, 'End of season');
    await act(async () => submitButton('Request return').click());
    await flush();

    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/retail-store-inventory/store-fifo/returns');
    expect(body).toMatchObject({ quantity: 30, returnReason: 'End of season', returnDate: todayInIndia() });
    expect(dialog()!.textContent).toContain('Return request submitted');
    expect(dialog()!.querySelector('a[href="/fulfillment/distributor-returns/ret-1"]')).not.toBeNull();
  });

  it('explains stock excluded by a backdated date or unverifiable legacy receipt', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi([mappedStore], availabilityFor({ availableForSale: 60, excluded: { receivedAfterDateUnits: 40, unverifiedReceiptUnits: 12 } }));
    await render();
    await act(async () => button('Report sold, size M')!.click());
    await flush();
    const notes = dialog()!.querySelector('ul[aria-label="Excluded stock"]')!.textContent!;
    expect(notes).toContain('40 unit(s) were received after');
    expect(notes).toContain('12 unit(s) have no verified receipt date');
  });

  it('uses a new Idempotency-Key after the remarks are edited, and the same key for an unchanged retry', async () => {
    mockAuth(['DISTRIBUTOR']);
    mockApi([mappedStore]);
    await render();
    await act(async () => button('Report sold, size M')!.click());
    await flush();
    enterQuantity('20');

    const networkError = Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined });
    const keyOf = (call: number) => (post.mock.calls[call] as [string, unknown, { headers: Record<string, string> }])[2].headers['Idempotency-Key'];

    // 1) failed submission
    post.mockRejectedValueOnce(networkError);
    await act(async () => submitButton('Report sold').click());
    await flush();
    expect(post).toHaveBeenCalledTimes(1);

    // 2) unchanged retry: same key
    post.mockRejectedValueOnce(networkError);
    await act(async () => submitButton('Report sold').click());
    await flush();
    expect(keyOf(1)).toBe(keyOf(0));

    // 3) edited remarks: a different request, so a fresh key, which then succeeds
    const remarks = dialog()!.querySelector('textarea') as HTMLTextAreaElement;
    setValue(remarks, 'Weekend promotion sales');
    post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          replayed: false,
          salesReport: {
            id: 'sr-9',
            distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
            reportDate: todayInIndia(),
            remarks: 'Weekend promotion sales',
            submittedBy: { id: 'u1', name: 'U', email: 'u@test.local' },
            submittedAt: new Date().toISOString(),
            lines: [{ id: 'l1', erveDispatch: { id: 'ed-a', erveDispatchNumber: 'ED/26-27/0001' }, quantitySold: 20 }],
          },
        },
      },
    });
    await act(async () => submitButton('Report sold').click());
    await flush();
    expect(post).toHaveBeenCalledTimes(3);
    expect(keyOf(2)).not.toBe(keyOf(0));
    expect((post.mock.calls[2] as [string, Record<string, unknown>])[1]).toMatchObject({ remarks: 'Weekend promotion sales', quantity: 20 });
    expect(dialog()!.textContent).toContain('Sales Report recorded');
  });
});
