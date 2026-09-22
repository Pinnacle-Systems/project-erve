/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { InvoiceHandoffDetailPage } from './InvoiceHandoffDetailPage.js';
import type { InvoiceHandoffView } from './types.js';

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

function buildHandoff(overrides: Partial<InvoiceHandoffView> = {}): InvoiceHandoffView {
  return {
    id: 'ih-1',
    erveDispatch: { id: 'ed-1', erveDispatchNumber: 'EID/26-27/0001', dispatchDate: '2026-09-01T00:00:00.000Z' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    purchaseMode: 'OUTRIGHT',
    saleOrderLineId: 'line-1',
    style: { styleNumber: 'ST-001', styleName: 'Classic Tee' },
    size: { sizeCode: 'M', sizeLabel: 'Medium' },
    quantity: 10,
    status: 'PENDING_TALLY',
    tallyInvoiceNumber: null,
    tallyInvoiceDate: null,
    tallyVoucherReference: null,
    remarks: null,
    recordedBy: null,
    recordedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
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
        <MemoryRouter initialEntries={['/fulfillment/invoices/ih-1']}>
          <Routes>
            <Route path="/fulfillment/invoices/:id" element={<InvoiceHandoffDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading invoice handoff'));
}

describe('InvoiceHandoffDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 500');
    });

    expect(content()).not.toContain('Invoice handoff not found');
    expect(content()).toContain('Unable to load invoice handoff');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const handoff = buildHandoff();
    await renderPage(async (url: string) => {
      if (url === '/invoice-handoffs/ih-1') return { data: { data: handoff } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('ST-001');
    expect(content()).toContain('Distributor One');
    expect(content()).not.toContain('Unable to load invoice handoff');
  });
});

// NEW-AUTH: role-parametrized coverage for the Tally-reference mutation CTA
// (canMutateInvoiceHandoffs — INVOICE_HANDOFF_MUTATION_ROLES, ADMIN/
// ACCOUNTANT only, per the shared apps/web/src/auth/permissions.ts helper).
// Merchandiser is a *view-only* role here by deliberate design (it's a
// mutation role on other fulfillment pages, but not this one) — verified
// explicitly below since that's exactly the kind of mixed-role behavior a
// generic role matrix could miss. No runtime change: gating was already
// correct.
describe('InvoiceHandoffDetailPage Tally-reference mutation visibility by role', () => {
  async function renderHandoff(role: Role, overrides: Partial<InvoiceHandoffView> = {}) {
    const handoff = buildHandoff(overrides);
    await renderPage(async (url: string) => {
      if (url === '/invoice-handoffs/ih-1') return { data: { data: handoff } };
      throw new Error(`Unexpected GET: ${url}`);
    }, role);
  }

  it.each<Role>(['ADMIN', 'ACCOUNTANT'])(
    '%s sees the Record Tally Invoice Reference panel on a PENDING_TALLY handoff',
    async (role) => {
      await renderHandoff(role, { status: 'PENDING_TALLY' });
      expect(content()).toContain('Record Tally Invoice Reference');
    },
  );

  it.each<Role>(['MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR'])(
    '%s can read a PENDING_TALLY handoff but never sees the Tally-reference mutation panel',
    async (role) => {
      await renderHandoff(role, { status: 'PENDING_TALLY' });
      expect(content()).toContain('ST-001');
      expect(content()).not.toContain('Record Tally Invoice Reference');
      expect(content()).not.toContain('Correct Tally Invoice Reference');
    },
  );

  it('ADMIN sees the correction panel (relabeled, not hidden) once the handoff is already INVOICED', async () => {
    await renderHandoff('ADMIN', { status: 'INVOICED', tallyInvoiceNumber: 'TIV-1', tallyInvoiceDate: '2026-09-01T00:00:00.000Z' });
    expect(content()).toContain('Correct Tally Invoice Reference');
    expect(content()).not.toContain('Record Tally Invoice Reference');
  });
});
