/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ErvePackingListDetailPage } from './ErvePackingListDetailPage.js';
import type { ErvePackingListDetail } from './types.js';

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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const content = () => container.textContent ?? '';

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
      | HTMLButtonElement
      | undefined) ?? null
  );
}

function buildPackingList(overrides: Partial<ErvePackingListDetail> = {}): ErvePackingListDetail {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    saleOrder: null,
    destination: {
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
    },
    status: 'OPEN',
    createdBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    createdAt: '2026-09-01T00:00:00.000Z',
    cartonCount: 1,
    totalQuantity: 10,
    sourceFactories: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One' }],
    sourceDispatchOrders: [{ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    finalizedBy: null,
    finalizedAt: null,
    cartons: [
      {
        id: 'carton-1',
        cartonNumber: 'C1',
        factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
        factoryDispatchId: 'fd-1',
        factoryDispatchNumber: 'EIFD/26-27/0001',
        saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
        packageDetails: null,
        weight: null,
        totalQuantity: 10,
        lines: [
          {
            saleOrderLineId: 'line-1',
            styleNumber: 'ST-001',
            styleName: 'Classic Tee',
            sizeCode: 'M',
            sizeLabel: 'Medium',
            quantity: 10,
          },
        ],
      },
    ],
    styleSizeSummary: [],
    ...overrides,
  };
}

async function renderPage(packingList: ErvePackingListDetail, role: Role = 'ADMIN') {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/erve-packing-lists/epl-1') return { data: { data: packingList } };
    if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: [] } };
    throw new Error(`Unexpected GET: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/erve-packing-lists/epl-1']}>
          <Routes>
            <Route path="/fulfillment/erve-packing-lists/:id" element={<ErvePackingListDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing List'));
}

// UXAUTH-007 baseline: before this fix, an OPEN EIPL rendered every mutation
// control (Add Cartons panel incl. its eligible-cartons support query,
// per-carton Remove, Finalize) purely from packingList.status === 'OPEN',
// with no role check at all — even though only ERVE_DISPATCH_MUTATION_ROLES
// (ADMIN, MERCHANDISER) may actually call those endpoints
// (erve-dispatch.routes.ts canMutatePackingLists). SENIOR_MANAGEMENT is a
// read-only member of ERVE_PACKING_LIST_VIEW_ROLES and must see none of them.
describe('ErvePackingListDetailPage mutation gating (UXAUTH-007)', () => {
  it('ADMIN sees every mutation control on an OPEN Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    expect(content()).toContain('Add Cartons');
    expect(buttonByText('Remove')).not.toBeNull();
    expect(buttonByText('Finalize Packing List')).not.toBeNull();
  });

  it('MERCHANDISER (a mutation role) also sees every mutation control on an OPEN Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'MERCHANDISER');
    expect(content()).toContain('Add Cartons');
    expect(buttonByText('Remove')).not.toBeNull();
    expect(buttonByText('Finalize Packing List')).not.toBeNull();
  });

  it('SENIOR_MANAGEMENT reads an OPEN Erve Packing List but sees no mutation control', async () => {
    const get = vi.spyOn(apiClient, 'get');
    await renderPage(buildPackingList({ status: 'OPEN' }), 'SENIOR_MANAGEMENT');

    // Read-only content remains visible.
    expect(content()).toContain('EIPL/26-27/0001');
    expect(content()).toContain('Distributor One');
    expect(content()).toContain('C1');

    // Every mutation control is absent.
    expect(content()).not.toContain('Add Cartons');
    expect(buttonByText('Remove')).toBeNull();
    expect(buttonByText('Finalize Packing List')).toBeNull();

    // The mutation-only eligible-cartons support query must not even run for
    // a read-only role.
    expect(get.mock.calls.some((call) => call[0] === '/erve-packing-lists/eligible-cartons')).toBe(
      false,
    );
  });

  it('SENIOR_MANAGEMENT sees no Record Dispatch control on a FINALIZED Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'FINALIZED' }), 'SENIOR_MANAGEMENT');
    expect(content()).not.toContain('Record Erve Dispatch');
    expect(buttonByText('Record Dispatch')).toBeNull();
  });

  it('ADMIN still sees Record Dispatch on a FINALIZED Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'FINALIZED' }), 'ADMIN');
    expect(content()).toContain('Record Erve Dispatch');
    expect(buttonByText('Record Dispatch')).not.toBeNull();
  });
});

// UXAUTH-018: a failed fetch (403/500/network error) must render the real
// ErrorState, not fall through to the "Erve Packing List not found"
// EmptyState — that EmptyState is reserved for a genuine no-such-record
// response.
describe('ErvePackingListDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    mockAuth('ADMIN');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') throw new Error('Request failed with status code 500');
      throw new Error(`Unexpected GET: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/fulfillment/erve-packing-lists/epl-1']}>
            <Routes>
              <Route path="/fulfillment/erve-packing-lists/:id" element={<ErvePackingListDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing List'));

    expect(content()).not.toContain('Erve Packing List not found');
    expect(content()).toContain('Unable to load Erve Packing List');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

// DEMO-020: sourceFactories/carton.factory*/factoryDispatch* are confidential
// factory/supplier provenance, omitted entirely (not nulled) by the API for
// any role outside ERVE_PACKING_LIST_PROVENANCE_ROLES — see
// erve-dispatch.provenance.test.ts for the API-side redaction proof. This
// page is only ever route-gated to that same authorized role set today, so
// there is no real request that omits these fields yet, but the rendering
// must stay correct if that ever changes (e.g. ERVE_PACKING_LIST_VIEW_ROLES
// widened for an unrelated reason): no "Source Factories" row, no "Factory"
// or "Factory Packing List" column, and no stray undefined/placeholder text.
describe('ErvePackingListDetailPage factory/supplier provenance redaction (DEMO-020)', () => {
  function buildPackingListWithoutProvenance(overrides: Partial<ErvePackingListDetail> = {}): ErvePackingListDetail {
    const full = buildPackingList(overrides);
    const { sourceFactories: _sourceFactories, ...withoutSourceFactories } = full;
    return {
      ...withoutSourceFactories,
      cartons: full.cartons.map(({ factory: _factory, factoryDispatchId: _factoryDispatchId, factoryDispatchNumber: _factoryDispatchNumber, ...carton }) => carton),
    };
  }

  it('renders no "Source Factories" row and no Factory/Factory Packing List columns when the API omits provenance', async () => {
    await renderPage(buildPackingListWithoutProvenance({ status: 'OPEN' }), 'ADMIN');

    expect(content()).toContain('EIPL/26-27/0001');
    expect(content()).toContain('C1');
    expect(content()).not.toContain('Source Factories');
    expect(content()).not.toContain('Factory One');
    expect(content()).not.toContain('Factory Packing List');
    expect(content()).not.toContain('undefined');

    // The ordinary, non-confidential fields stay visible.
    expect(content()).toContain('Source Dispatch Orders');
    expect(content()).toContain('EISO/26-27/0001');
  });

  it('still renders Source Factories and the Factory column when the API includes provenance (ADMIN/MERCHANDISER/SENIOR_MANAGEMENT must not regress)', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');

    expect(content()).toContain('Source Factories');
    expect(content()).toContain('Factory One');
    expect(content()).toContain('Factory Packing List');
    expect(content()).toContain('EIFD/26-27/0001');
  });
});
