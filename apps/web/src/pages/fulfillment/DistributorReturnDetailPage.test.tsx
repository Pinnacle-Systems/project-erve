/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { DistributorReturnDetailPage } from './DistributorReturnDetailPage.js';
import type { DistributorReturnView } from './types.js';

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

function buildReturn(overrides: Partial<DistributorReturnView> = {}): DistributorReturnView {
  return {
    id: 'dr-1',
    returnNumber: 'EIDR/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    returnDate: '2026-09-01T00:00:00.000Z',
    status: 'SUBMITTED',
    returnReason: 'Excess stock',
    remarks: null,
    submittedBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    submittedAt: '2026-09-01T00:00:00.000Z',
    approvedBy: null,
    approvedAt: null,
    approvalRemarks: null,
    rejectionReason: null,
    receivedBy: null,
    receivedAt: null,
    creditNoteReference: null,
    creditNoteDate: null,
    creditNoteRecordedBy: null,
    cancelledBy: null,
    cancelledAt: null,
    lines: [],
    version: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

async function renderPage(getImpl: (url: string) => Promise<unknown>, role: Role = 'ADMIN') {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/distributor-returns/dr-1']}>
          <Routes>
            <Route path="/fulfillment/distributor-returns/:id" element={<DistributorReturnDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading return'));
}

describe('DistributorReturnDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 500');
    });

    expect(content()).not.toContain('Distributor Return not found');
    expect(content()).toContain('Unable to load return');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const record = buildReturn();
    await renderPage(async (url: string) => {
      if (url === '/distributor-returns/dr-1') return { data: { data: record } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('EIDR/26-27/0001');
    expect(content()).toContain('Distributor One');
    expect(content()).not.toContain('Unable to load return');
  });
});
