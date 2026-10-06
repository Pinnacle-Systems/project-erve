/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ErvePackingListListPage } from './ErvePackingListListPage.js';
import type { ErvePackingListSummary } from './types.js';

let container: HTMLDivElement;
let root: Root;

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

function renderPage() {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/erve-packing-lists']}>
          <AuthProvider>
            <Routes>
              <Route path="/fulfillment/erve-packing-lists" element={<ErvePackingListListPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('ErvePackingListListPage — request failure handling (UXAUTH-018)', () => {
  it('shows a visible error, not a silent empty list, when the request fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Network Error'));

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing Lists'));

    expect(content()).not.toContain('No Erve Packing Lists yet');
    expect(content()).toContain('Unable to load Erve Packing Lists');
    expect(content()).toContain('Network Error');
  });

  it('renders an empty-list state (not an error) when the request succeeds with zero records', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing Lists'));

    expect(content()).toContain('No Erve Packing Lists yet');
    expect(content()).not.toContain('Unable to load Erve Packing Lists');
  });
});

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

function buildSummary(overrides: Partial<ErvePackingListSummary> = {}): ErvePackingListSummary {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    saleOrder: null,
    destination: { label: null, contactName: null, contactEmail: null, contactPhone: null, addressLine1: null, addressLine2: null, city: 'Chennai', state: 'TN', country: 'India', postalCode: null },
    status: 'OPEN',
    createdBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    createdAt: '2026-09-01T00:00:00.000Z',
    cartonCount: 1,
    totalQuantity: 10,
    sourceFactories: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One' }],
    sourceDispatchOrders: [{ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    ...overrides,
  };
}

// DEMO-020: sourceFactories is confidential factory/supplier provenance,
// omitted entirely (not nulled) by the API for any role outside
// ERVE_PACKING_LIST_PROVENANCE_ROLES — see erve-dispatch.provenance.test.ts
// for the API-side redaction proof. This page is only ever route-gated to
// that same authorized role set today, so there is no real request that
// omits sourceFactories yet, but the "Factories" column must not render a
// stray value (or crash) if that ever changes.
describe('ErvePackingListListPage factory/supplier provenance redaction (DEMO-020)', () => {
  it('ADMIN sees the "Factories" column when the API includes provenance', async () => {
    mockAuth('ADMIN');
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [buildSummary()], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing Lists'));

    expect(content()).toContain('Factories');
    expect(content()).toContain('EIPL/26-27/0001');
  });

  it('renders no "Factories" column, and no stray undefined, when the API omits sourceFactories', async () => {
    mockAuth('ADMIN');
    const { sourceFactories: _sourceFactories, ...withoutProvenance } = buildSummary();
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [withoutProvenance], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing Lists'));

    expect(content()).not.toContain('Factories');
    expect(content()).not.toContain('undefined');
    expect(content()).toContain('EIPL/26-27/0001');
  });
});
