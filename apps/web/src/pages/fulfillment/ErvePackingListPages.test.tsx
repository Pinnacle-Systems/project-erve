/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ErvePackingListListPage } from './ErvePackingListListPage.js';
import { ErvePackingListCreatePage } from './ErvePackingListCreatePage.js';
import { ErvePackingListDetailPage } from './ErvePackingListDetailPage.js';
import type { EligibleErveCartonView, ErvePackingListDetail, ErvePackingListSummary } from './types.js';

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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const content = () => container.textContent ?? '';

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined) ?? null;
}

function checkboxByLabel(label: string): HTMLInputElement | null {
  return container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
}

function renderAt(initialPath: string, routePath: string, element: React.ReactElement) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

function buildCarton(overrides: Partial<EligibleErveCartonView> = {}): EligibleErveCartonView {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    factoryDispatchId: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    destination: { id: 'dest-1', label: null, city: 'Chennai', state: 'TN' },
    packageDetails: null,
    weight: null,
    totalQuantity: 20,
    lines: [{ saleOrderLineId: 'line-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20 }],
    ...overrides,
  };
}

function buildSummary(overrides: Partial<ErvePackingListSummary> = {}): ErvePackingListSummary {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    destination: {
      label: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      addressLine1: 'Test Address',
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
    totalQuantity: 20,
    sourceFactories: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One' }],
    sourceDispatchOrders: [{ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    ...overrides,
  };
}

function buildDetail(overrides: Partial<ErvePackingListDetail> = {}): ErvePackingListDetail {
  return {
    ...buildSummary(),
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
        totalQuantity: 20,
        lines: [
          {
            saleOrderLineId: 'line-1',
            styleId: 'style-1',
            styleNumber: 'ST-001',
            styleName: 'Classic Tee',
            primaryImage: null,
            sizeCode: 'M',
            sizeLabel: 'Medium',
            quantity: 20,
          },
        ],
      },
    ],
    styleSizeSummary: [
      { styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeCode: 'M', sizeLabel: 'Medium', quantity: 20 },
    ],
    ...overrides,
  };
}

describe('ErvePackingListListPage', () => {
  it('shows the Create button for a Merchandiser and lists existing packing lists', async () => {
    mockAuth('MERCHANDISER');
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [buildSummary()], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    } as never);

    renderAt('/fulfillment/erve-packing-lists', '/fulfillment/erve-packing-lists', <ErvePackingListListPage />);
    await flush();

    expect(content()).toContain('EIPL/26-27/0001');
    expect(buttonByText('Create Erve Packing List')).not.toBeNull();
  });

  it('hides the Create button from a DISTRIBUTOR', async () => {
    mockAuth('DISTRIBUTOR');
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    } as never);

    renderAt('/fulfillment/erve-packing-lists', '/fulfillment/erve-packing-lists', <ErvePackingListListPage />);
    await flush();

    expect(buttonByText('Create Erve Packing List')).toBeNull();
  });
});

describe('ErvePackingListCreatePage', () => {
  it('lists eligible cartons and creates a packing list from the selected carton', async () => {
    mockAuth('MERCHANDISER');
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: { items: [buildCarton()], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } } as never);
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: { id: 'epl-1' } } } as never);

    renderAt('/fulfillment/erve-packing-lists/new', '/fulfillment/erve-packing-lists/new', <ErvePackingListCreatePage />);
    await flush();

    expect(content()).toContain('C1');
    expect(buttonByText('Create Erve Packing List')?.disabled).toBe(true);

    checkboxByLabel('Select carton C1')!.click();
    await flush();

    expect(content()).toContain('Chennai, TN');
    const createButton = buttonByText('Create Erve Packing List');
    expect(createButton?.disabled).toBe(false);
    createButton!.click();
    await flush();

    expect(postSpy).toHaveBeenCalledWith('/erve-packing-lists', { cartonIds: ['carton-1'] });
  });
});

describe('ErvePackingListDetailPage', () => {
  it('OPEN status offers Add Cartons and Finalize, but not the dispatch form', async () => {
    mockAuth('MERCHANDISER');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') return { data: { data: buildDetail() } };
      if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    renderAt('/fulfillment/erve-packing-lists/epl-1', '/fulfillment/erve-packing-lists/:id', <ErvePackingListDetailPage />);
    await flush();

    expect(content()).toContain('EIPL/26-27/0001');
    expect(buttonByText('Finalize Packing List')).not.toBeNull();
    expect(buttonByText('Record Dispatch')).toBeNull();
  });

  it('FINALIZED status shows the Record Dispatch form and records a dispatch', async () => {
    mockAuth('MERCHANDISER');
    const detail = buildDetail({ status: 'FINALIZED', finalizedBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' }, finalizedAt: '2026-09-02T00:00:00.000Z' });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') return { data: { data: detail } };
      throw new Error(`Unexpected GET: ${url}`);
    });
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: { id: 'ed-1' } } } as never);

    renderAt('/fulfillment/erve-packing-lists/epl-1', '/fulfillment/erve-packing-lists/:id', <ErvePackingListDetailPage />);
    await flush();

    expect(buttonByText('Finalize Packing List')).toBeNull();
    const dispatchButton = buttonByText('Record Dispatch');
    expect(dispatchButton).not.toBeNull();
    dispatchButton!.click();
    await flush();

    expect(postSpy).toHaveBeenCalledWith('/erve-dispatches', expect.objectContaining({ ervePackingListId: 'epl-1' }));
  });

  it('DISPATCHED status shows a link to the resulting Erve Dispatch and no mutation actions', async () => {
    mockAuth('MERCHANDISER');
    const detail = buildDetail({ status: 'DISPATCHED', dispatch: { id: 'ed-1', erveDispatchNumber: 'EIED/26-27/0001', status: 'DISPATCHED' } });
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: detail } } as never);

    renderAt('/fulfillment/erve-packing-lists/epl-1', '/fulfillment/erve-packing-lists/:id', <ErvePackingListDetailPage />);
    await flush();

    expect(content()).toContain('EIED/26-27/0001');
    expect(buttonByText('Finalize Packing List')).toBeNull();
    expect(buttonByText('Record Dispatch')).toBeNull();
  });
});

// ISS-023 Phase 3: the selected/consolidated cartons' contents render as one Style row with Sizes
// as columns, rather than one flat "Style/Size: qty" string per line.
describe('ErvePackingListCreatePage Style x Size presentation (ISS-023 Phase 3)', () => {
  it('groups multiple Sizes of the same Style across selected cartons into a single summary row', async () => {
    mockAuth('MERCHANDISER');
    const cartons = [
      buildCarton({
        id: 'carton-1',
        cartonNumber: 'C1',
        lines: [{ saleOrderLineId: 'line-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 10, quantity: 3 }],
      }),
      buildCarton({
        id: 'carton-2',
        cartonNumber: 'C2',
        lines: [{ saleOrderLineId: 'line-2', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeCode: 'M', sizeLabel: 'Medium', sizeSortOrder: 0, quantity: 4 }],
      }),
    ];
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: { items: cartons, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } } as never);

    renderAt('/fulfillment/erve-packing-lists/new', '/fulfillment/erve-packing-lists/new', <ErvePackingListCreatePage />);
    await flush();

    checkboxByLabel('Select carton C1')!.click();
    checkboxByLabel('Select carton C2')!.click();
    await flush();

    const styleCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    expect(styleCells).toHaveLength(1);
    expect(content()).toContain('S');
    expect(content()).toContain('M');
    const headers = Array.from(container.querySelectorAll('table thead')).map((head) => Array.from(head.querySelectorAll('th')).map((cell) => cell.textContent));
    expect(headers).toContainEqual(['Style', 'M', 'S', 'Total']);
  });
});

// ISS-023 Phase 3: ErvePackingListDetailPage's own carton contents and consolidated Style/Size
// Summary render as a Style x Size matrix instead of a flat per-line row/string.
describe('ErvePackingListDetailPage Style x Size presentation (ISS-023 Phase 3)', () => {
  it("renders each carton's own contents as a Style x Size matrix and the consolidated summary as one row per Style", async () => {
    mockAuth('ADMIN');
    const detail = buildDetail({
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
          totalQuantity: 7,
          lines: [
            { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 10, quantity: 3 },
            { saleOrderLineId: 'line-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeCode: 'M', sizeLabel: 'Medium', sizeSortOrder: 0, quantity: 4 },
          ],
        },
      ],
      styleSizeSummary: [
        { styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 10, quantity: 3 },
        { styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeCode: 'M', sizeLabel: 'Medium', sizeSortOrder: 0, quantity: 4 },
      ],
    });
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') return { data: { data: detail } };
      if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    renderAt('/fulfillment/erve-packing-lists/epl-1', '/fulfillment/erve-packing-lists/:id', <ErvePackingListDetailPage />);
    await flush();

    // One Style row in the carton's own matrix, not two (Small + Medium collapsed into one row).
    const styleCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    expect(styleCells.length).toBeGreaterThanOrEqual(1);
    expect(content()).toContain('Style / Size Summary');
    expect(content()).toContain('7'); // carton row total reconciles (3 + 4)
    const headers = Array.from(container.querySelectorAll('table thead')).map((head) => Array.from(head.querySelectorAll('th')).map((cell) => cell.textContent));
    expect(headers.filter((header) => header[0] === 'Style')).toEqual([['Style', 'M', 'S', 'Total'], ['Style', 'M', 'S', 'Total']]);
  });
});

describe('ErvePackingListDetailPage PDF print (Phase 6)', () => {
  it('no longer renders the legacy "Print Packing List" window.print() button', async () => {
    mockAuth('MERCHANDISER');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') return { data: { data: buildDetail() } };
      if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    renderAt('/fulfillment/erve-packing-lists/epl-1', '/fulfillment/erve-packing-lists/:id', <ErvePackingListDetailPage />);
    await flush();

    expect(buttonByText('Print Packing List')).toBeNull();
    expect(buttonByText('Print')).not.toBeNull();
    expect(buttonByText('Download PDF')).not.toBeNull();
  });

  it('clicking Print never calls the top-level window.print() (the legacy path)', async () => {
    mockAuth('MERCHANDISER');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') return { data: { data: buildDetail() } };
      if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      throw new Error(`Unexpected GET: ${url}`);
    });
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    renderAt('/fulfillment/erve-packing-lists/epl-1', '/fulfillment/erve-packing-lists/:id', <ErvePackingListDetailPage />);
    await flush();

    buttonByText('Print')!.click();
    await flush();
    await flush();

    expect(printSpy).not.toHaveBeenCalled();
  });
});
