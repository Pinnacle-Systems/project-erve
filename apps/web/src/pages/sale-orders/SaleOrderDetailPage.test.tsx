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

async function renderPage(role: Role, factoryDispatchesImpl: () => Promise<{ data: { data: unknown } }>) {
  mockAuth(role);
  const saleOrder = buildSaleOrder();
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/sale-orders/so-1') return { data: { data: saleOrder } };
    if (url === '/sale-orders/so-1/audit') return { data: { data: [] } };
    if (url === '/factory-dispatches') return factoryDispatchesImpl();
    if (url === '/erve-dispatches') return { data: { data: { items: [] } } };
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
      await renderPage(role, async () => ({ data: { data: { items: [] } } }));
      expect(content()).toContain('Factory DispatchesNone yet.');
    },
  );
});
