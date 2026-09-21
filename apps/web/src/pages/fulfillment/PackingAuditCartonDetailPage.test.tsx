/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { PackingAuditCartonDetailPage } from './PackingAuditCartonDetailPage.js';
import type { PackingAuditQueueItem } from './types.js';

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

function buildCarton(
  overrides: Partial<PackingAuditQueueItem & { factoryDispatchId: string }> = {},
): PackingAuditQueueItem & { factoryDispatchId: string } {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    weight: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'NOT_INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [
      {
        saleOrderLineId: 'line-1',
        styleId: 'style-1',
        styleNumber: 'ST-001',
        styleName: 'Classic Tee',
        sizeId: 'size-1',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 10,
        currentDestinationId: 'dest-1',
      },
    ],
    auditHistory: [],
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    destination: {
      id: 'dest-1',
      label: null,
      city: 'Chennai',
      state: 'TN',
      distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    },
    factoryDispatchId: 'fd-1',
    ...overrides,
  };
}

async function renderPage(getImpl: (url: string) => Promise<unknown>, role: Role = 'ADMIN') {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/packing-audit/cartons/carton-1']}>
          <Routes>
            <Route path="/fulfillment/packing-audit/cartons/:cartonId" element={<PackingAuditCartonDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading carton'));
}

describe('PackingAuditCartonDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 500');
    });

    expect(content()).not.toContain('Carton not found');
    expect(content()).toContain('Unable to load carton');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const carton = buildCarton();
    await renderPage(async (url: string) => {
      if (url === '/packing-audit/cartons/carton-1') return { data: { data: carton } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('Carton C1');
    expect(content()).toContain('EISO/26-27/0001');
    expect(content()).not.toContain('Unable to load carton');
  });
});
