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
import type { SaleOrder, SaleOrderStatus } from './types.js';

let container: HTMLDivElement;
let root: Root;

function mockUser(roles: Role[]): AuthUser {
  return { id: `user-${roles.join('-')}`, email: 'test@test.local', mobile: null, name: 'Test User', roles };
}

function setAuthUser(roles: Role[]) {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: mockUser(roles),
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

function buildSaleOrder(status: SaleOrderStatus): SaleOrder {
  return {
    id: 'so-1',
    saleOrderNumber: 'EISO/26-27/0099',
    distributor: { id: 'dist-1', code: 'DIST-1', name: 'Test Distributor' },
    financialYear: { id: 'fy-1', code: '26-27' },
    soDate: '2026-06-30T00:00:00.000Z',
    status,
    totalRequestedQuantity: 70,
    totalApprovedQuantity: 40,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    version: 3,
    creator: { id: 'dist-user-1', name: 'Distributor User', email: 'distributor@test.local' },
    reviewedBy: { id: 'merch-1', name: 'Merchandiser', email: 'merch@test.local' },
    remarks: null,
    submittedAt: '2026-06-30T00:00:00.000Z',
    reviewedAt: '2026-06-30T00:00:00.000Z',
    decisionReason: null,
    lines: [
      {
        id: 'line-1',
        purchaseOrderLineSizeId: 'pols-1',
        purchaseOrderId: 'po-1',
        poNumber: 'PO-1',
        styleId: 'style-1',
        styleNumber: 'ST-1',
        styleName: 'Test Style',
        sizeId: 'size-1',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        orderedQuantity: 100,
        qaPassedQuantity: 110,
        requestedQuantity: 70,
        approvedQuantity: 40,
        remarks: null,
        allocations: [
          {
            id: 'alloc-1',
            quantity: 40,
            status: 'ACTIVE',
            allocationSource: 'DISTRIBUTOR_REQUEST',
            reason: null,
            createdAt: '2026-06-30T00:00:00.000Z',
            source: null,
          },
        ],
      },
    ],
  };
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

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Radix Dialog content (the confirm dialogs) renders through a portal
// mounted on document.body, outside `container` — search the whole body so
// dialog-only buttons/text are found too.
function findButtonByText(text: string): HTMLButtonElement | null {
  return (
    [...document.body.querySelectorAll('button')].find((btn) => btn.textContent?.trim() === text) ?? null
  );
}

// The sale order detail query resolves asynchronously (react-query +
// mocked apiClient), so a single microtask flush after render is not
// reliably enough ticks for the loaded view to have committed — poll until
// the loading state clears instead of assuming one flush suffices.
async function waitForLoaded(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (!container.textContent?.includes('Loading sale order')) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for sale order detail to load');
}

async function renderPage(order: SaleOrder) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/sale-orders/${order.id}`) return { data: { data: order } };
    if (url === '/sale-orders/inventory') return { data: { data: [] } };
    throw new Error(`Unexpected GET: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/sale-orders/${order.id}`]}>
          <Routes>
            <Route path="/sale-orders/:id" element={<SaleOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitForLoaded();
}

describe('SaleOrderDetailPage — APPROVED cancellation visibility', () => {
  it('shows the Cancel action for ADMIN on an APPROVED sale order', async () => {
    setAuthUser(['ADMIN']);
    await renderPage(buildSaleOrder('APPROVED'));
    expect(findButtonByText('Cancel')).not.toBeNull();
  });

  it('shows the Cancel action for MERCHANDISER on an APPROVED sale order', async () => {
    setAuthUser(['MERCHANDISER']);
    await renderPage(buildSaleOrder('APPROVED'));
    expect(findButtonByText('Cancel')).not.toBeNull();
  });

  it('hides the Cancel action for DISTRIBUTOR on an APPROVED sale order', async () => {
    setAuthUser(['DISTRIBUTOR']);
    await renderPage(buildSaleOrder('APPROVED'));
    expect(findButtonByText('Cancel')).toBeNull();
  });

  it('hides the Cancel action for a read-only role (SENIOR_MANAGEMENT) on an APPROVED sale order', async () => {
    setAuthUser(['SENIOR_MANAGEMENT']);
    await renderPage(buildSaleOrder('APPROVED'));
    expect(findButtonByText('Cancel')).toBeNull();
  });

  it('still shows the Cancel action for DISTRIBUTOR on a DRAFT sale order (pre-approval cancellation unchanged)', async () => {
    setAuthUser(['DISTRIBUTOR']);
    await renderPage(buildSaleOrder('DRAFT'));
    expect(findButtonByText('Cancel')).not.toBeNull();
  });

  it('confirming the dialog calls the existing cancel API for an APPROVED order', async () => {
    setAuthUser(['MERCHANDISER']);
    const order = buildSaleOrder('APPROVED');
    await renderPage(order);

    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { ...order, status: 'CANCELLED' } },
    } as never);

    act(() => {
      findButtonByText('Cancel')!.click();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(document.body.textContent).toContain(
      'committed stock will be released back to available QA-released inventory',
    );

    act(() => {
      findButtonByText('Cancel Sale Order')!.click();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(postSpy).toHaveBeenCalledWith(
      `/sale-orders/${order.id}/actions/cancel`,
      expect.objectContaining({ expectedVersion: order.version }),
    );
  });
});
