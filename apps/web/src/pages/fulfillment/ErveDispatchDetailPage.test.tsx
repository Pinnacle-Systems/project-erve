/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ErveDispatchDetailPage } from './ErveDispatchDetailPage.js';
import type { ErveDispatchView } from './types.js';

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

function changeInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function buildDispatch(overrides: Partial<ErveDispatchView> = {}): ErveDispatchView {
  return {
    id: 'ed-1',
    erveDispatchNumber: 'EID/26-27/0001',
    ervePackingList: { id: 'epl-1', ervePackingListNumber: 'EIPL/26-27/0001' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    status: 'DISPATCHED',
    dispatchDate: '2026-09-01T00:00:00.000Z',
    transporter: null,
    vehicleNumber: null,
    lrNumber: null,
    remarks: null,
    dispatchedBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    dispatchedAt: '2026-09-01T00:00:00.000Z',
    lrUpdatedBy: null,
    lrUpdatedAt: null,
    deliveredBy: null,
    deliveredAt: null,
    deliveryRemarks: null,
    deliveryConfirmationSource: null,
    totalQuantity: 10,
    invoiceHandoffs: [],
    saleOrReturnLines: [],
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
        <MemoryRouter initialEntries={['/fulfillment/erve-dispatches/ed-1']}>
          <Routes>
            <Route path="/fulfillment/erve-dispatches/:id" element={<ErveDispatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading dispatch'));
}

describe('delivery confirmation preserves legacy quantity dependencies', () => {
  it.each([
    { role: 'ADMIN', status: 'PENDING_TALLY' },
    { role: 'ADMIN', status: 'INVOICED' },
    { role: 'MERCHANDISER', status: 'PENDING_TALLY' },
    { role: 'MERCHANDISER', status: 'INVOICED' },
  ] as const)('submits full defaults for $role with $status handoffs in both purchase modes', async ({ role, status }) => {
    const dispatch = buildDeliveryDispatch(status);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: dispatch } });
    await renderPage(async () => ({ data: { data: dispatch } }), role);
    const quantities = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(quantities.map((input) => input.value)).toEqual(['10', '25']);
    expect(quantities.map((input) => input.max)).toEqual(['10', '25']);
    expect(content()).not.toMatch(/Tally|PENDING_TALLY|INVOICED|Pending Tally|Invoice Handoff|Invoice Status|external-invoice/i);
    await clickConfirmDelivery();
    expect(patch).toHaveBeenCalledExactlyOnceWith('/erve-dispatches/ed-1/delivery', {
      expectedVersion: 7,
      lines: [
        { saleOrderLineId: 'sol-outright', receivedQuantity: 10 },
        { saleOrderLineId: 'sol-sale-return', receivedQuantity: 25 },
      ],
      remarks: undefined,
    });
  });

  it.each(['PENDING_TALLY', 'INVOICED'] as const)(
    'submits edited shortages and remarks without changing line identities for %s',
    async (status) => {
      const dispatch = buildDeliveryDispatch(status);
      const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: dispatch } });
      await renderPage(async () => ({ data: { data: dispatch } }));
      const quantities = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
      expect(quantities).toHaveLength(2);
      changeInput(quantities[0]!, '8');
      changeInput(quantities[1]!, '20');
      const remarks = Array.from(container.querySelectorAll('input')).find((input) =>
        input.closest('div')?.textContent?.includes('Delivery Remarks'),
      );
      expect(remarks).toBeDefined();
      changeInput(remarks!, 'Two outright and five consignment pieces short');
      await clickConfirmDelivery();
      expect(patch).toHaveBeenCalledExactlyOnceWith('/erve-dispatches/ed-1/delivery', {
        expectedVersion: 7,
        lines: [
          { saleOrderLineId: 'sol-outright', receivedQuantity: 8 },
          { saleOrderLineId: 'sol-sale-return', receivedQuantity: 20 },
        ],
        remarks: 'Two outright and five consignment pieces short',
      });
    },
  );
});

function buildDeliveryDispatch(status: 'PENDING_TALLY' | 'INVOICED'): ErveDispatchView {
  return buildDispatch({
    version: 7,
    totalQuantity: 35,
    invoiceHandoffs: [
      {
        invoiceHandoffId: 'ih-outright',
        saleOrderLineId: 'sol-outright',
        purchaseMode: 'OUTRIGHT',
        styleNumber: 'STYLE-OUT',
        styleName: 'Outright Tee',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 10,
        status,
        tallyInvoiceNumber: 'external-invoice-outright',
        tallyInvoiceDate: '2026-09-01',
      },
      {
        invoiceHandoffId: 'ih-sale-return',
        saleOrderLineId: 'sol-sale-return',
        purchaseMode: 'SALE_RETURN',
        styleNumber: 'STYLE-SR',
        styleName: 'Consignment Tee',
        sizeCode: 'L',
        sizeLabel: 'Large',
        quantity: 25,
        status,
        tallyInvoiceNumber: 'external-invoice-sale-return',
        tallyInvoiceDate: '2026-09-01',
      },
    ],
  });
}

async function clickConfirmDelivery() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent === 'Confirm Delivery',
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe('ErveDispatchDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 500');
    });

    expect(content()).not.toContain('Dispatch not found');
    expect(content()).toContain('Unable to load dispatch');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const dispatch = buildDispatch();
    await renderPage(async (url: string) => {
      if (url === '/erve-dispatches/ed-1') return { data: { data: dispatch } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('EID/26-27/0001');
    expect(content()).toContain('Distributor One');
    expect(content()).not.toContain('Unable to load dispatch');
  });
});

// NEW-AUTH: role-parametrized coverage for the mutation CTAs this page
// actually renders (canMutateErveDispatches — ERVE_DISPATCH_MUTATION_ROLES,
// ADMIN/MERCHANDISER), verified against the shared apps/web/src/auth/
// permissions.ts helper the component itself calls. No runtime change —
// the final audit found this gating already correct; this only makes the
// contract executable so future role drift is caught by tests.
describe('ErveDispatchDetailPage mutation-control visibility by role', () => {
  async function renderDispatched(role: Role, overrides: Partial<ErveDispatchView> = {}) {
    const dispatch = buildDispatch({ status: 'DISPATCHED', ...overrides });
    await renderPage(async (url: string) => {
      if (url === '/erve-dispatches/ed-1') return { data: { data: dispatch } };
      throw new Error(`Unexpected GET: ${url}`);
    }, role);
  }

  it.each<Role>(['ADMIN', 'MERCHANDISER'])(
    '%s sees both the Confirm Delivery and Update Transport/LR mutation panels on a DISPATCHED record',
    async (role) => {
      await renderDispatched(role);
      expect(content()).toContain('Confirm Delivery');
      expect(content()).toContain('Update Transport / LR Information');
    },
  );

  it.each<Role>(['SENIOR_MANAGEMENT', 'DISTRIBUTOR', 'ACCOUNTANT'])(
    '%s can read a DISPATCHED record but sees no mutation panel',
    async (role) => {
      await renderDispatched(role);
      expect(content()).toContain('EID/26-27/0001');
      expect(content()).not.toContain('Confirm Delivery');
      expect(content()).not.toContain('Update Transport / LR Information');
    },
  );

  it('document-state gating: ADMIN still loses Confirm Delivery once the record is DELIVERED, but keeps Update Transport/LR', async () => {
    await renderDispatched('ADMIN', { status: 'DELIVERED', deliveredAt: '2026-09-02T00:00:00.000Z', deliveredBy: { id: 'u2', name: 'Merch User', email: 'm@test.local' } });
    expect(content()).not.toContain('Confirm Delivery');
    expect(content()).toContain('Update Transport / LR Information');
  });
});
