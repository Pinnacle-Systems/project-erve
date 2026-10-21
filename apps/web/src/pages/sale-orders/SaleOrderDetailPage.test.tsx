/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { SaleOrderDetailPage } from './SaleOrderDetailPage.js';
import type { SaleOrder } from './types.js';

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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const content = () => container.textContent ?? '';

function buildSaleOrder(): SaleOrder {
  return {
    id: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One', purchaseMode: 'OUTRIGHT' }],
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    financialYear: { id: 'fy-1', code: 'FY26-27' },
    soDate: '2026-06-30T00:00:00.000Z',
    status: 'ACTIVE',
    destinationCount: 1,
    totalQuantity: 10,
    createdAt: '2026-06-30T00:00:00.000Z',
    isLocked: false,
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    creator: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    remarks: null,
    distributorGroups: [
      {
        id: 'dg-1',
        distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
        purchaseMode: 'OUTRIGHT',
        destinations: [
          {
            id: 'dest-1',
            label: null,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            addressLine1: '123 Test Street',
            addressLine2: null,
            city: 'Chennai',
            state: 'TN',
            country: 'India',
            postalCode: null,
            gstin: null,
            canMoveDistributor: true,
          },
        ],
        lines: [
          {
            id: 'line-1',
            destinationId: 'dest-1',
            styleId: 'style-1',
            styleNumber: 'ST-001',
            styleName: 'Classic Tee',
            primaryImage: null,
            sizeId: 'size-1',
            sizeCode: 'M',
            sizeLabel: 'Medium',
            quantity: 10,
            remarks: null,
          },
        ],
      },
    ],
    lines: [
      {
        id: 'line-1',
        destinationId: 'dest-1',
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'Classic Tee',
        primaryImage: null,
        sizeId: 'size-1',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 10,
        remarks: null,
      },
    ],
    fulfillment: { stage: 'AWAITING_PACKING', totalQuantity: 10, totalFactoryPackedQuantity: 0 },
  };
}

async function renderPage(
  role: Role,
  factoryDispatchesImpl: (config?: { params?: Record<string, unknown> }) => Promise<{ data: { data: unknown } }>,
  overrides: Partial<SaleOrder> = {},
) {
  mockAuth(role);
  const saleOrder = { ...buildSaleOrder(), ...overrides };
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/sale-orders/so-1') return { data: { data: saleOrder } };
    if (url === '/sale-orders/so-1/audit') return { data: { data: [] } };
    if (url === '/gst-compliance/verification/policy') return { data: { data: { enabled: true } } };
    if (url === '/gst-compliance/verification') return { data: { data: {
      enabled: true, mode: 'DEMO', level: 'BASIC', canVerify: true, canRefresh: true,
      cacheState: 'NONE', evidence: null, latestFailure: null,
    } } };
    if (url === '/factory-dispatches') return factoryDispatchesImpl(config);
    if (url === '/erve-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
    throw new Error(`Unexpected GET: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/sale-orders/so-1']}>
          <Routes>
            <Route path="/sale-orders/:id" element={<SaleOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
}

describe('Phase 1B integration with the main-branch Style / Size grid', () => {
  it('renders both quantity grids and exact-source GSTIN information without verification actions', async () => {
    const saleOrder = buildSaleOrder();
    const lines = [
      { ...saleOrder.lines[0]!, quantity: 5 },
      { ...saleOrder.lines[0]!, id: 'line-2', sizeId: 'size-2', sizeCode: 'L', sizeLabel: 'Large', quantity: 10 },
    ];
    saleOrder.lines = lines;
    saleOrder.totalQuantity = 15;
    saleOrder.distributorGroups[0]!.lines = lines;
    saleOrder.distributorGroups[0]!.destinations[0]!.gstin = '33AAAAA0000A1Z5';
    const post = vi.spyOn(apiClient, 'post');
    await renderPage(
      'ADMIN',
      async () => ({ data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } }),
      saleOrder,
    );
    await flush();
    await flush();

    const grids = Array.from(container.querySelectorAll('table')).filter(
      (table) => table.querySelector('th')?.textContent === 'Style',
    );
    expect(grids).toHaveLength(2); // destination quantities and overall totals
    for (const grid of grids) {
      expect(Array.from(grid.querySelectorAll('th')).map((cell) => cell.textContent)).toEqual(['Style', 'M', 'L', 'Total']);
      expect(grid.querySelectorAll('tbody tr')).toHaveLength(1);
      expect(grid.textContent).toContain('ST-001');
      expect(grid.textContent).toContain('Classic Tee');
      expect(grid.querySelector('tbody tr')!.lastElementChild!.textContent).toBe('15');
      const quantities = Array.from(grid.querySelectorAll('input'));
      expect(quantities.map((input) => input.value)).toEqual(['5', '10']);
      expect(quantities.every((input) => input.readOnly)).toBe(true);
    }
    const verification = container.querySelector('section[aria-label="GSTIN verification"]');
    expect(verification).not.toBeNull();
    expect(verification!.textContent).toContain('Not Verified');
    expect(verification!.querySelector('button')).toBeNull();
    expect(apiClient.get).toHaveBeenCalledWith('/gst-compliance/verification', {
      params: { gstin: '33AAAAA0000A1Z5', sourceType: 'DISPATCH_ORDER', sourceId: 'dest-1' },
    });
    expect(post).not.toHaveBeenCalled();
  });
});

// UXAUTH-004: this panel calls GET /factory-dispatches?saleOrderId=... through
// the exact same resolveActorFactoryScope path as the Factory Packing queue
// page — MERCHANDISER/SENIOR_MANAGEMENT were silently broken here too (403
// FACTORY_MAPPING_REQUIRED, rendered as "None yet.", identical to the
// packing-queue bug) before the shared read-scope fix. This is an incidental
// fix of the same root cause, not a new scope item.
describe('SaleOrderDetailPage — Factory Dispatches panel (UXAUTH-004 affected surface)', () => {
  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    '%s can load the Factory Dispatches panel (not "None yet." from a swallowed 403)',
    async (role) => {
      await renderPage(role, async () => ({
        data: {
          data: {
            items: [
              {
                id: 'fd-1',
                factoryDispatchNumber: 'EIFD/26-27/0001',
                factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
                saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [] },
                status: 'DRAFT',
                version: 1,
                preparedAt: '2026-09-01T00:00:00.000Z',
                finalizedAt: null,
                consolidated: false,
              },
            ],
            pageInfo: { limit: 100, hasMore: false, nextCursor: null },
          },
        },
      }));

      // The Factory Dispatches sub-panel's heading must be immediately
      // followed by the real dispatch, not the "None yet." empty-state text
      // that a swallowed 403 used to produce here (the sibling Erve
      // Dispatches sub-panel legitimately renders its own "None yet." in
      // this fixture — that one is a real empty result, not this bug).
      expect(content()).toContain('Factory DispatchesEIFD/26-27/0001');
      expect(content()).not.toContain('Factory DispatchesNone yet.');
    },
  );

  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    '%s sees the legitimate empty state only for a genuinely empty result',
    async (role) => {
      await renderPage(role, async () => ({ data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } }));
      expect(content()).toContain('Factory DispatchesNone yet.');
    },
  );
});

// The related Factory Dispatch list is cursor-paginated; the detail page
// lists every page for this Dispatch Order, not just the first.
describe('SaleOrderDetailPage — related dispatch lists fetch every page', () => {
  it('follows nextCursor until hasMore is false', async () => {
    const summary = (n: number) => ({
      id: `fd-${n}`,
      factoryDispatchNumber: `EIFD/26-27/${String(n).padStart(4, '0')}`,
      factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
      saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [] },
      status: 'DRAFT',
      version: 1,
      preparedAt: '2026-09-01T00:00:00.000Z',
      finalizedAt: null,
      consolidated: false,
    });
    const calls: Array<Record<string, unknown> | undefined> = [];
    await renderPage('MERCHANDISER', async (config) => {
      calls.push(config?.params);
      return config?.params?.cursor === 'c1'
        ? {
            data: {
              data: {
                items: [summary(2)],
                pageInfo: { limit: 100, hasMore: false, nextCursor: null },
              },
            },
          }
        : {
            data: {
              data: {
                items: [summary(1)],
                pageInfo: { limit: 100, hasMore: true, nextCursor: 'c1' },
              },
            },
          };
    });
    await flush();

    expect(content()).toContain('EIFD/26-27/0001');
    expect(content()).toContain('EIFD/26-27/0002');
    expect(calls).toEqual([
      { saleOrderId: 'so-1', cursor: undefined, limit: 100 },
      { saleOrderId: 'so-1', cursor: 'c1', limit: 100 },
    ]);
  });
});

// ISS-021: three columns only when the Header panel has enough *content*
// width; an expanded sidebar must not force cramped columns at 1024px.
describe('ISS-021 Dispatch Order header layout', () => {
  it('uses a compact container-responsive three-column grid without losing header facts or actions', async () => {
    await renderPage(
      'ADMIN',
      async () => ({ data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } }),
      {
        distributors: [
          {
            id: 'dist-1',
            code: 'D1',
            name: 'A Distributor With a Very Long Name To Verify Wrapping',
            purchaseMode: 'OUTRIGHT',
          },
        ],
        remarks: 'An extended operational remark that should span the available content columns.',
      },
    );

    const title = Array.from(container.querySelectorAll('h3')).find(
      (node) => node.textContent === 'Header',
    );
    expect(title).toBeDefined();
    const headerPanel = title!.closest('.rounded-panel');
    expect(headerPanel).not.toBeNull();
    const containerWrapper = headerPanel!.querySelector('.\\@container');
    expect(containerWrapper).not.toBeNull();

    const grid = Array.from(headerPanel!.querySelectorAll('div')).find(
      (node) => node.className.includes('@min-[50rem]:grid-cols-3'),
    );
    expect(grid).toBeDefined();
    expect(grid!.className).toContain('@min-[30rem]:grid-cols-2');
    expect(grid!.className).toContain('min-w-0');

    for (const label of [
      'Distributor',
      'Factory',
      'Dispatch Order Date',
      'Financial Year',
      'Created By',
      'Created At',
      'State',
      'Fulfillment',
      'Remarks',
    ]) {
      expect(grid!.textContent).toContain(label);
    }
    expect(grid!.textContent).toContain('A Distributor With a Very Long Name');
    expect(grid!.textContent).toContain('An extended operational remark');
    const remark = Array.from(grid!.querySelectorAll('div')).find(
      (node) => node.className.includes('@min-[50rem]:col-span-3'),
    );
    expect(remark).toBeDefined();
    expect(content()).toContain('EISO/26-27/0001');
    expect(content()).toContain('Ready for Factory (editable)');
    expect(content()).toContain('Awaiting Packing');
    expect(content()).toContain('Download PDF');
    expect(content()).toContain('Edit / Correct');
  });

  it('keeps empty remarks compact without spanning the entire responsive grid', async () => {
    await renderPage(
      'ADMIN',
      async () => ({ data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } }),
    );
    const title = Array.from(container.querySelectorAll('h3')).find(
      (node) => node.textContent === 'Header',
    );
    const headerPanel = title!.closest('.rounded-panel')!;
    expect(headerPanel.textContent).toContain('Remarks');
    expect(headerPanel.querySelector('[class*="col-span-3"]')).toBeNull();
  });
});
