/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { PurchaseOrderDetailPage } from './PurchaseOrderDetailPage.js';
import type { PurchaseOrder } from './types.js';

let container: HTMLDivElement;
let root: Root;

function mockAuth(role: Role) {
  const user: AuthUser = {
    id: 'user-1',
    email: 'user@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };
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
  mockAuth('ADMIN');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function buildPO(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'EIOS/25-26/0001',
    distributor: { id: 'dist-1', code: 'D001', name: 'Test Distributor' },
    financialYear: { id: 'fy-1', code: 'FY2025-26' },
    poDate: '2026-01-01T00:00:00.000Z',
    requiredDeliveryDate: null,
    purchaseMode: 'OUTRIGHT',
    status: 'SUBMITTED',
    jobOrderId: null,
    lockedByJobOrder: null,
    totalOrderedQuantity: 350,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    merchandiser: { id: 'user-1', name: 'Merch One', email: 'merch@test.local' },
    creator: { id: 'user-1', name: 'Merch One', email: 'merch@test.local' },
    remarks: null,
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: 'ST-101',
        styleName: 'Oxford Shirt',
        lineStatus: 'ACTIVE',
        remarks: null,
        seasonSnapshots: [],
        totalOrderedQuantity: 350,
        sizes: [
          {
            id: 'size-s',
            sizeId: 'sz-s',
            sizeCode: 'S',
            sizeLabel: 'Small',
            orderedQuantity: 100,
            saleOrderedQuantity: 0,
            dispatchedQuantity: 0,
            deliveredQuantity: 0,
            actualSoldQuantity: 0,
            returnedQuantity: 0,
            reassignedQuantity: 0,
          },
          {
            id: 'size-m',
            sizeId: 'sz-m',
            sizeCode: 'M',
            sizeLabel: 'Medium',
            orderedQuantity: 150,
            saleOrderedQuantity: 0,
            dispatchedQuantity: 0,
            deliveredQuantity: 0,
            actualSoldQuantity: 0,
            returnedQuantity: 0,
            reassignedQuantity: 0,
          },
          {
            id: 'size-l',
            sizeId: 'sz-l',
            sizeCode: 'L',
            sizeLabel: 'Large',
            orderedQuantity: 100,
            saleOrderedQuantity: 0,
            dispatchedQuantity: 0,
            deliveredQuantity: 0,
            actualSoldQuantity: 0,
            returnedQuantity: 0,
            reassignedQuantity: 0,
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function renderPage(po: PurchaseOrder = buildPO(), role: Role = 'ADMIN') {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/purchase-orders/po-1') return { data: { data: po } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
          <Routes>
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading Order Sheet'));
}

const content = () => container.textContent ?? '';

function createJobOrderLink(): HTMLAnchorElement | null {
  return (
    (Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Create Job Order',
    ) as HTMLAnchorElement | undefined) ?? null
  );
}

function editLink(): HTMLAnchorElement | null {
  return (
    (Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Edit',
    ) as HTMLAnchorElement | undefined) ?? null
  );
}

function cancelButton(): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel Order Sheet',
    ) as HTMLButtonElement | undefined) ?? null
  );
}

describe('PurchaseOrderDetailPage Style and Size-wise Quantities', () => {
  it('does not present the dead Job Ordered/Dispatched/Delivered columns as lifecycle information', async () => {
    await renderPage();
    const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers).not.toContain('Job Ordered');
    expect(headers).not.toContain('Dispatched');
    expect(headers).not.toContain('Delivered');
  });

  it('renders size rows with the forecast quantity', async () => {
    await renderPage();
    const headers = Array.from(container.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers).toContain('Size');
    expect(headers).toContain('Forecast Qty');
    expect(content()).toContain('ST-101');
    expect(content()).toContain('Oxford Shirt');
    expect(content()).toContain('S');
    expect(content()).toContain('M');
    expect(content()).toContain('L');
  });
});

describe('PurchaseOrderDetailPage Planning State', () => {
  it('shows "Available for Job Order" when unlocked and not cancelled', async () => {
    await renderPage(buildPO({ status: 'SUBMITTED', jobOrderId: null }));
    expect(content()).toContain('Available for Job Order');
  });

  it('shows "Included in Job Order" once a Job Order has claimed it', async () => {
    await renderPage(
      buildPO({
        status: 'SUBMITTED',
        jobOrderId: 'jo-1',
        lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/25-26/0001', status: 'DRAFT' },
      }),
    );
    expect(content()).toContain('Included in Job Order');
  });

  it('shows "Cancelled" for a cancelled Order Sheet', async () => {
    await renderPage(buildPO({ status: 'CANCELLED', jobOrderId: null }));
    expect(content()).toContain('Cancelled');
  });

  it('still shows locked, never Available, even if the linked Job Order is itself cancelled', async () => {
    await renderPage(
      buildPO({
        status: 'SUBMITTED',
        jobOrderId: 'jo-1',
        lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/25-26/0001', status: 'CANCELLED' },
      }),
    );
    expect(content()).toContain('Included in Job Order');
    expect(content()).not.toContain('Available for Job Order');
    expect(content()).toContain('EIJO/25-26/0001');
    expect(content()).toContain('CANCELLED');
  });
});

describe('PurchaseOrderDetailPage lock behaviour', () => {
  it('shows Edit and Cancel Order Sheet while unlocked', async () => {
    await renderPage(buildPO({ status: 'SUBMITTED', jobOrderId: null }));
    expect(editLink()).not.toBeNull();
    expect(cancelButton()).not.toBeNull();
  });

  it('hides Edit and Cancel Order Sheet once locked by a Job Order', async () => {
    await renderPage(
      buildPO({
        status: 'SUBMITTED',
        jobOrderId: 'jo-1',
        lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/25-26/0001', status: 'DRAFT' },
      }),
    );
    expect(editLink()).toBeNull();
    expect(cancelButton()).toBeNull();
  });

  it('hides Edit and Cancel Order Sheet once cancelled', async () => {
    await renderPage(buildPO({ status: 'CANCELLED', jobOrderId: null }));
    expect(editLink()).toBeNull();
    expect(cancelButton()).toBeNull();
  });

  it('never renders a Submit action — there is no Submit/Review workflow', async () => {
    await renderPage();
    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Submit',
    );
    expect(submitButton).toBeUndefined();
  });
});

// UXAUTH-010: Edit/Cancel Order Sheet must reflect BOTH the actor's
// PURCHASE_ORDER_MANAGE_ROLES mutation capability (matching the API's
// purchase-orders.routes.ts canManagePOs guard on PATCH /:id and
// POST /:id/actions/cancel) AND the existing document-state lock —
// SENIOR_MANAGEMENT can read Order Sheets (PURCHASE_ORDER_VIEW_ROLES) but
// must never see Edit/Cancel, even while unlocked. These tests must not
// weaken the pre-existing lock-state tests above (still passing with ADMIN).
describe('PurchaseOrderDetailPage role-gated Edit/Cancel (UXAUTH-010)', () => {
  it('hides Edit and Cancel Order Sheet for SENIOR_MANAGEMENT even while unlocked', async () => {
    await renderPage(buildPO({ status: 'SUBMITTED', jobOrderId: null }), 'SENIOR_MANAGEMENT');
    expect(editLink()).toBeNull();
    expect(cancelButton()).toBeNull();
    // Read-only content remains available.
    expect(content()).toContain('Available for Job Order');
  });

  it('shows Edit and Cancel Order Sheet for MERCHANDISER (an authorized mutation role) while unlocked', async () => {
    await renderPage(buildPO({ status: 'SUBMITTED', jobOrderId: null }), 'MERCHANDISER');
    expect(editLink()).not.toBeNull();
    expect(cancelButton()).not.toBeNull();
  });

  it('still hides Edit and Cancel Order Sheet for an authorized MERCHANDISER once locked by a Job Order', async () => {
    await renderPage(
      buildPO({
        status: 'SUBMITTED',
        jobOrderId: 'jo-1',
        lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/25-26/0001', status: 'DRAFT' },
      }),
      'MERCHANDISER',
    );
    expect(editLink()).toBeNull();
    expect(cancelButton()).toBeNull();
  });
});

describe('PurchaseOrderDetailPage Create Job Order visibility', () => {
  it('shows Create Job Order for an authorized user while unlocked', async () => {
    await renderPage(buildPO({ status: 'SUBMITTED', jobOrderId: null }), 'ADMIN');
    const link = createJobOrderLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/job-orders/new?purchaseOrderId=po-1');
  });

  it('hides Create Job Order once already locked by a Job Order', async () => {
    await renderPage(
      buildPO({
        status: 'SUBMITTED',
        jobOrderId: 'jo-1',
        lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/25-26/0001', status: 'DRAFT' },
      }),
      'ADMIN',
    );
    expect(createJobOrderLink()).toBeNull();
  });

  it('hides Create Job Order for a cancelled Order Sheet', async () => {
    await renderPage(buildPO({ status: 'CANCELLED', jobOrderId: null }), 'ADMIN');
    expect(createJobOrderLink()).toBeNull();
  });

  it('does not show Create Job Order for an unauthorized user even while unlocked', async () => {
    await renderPage(buildPO({ status: 'SUBMITTED', jobOrderId: null }), 'FACTORY_USER');
    expect(createJobOrderLink()).toBeNull();
  });
});

// UXAUTH-018: a failed fetch (403/500/network error) must render the real
// ErrorState, not fall through to the "Order Sheet not found" EmptyState —
// that EmptyState is reserved for a genuine no-such-record response.
describe('PurchaseOrderDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    mockAuth('ADMIN');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/purchase-orders/po-1') throw new Error('Request failed with status code 500');
      throw new Error(`Unexpected request: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
            <Routes>
              <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).not.toContain('Loading Order Sheet'));

    expect(content()).not.toContain('Order Sheet not found');
    expect(content()).toContain('Unable to load Order Sheet');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
