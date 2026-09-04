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
import type { SaleOrder, SaleOrderAuditEntry, SaleOrderStatus } from './types.js';

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
    fulfilledBy: null,
    remarks: null,
    submittedAt: '2026-06-30T00:00:00.000Z',
    reviewedAt: '2026-06-30T00:00:00.000Z',
    fulfilledAt: null,
    fulfillmentReference: null,
    decisionReason: null,
    fulfillment:
      status === 'APPROVED' || status === 'FULFILLED'
        ? {
            stage: status === 'FULFILLED' ? 'DISPATCHED_IN_FULL' : 'AWAITING_FACTORY_PACKING',
            totalApprovedQuantity: 40,
            totalFactoryPackedQuantity: 0,
            totalDispatchedQuantity: status === 'FULFILLED' ? 40 : 0,
            lines: [],
            isLegacyFulfilled: false,
          }
        : {
            stage: 'NOT_APPLICABLE',
            totalApprovedQuantity: 0,
            totalFactoryPackedQuantity: 0,
            totalDispatchedQuantity: 0,
            lines: [],
            isLegacyFulfilled: false,
          },
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

async function waitForAuditLoaded(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (!container.textContent?.includes('Loading history')) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for audit history to load');
}

async function renderPage(order: SaleOrder, auditEntries: SaleOrderAuditEntry[] = []) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/sale-orders/${order.id}`) return { data: { data: order } };
    if (url === '/sale-orders/inventory') return { data: { data: [] } };
    if (url === `/sale-orders/${order.id}/audit`) return { data: { data: auditEntries } };
    if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } } };
    if (url === '/erve-dispatches') return { data: { data: { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } } };
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

  it('hides the Cancel action for a read-only role (SENIOR_MANAGEMENT) on a DRAFT sale order too', async () => {
    // Regression guard: canCancel must be gated by role on every status, not
    // only APPROVED — a read-only viewer must never see Cancel at all, even
    // though the backend's cancel route guard would also reject the call.
    setAuthUser(['SENIOR_MANAGEMENT']);
    await renderPage(buildSaleOrder('DRAFT'));
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

const PLACEHOLDER_COPY = 'Audit history for this sale order will be available in a future update.';

function buildAuditEntries(): SaleOrderAuditEntry[] {
  return [
    {
      id: 'audit-1',
      action: 'SALE_ORDER_CREATED',
      title: 'Sale Order Created',
      detail: null,
      actor: { id: 'dist-user-1', name: 'Distributor User', email: 'distributor@test.local' },
      createdAt: '2026-06-30T08:00:00.000Z',
    },
    {
      id: 'audit-2',
      action: 'SALE_ORDER_SUBMITTED',
      title: 'Submitted',
      detail: '70 unit(s) reserved from available stock',
      actor: { id: 'dist-user-1', name: 'Distributor User', email: 'distributor@test.local' },
      createdAt: '2026-06-30T09:00:00.000Z',
    },
    {
      id: 'audit-3',
      action: 'SALE_ORDER_APPROVED',
      title: 'Approved',
      detail: 'Reason: Partial stock available',
      actor: { id: 'merch-1', name: 'Merchandiser', email: 'merch@test.local' },
      createdAt: '2026-06-30T10:00:00.000Z',
    },
    {
      id: 'audit-4',
      action: 'SALE_ORDER_CANCELLED',
      title: 'Cancelled',
      detail: 'Cancelled from Approved; committed allocations released.',
      actor: { id: 'merch-1', name: 'Merchandiser', email: 'merch@test.local' },
      createdAt: '2026-06-30T11:00:00.000Z',
    },
  ];
}

describe('SaleOrderDetailPage — Audit Trail', () => {
  it('fetches and renders real audit history, replacing the old placeholder', async () => {
    setAuthUser(['ADMIN']);
    await renderPage(buildSaleOrder('CANCELLED'), buildAuditEntries());
    await waitForAuditLoaded();

    expect(document.body.textContent).not.toContain(PLACEHOLDER_COPY);
    expect(document.body.textContent).toContain('Sale Order Created');
    expect(document.body.textContent).toContain('Submitted');
    expect(document.body.textContent).toContain('70 unit(s) reserved from available stock');
    expect(document.body.textContent).toContain('Distributor User');
    expect(document.body.textContent).toContain('Merchandiser');
  });

  it('renders the approval event with its requested/approved detail', async () => {
    setAuthUser(['ADMIN']);
    await renderPage(buildSaleOrder('APPROVED'), buildAuditEntries());
    await waitForAuditLoaded();

    expect(document.body.textContent).toContain('Approved');
    expect(document.body.textContent).toContain('Reason: Partial stock available');
  });

  it('renders the cancellation event distinguishing an APPROVED cancellation', async () => {
    setAuthUser(['ADMIN']);
    await renderPage(buildSaleOrder('CANCELLED'), buildAuditEntries());
    await waitForAuditLoaded();

    expect(document.body.textContent).toContain('Cancelled from Approved; committed allocations released.');
  });

  it('shows a loading state while audit history is being fetched', async () => {
    setAuthUser(['ADMIN']);
    const order = buildSaleOrder('DRAFT');
    let resolveAudit!: (value: { data: { data: SaleOrderAuditEntry[] } }) => void;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === `/sale-orders/${order.id}`) return { data: { data: order } };
      if (url === '/sale-orders/inventory') return { data: { data: [] } };
      if (url === `/sale-orders/${order.id}/audit`) {
        return new Promise((resolve) => {
          resolveAudit = resolve;
        });
      }
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

    expect(container.textContent).toContain('Loading history');

    await act(async () => {
      resolveAudit({ data: { data: [] } });
    });
    await waitForAuditLoaded();
    expect(container.textContent).not.toContain('Loading history');
  });

  it('shows an error state when the audit request fails', async () => {
    setAuthUser(['ADMIN']);
    const order = buildSaleOrder('DRAFT');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === `/sale-orders/${order.id}`) return { data: { data: order } };
      if (url === '/sale-orders/inventory') return { data: { data: [] } };
      if (url === `/sale-orders/${order.id}/audit`) throw new Error('network error');
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
    await waitForAuditLoaded();

    expect(container.textContent).toContain('Unable to load audit history.');
  });

  it('shows a genuine empty state when there is no audit history, without the old placeholder', async () => {
    setAuthUser(['ADMIN']);
    await renderPage(buildSaleOrder('DRAFT'), []);
    await waitForAuditLoaded();

    expect(container.textContent).toContain('No audit history available.');
    expect(document.body.textContent).not.toContain(PLACEHOLDER_COPY);
  });

  it('renders a Distributor-safe audit response without cross-distributor provenance', async () => {
    setAuthUser(['DISTRIBUTOR']);
    const safeEntries: SaleOrderAuditEntry[] = [
      ...buildAuditEntries().slice(0, 3),
      {
        id: 'audit-3b',
        action: 'SALE_ORDER_LINE_APPROVED',
        title: 'Line Approved',
        detail: 'ST-1 / Medium: Requested 70 → Approved 55; +15 additional stock allocated by Merchandiser',
        actor: { id: 'merch-1', name: 'Merchandiser', email: 'merch@test.local' },
        createdAt: '2026-06-30T10:05:00.000Z',
      },
    ];
    await renderPage(buildSaleOrder('APPROVED'), safeEntries);
    await waitForAuditLoaded();

    expect(document.body.textContent).toContain('additional stock allocated by Merchandiser');
    expect(document.body.textContent).not.toContain('Secret Distributor');
    expect(document.body.textContent).not.toContain('sourced from');
  });
});

describe('SaleOrderDetailPage — ACCOUNTANT read-only access', () => {
  it('shows quantities/status and the Audit Trail, but no mutation controls, on a DRAFT sale order', async () => {
    setAuthUser(['ACCOUNTANT']);
    await renderPage(buildSaleOrder('DRAFT'), buildAuditEntries());
    await waitForAuditLoaded();

    expect(document.body.textContent).toContain('EISO/26-27/0099');
    expect(document.body.textContent).toContain('70');
    expect(document.body.textContent).toContain('40');
    expect(document.body.textContent).toContain('Sale Order Created');

    expect(findButtonByText('Edit')).toBeNull();
    expect(findButtonByText('Submit')).toBeNull();
    expect(findButtonByText('Start Review')).toBeNull();
    expect(findButtonByText('Cancel')).toBeNull();
  });

  it('hides Start Review/Approve/Reject on a SUBMITTED sale order', async () => {
    setAuthUser(['ACCOUNTANT']);
    await renderPage(buildSaleOrder('SUBMITTED'));
    expect(findButtonByText('Start Review')).toBeNull();
    expect(findButtonByText('Cancel')).toBeNull();
  });

  it('hides Approve/Reject on an UNDER_REVIEW sale order', async () => {
    setAuthUser(['ACCOUNTANT']);
    await renderPage(buildSaleOrder('UNDER_REVIEW'));
    expect(findButtonByText('Approve')).toBeNull();
    expect(findButtonByText('Reject')).toBeNull();
    expect(findButtonByText('Cancel')).toBeNull();
  });

  it('hides Cancel on an APPROVED sale order', async () => {
    setAuthUser(['ACCOUNTANT']);
    await renderPage(buildSaleOrder('APPROVED'));
    expect(findButtonByText('Cancel')).toBeNull();
  });
});
