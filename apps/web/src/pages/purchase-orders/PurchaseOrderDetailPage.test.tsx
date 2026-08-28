/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, PurchaseOrderBalance, Role } from '@erve/types';
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildPO(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'EIPO/25-26/0001',
    distributor: { id: 'dist-1', code: 'D001', name: 'Test Distributor' },
    financialYear: { id: 'fy-1', code: 'FY2025-26' },
    poDate: '2026-01-01T00:00:00.000Z',
    requiredDeliveryDate: null,
    purchaseMode: 'OUTRIGHT',
    status: 'PARTIALLY_JOB_ORDERED',
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
            jobOrderedQuantity: 0,
            qaPassedQuantity: 0,
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
            jobOrderedQuantity: 0,
            qaPassedQuantity: 0,
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
            jobOrderedQuantity: 0,
            qaPassedQuantity: 0,
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

function buildBalance(
  sizes: Array<{ ordered: number; jobOrdered: number }>,
): PurchaseOrderBalance {
  const codes = ['S', 'M', 'L'];
  return {
    poId: 'po-1',
    poNumber: 'EIPO/25-26/0001',
    version: 1,
    lines: [
      {
        lineId: 'line-1',
        styleId: 'style-1',
        styleNumber: 'ST-101',
        styleName: 'Oxford Shirt',
        colour: null,
        sizes: sizes.map((size, index) => ({
          purchaseOrderLineSizeId: `size-${codes[index]!.toLowerCase()}`,
          sizeId: `sz-${codes[index]!.toLowerCase()}`,
          sizeCode: codes[index]!,
          sizeLabel: codes[index]!,
          orderedQuantity: size.ordered,
          jobOrderedQuantity: size.jobOrdered,
          balanceQuantity: size.ordered - size.jobOrdered,
        })),
      },
    ],
  };
}

async function renderPage(balance: PurchaseOrderBalance | (() => Promise<PurchaseOrderBalance>)) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/purchase-orders/po-1') return { data: { data: buildPO() } };
    if (url === '/purchase-orders/po-1/job-order-balance') {
      const data = typeof balance === 'function' ? await balance() : balance;
      return { data: { data } };
    }
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
  await vi.waitFor(() => expect(content()).not.toContain('Loading purchase order'));
}

const content = () => container.textContent ?? '';

function createJobOrderLink(): HTMLAnchorElement | null {
  return (
    (Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Create Job Order',
    ) as HTMLAnchorElement | undefined) ?? null
  );
}

async function renderPageForVisibility(options: {
  role?: Role;
  poOverrides?: Partial<PurchaseOrder>;
  balance: PurchaseOrderBalance;
}) {
  mockAuth(options.role ?? 'ADMIN');
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/purchase-orders/po-1') return { data: { data: buildPO(options.poOverrides) } };
    if (url === '/purchase-orders/po-1/job-order-balance') return { data: { data: options.balance } };
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
  await vi.waitFor(() => expect(content()).not.toContain('Loading purchase order'));
  await vi.waitFor(() => expect(content()).not.toContain('Loading job order balance'));
}

describe('PurchaseOrderDetailPage Job Order Balance', () => {
  it('never renders the retired "Pending job order module" placeholder', async () => {
    await renderPage(buildBalance([{ ordered: 100, jobOrdered: 0 }, { ordered: 150, jobOrdered: 0 }, { ordered: 100, jobOrdered: 0 }]));
    expect(content()).not.toContain('Pending job order module');
  });

  it('shows the full PO quantity as remaining when no Job Orders exist yet', async () => {
    await renderPage(
      buildBalance([
        { ordered: 100, jobOrdered: 0 },
        { ordered: 150, jobOrdered: 0 },
        { ordered: 100, jobOrdered: 0 },
      ]),
    );
    expect(content()).toContain('Total ordered');
    expect(content()).toContain('350');
    expect(content()).toContain('Job ordered');
    expect(content()).toContain('Remaining balance');
    expect(content()).toContain('No Job Orders created yet');
  });

  it('reflects allocated and remaining quantities for a partially job-ordered PO', async () => {
    // S=100 (JO claims 40), M=150 (JO claims 50), L=100 (JO claims 25)
    await renderPage(
      buildBalance([
        { ordered: 100, jobOrdered: 40 },
        { ordered: 150, jobOrdered: 50 },
        { ordered: 100, jobOrdered: 25 },
      ]),
    );
    expect(content()).toContain('350'); // total ordered
    expect(content()).toContain('115'); // total job ordered (40+50+25)
    expect(content()).toContain('235'); // total remaining (60+100+75)
    expect(content()).toContain('Partially allocated across Job Orders');
  });

  it('aggregates balances correctly across multiple Job Orders claiming the same PO', async () => {
    // Two Job Orders have claimed against this PO; the balance endpoint
    // already returns the summed jobOrderedQuantity per size.
    // S: JO1=40 + JO2=20 = 60 of 100; M: JO1=50 + JO2=40 = 90 of 150;
    // L: JO1=25 + JO2=25 = 50 of 100.
    await renderPage(
      buildBalance([
        { ordered: 100, jobOrdered: 60 },
        { ordered: 150, jobOrdered: 90 },
        { ordered: 100, jobOrdered: 50 },
      ]),
    );
    expect(content()).toContain('350'); // total ordered
    expect(content()).toContain('200'); // total job ordered (60+90+50)
    expect(content()).toContain('150'); // total remaining (40+60+50)
    expect(content()).toContain('Partially allocated across Job Orders');
  });

  it('shows a zero remaining balance once the PO is fully allocated', async () => {
    await renderPage(
      buildBalance([
        { ordered: 100, jobOrdered: 100 },
        { ordered: 150, jobOrdered: 150 },
        { ordered: 100, jobOrdered: 100 },
      ]),
    );
    expect(content()).toContain('350'); // total ordered
    expect(content()).toContain('Fully allocated across Job Orders');
    // "Remaining balance" row renders 0 rather than a fabricated or stale value.
    const totalsPanel = Array.from(container.querySelectorAll('div')).find((el) =>
      el.textContent?.includes('Remaining balance'),
    );
    expect(totalsPanel?.textContent).toContain('0');
  });

  it('shows a loading state and no fabricated totals while the balance is in flight', async () => {
    let resolveBalance!: (value: PurchaseOrderBalance) => void;
    const pending = new Promise<PurchaseOrderBalance>((resolve) => {
      resolveBalance = resolve;
    });
    await renderPage(() => pending);

    expect(content()).toContain('Loading job order balance');
    expect(content()).not.toContain('Remaining balance');

    await act(async () => {
      resolveBalance(buildBalance([{ ordered: 100, jobOrdered: 0 }]));
      await flush();
    });
    expect(content()).toContain('Remaining balance');
  });

  it('shows an error state when the balance request fails', async () => {
    await renderPage(() => {
      throw new Error('Balance service unavailable');
    });

    await vi.waitFor(() => expect(content()).toContain('Unable to load job order balance'));
    expect(content()).toContain('Balance service unavailable');
    expect(content()).not.toContain('Pending job order module');
  });
});

describe('PurchaseOrderDetailPage Create Job Order visibility', () => {
  it('shows Create Job Order for an authorized user when the full quantity is remaining', async () => {
    await renderPageForVisibility({
      balance: buildBalance([
        { ordered: 100, jobOrdered: 0 },
        { ordered: 150, jobOrdered: 0 },
        { ordered: 100, jobOrdered: 0 },
      ]),
    });
    const link = createJobOrderLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/job-orders/new?purchaseOrderId=po-1');
  });

  it('shows Create Job Order for an authorized user when only part of the quantity is remaining', async () => {
    // S=100 (JO claims 100, exhausted), M=150 (JO claims 50, remaining), L=100 (untouched)
    await renderPageForVisibility({
      balance: buildBalance([
        { ordered: 100, jobOrdered: 100 },
        { ordered: 150, jobOrdered: 50 },
        { ordered: 100, jobOrdered: 0 },
      ]),
    });
    expect(createJobOrderLink()).not.toBeNull();
  });

  it('hides Create Job Order once every size has zero remaining balance', async () => {
    await renderPageForVisibility({
      balance: buildBalance([
        { ordered: 100, jobOrdered: 100 },
        { ordered: 150, jobOrdered: 150 },
        { ordered: 100, jobOrdered: 100 },
      ]),
    });
    expect(createJobOrderLink()).toBeNull();
  });

  it('does not hide Create Job Order for an unauthorized user just because balance remains', async () => {
    await renderPageForVisibility({
      role: 'FACTORY_USER',
      balance: buildBalance([
        { ordered: 100, jobOrdered: 0 },
        { ordered: 150, jobOrdered: 0 },
        { ordered: 100, jobOrdered: 0 },
      ]),
    });
    expect(createJobOrderLink()).toBeNull();
  });

  it('does not let a permissive status expose Create Job Order when the canonical balance is zero', async () => {
    // SUBMITTED is not one of the excluded statuses, so a status-only check
    // would incorrectly show the button; the canonical balance must win.
    await renderPageForVisibility({
      poOverrides: { status: 'SUBMITTED' },
      balance: buildBalance([
        { ordered: 100, jobOrdered: 100 },
        { ordered: 150, jobOrdered: 150 },
        { ordered: 100, jobOrdered: 100 },
      ]),
    });
    expect(createJobOrderLink()).toBeNull();
  });

  it('does not let a stale FULLY_JOB_ORDERED-looking status hide Create Job Order when balance still remains', async () => {
    // Regression guard for the original bug: FULLY_JOB_ORDERED was never in
    // the status exclusion list, so the fix must rely on the balance figure
    // rather than assuming the status name reflects true remaining quantity.
    await renderPageForVisibility({
      poOverrides: { status: 'FULLY_JOB_ORDERED' },
      balance: buildBalance([
        { ordered: 100, jobOrdered: 40 },
        { ordered: 150, jobOrdered: 50 },
        { ordered: 100, jobOrdered: 25 },
      ]),
    });
    expect(createJobOrderLink()).not.toBeNull();
  });
});
