/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { PackingListPage } from './PackingListPage.js';
import type { FactoryPackingCartonView, PackingListView } from './types.js';

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const content = () => container.textContent ?? '';

function buttonByText(text: string): HTMLButtonElement | null {
  return (Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined) ?? null;
}

function triggerByLabel(labelText: string): HTMLButtonElement {
  const label = Array.from(container.querySelectorAll('label')).find(
    (el) => el.textContent?.trim().replace(/\s*\*$/, '') === labelText,
  );
  if (!label) throw new Error(`Label "${labelText}" not found`);
  const id = label.getAttribute('for');
  const el = id ? (document.getElementById(id) as HTMLButtonElement | null) : null;
  if (!el) throw new Error(`Trigger for label "${labelText}" not found`);
  return el;
}

function buildCarton(overrides: Partial<FactoryPackingCartonView> = {}): FactoryPackingCartonView {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: '1 poly bag per unit',
    weight: '12.5',
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
    ...overrides,
  };
}

function buildPackingList(overrides: Partial<PackingListView> = {}): PackingListView {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One' }],
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001', status: 'DRAFT', version: 1, factoryInvoiceId: null },
    destinations: [
      {
        id: 'dest-1',
        distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
        label: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        addressLine1: '123 Test Street',
        addressLine2: null,
        city: 'Chennai',
        state: 'TN',
        country: 'India',
        postalCode: null,
        gstin: null,
        canMoveDistributor: true,
        lines: [
          {
            saleOrderLineId: 'line-1',
            styleId: 'style-1',
            styleNumber: 'ST-001',
            styleName: 'Classic Tee',
            sizeId: 'size-1',
            sizeCode: 'M',
            sizeLabel: 'Medium',
            requiredQuantity: 10,
            packedQuantity: 10,
          },
        ],
        cartons: [buildCarton()],
      },
    ],
    retiredCartons: [],
    ...overrides,
  };
}

async function renderPage(packingList: PackingListView, role: Role = 'FACTORY_USER') {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/sale-orders/so-1/packing-list') return { data: { data: packingList } };
    throw new Error(`Unexpected GET: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/sale-orders/so-1/packing-list']}>
          <Routes>
            <Route path="/sale-orders/:id/packing-list" element={<PackingListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading Packing List'));
}

describe('PackingListPage carton edit (Phase 4)', () => {
  it('shows an Edit action for an active DRAFT carton to FACTORY_USER', async () => {
    await renderPage(buildPackingList());
    expect(buttonByText('Edit')).not.toBeNull();
  });

  it('hydrates the edit form from the existing carton (destination, contents, package details, weight)', async () => {
    await renderPage(buildPackingList());
    buttonByText('Edit')!.click();
    await flush();

    expect(content()).toContain('Editing Carton C1');

    const packageInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === '1 poly bag per unit',
    );
    expect(packageInput).toBeTruthy();
    const weightInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === '12.5',
    );
    expect(weightInput).toBeTruthy();
    const qtyInput = container.querySelector(
      'input[aria-label="Quantity for ST-001 Medium"]',
    ) as HTMLInputElement | null;
    expect(qtyInput?.value).toBe('10');

    // Destination selector itself (not just the ambient panel title) is
    // hydrated to the carton's current destination.
    expect(triggerByLabel('Destination').textContent).toContain('Chennai, TN');
  });

  it('sends the carton\'s current expectedVersion on PATCH', async () => {
    const packingList = buildPackingList({
      destinations: [
        {
          ...buildPackingList().destinations[0]!,
          cartons: [buildCarton({ version: 4 })],
        },
      ],
    });
    await renderPage(packingList);

    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({
      data: { data: buildPackingList() },
    } as never);

    buttonByText('Edit')!.click();
    await flush();
    buttonByText('Save Changes')!.click();
    await flush();

    expect(patchSpy).toHaveBeenCalledWith(
      '/factory-dispatches/fd-1/cartons/carton-1',
      expect.objectContaining({ expectedVersion: 4 }),
    );
  });

  it('a material edit refreshes the carton and displays Needs Reinspection', async () => {
    const inspectedCarton = buildCarton({
      auditState: 'INSPECTED',
      auditHistory: [
        { cartonVersion: 1, inspectedById: 'qa-1', inspectedByName: 'QA One', inspectedAt: '2026-09-01T00:00:00.000Z', remarks: null },
      ],
    });
    const beforeEdit = buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [inspectedCarton] }] });
    const afterEdit = buildPackingList({
      destinations: [
        {
          ...buildPackingList().destinations[0]!,
          cartons: [
            buildCarton({ version: 2, weight: '15', auditState: 'NEEDS_REINSPECTION', auditHistory: inspectedCarton.auditHistory }),
          ],
        },
      ],
    });

    mockAuth('FACTORY_USER');
    // The page never renders a PATCH response directly — it invalidates and
    // refetches on success (matching every other mutation on this page), so
    // the GET mock (not the PATCH mock) is what must reflect the post-edit
    // state.
    const getSpy = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/so-1/packing-list') {
        return { data: { data: getSpy.mock.calls.length <= 1 ? beforeEdit : afterEdit } };
      }
      throw new Error(`Unexpected GET: ${url}`);
    });
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: afterEdit } } as never);

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/sale-orders/so-1/packing-list']}>
            <Routes>
              <Route path="/sale-orders/:id/packing-list" element={<PackingListPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).not.toContain('Loading Packing List'));
    expect(content()).toContain('Inspected');

    buttonByText('Edit')!.click();
    await flush();
    expect(content()).toContain('Saving a change');

    const weightInput = container.querySelector('input[type="number"][min="0"]:not([aria-label])') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(weightInput, '15');
      weightInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    buttonByText('Save Changes')!.click();
    await flush();
    await flush();

    expect(patchSpy).toHaveBeenCalled();
    expect(content()).toContain('Needs Reinspection');
  });

  it('shows no Edit action for a retired carton', async () => {
    await renderPage(
      buildPackingList({
        destinations: [{ ...buildPackingList().destinations[0]!, cartons: [] }],
        retiredCartons: [buildCarton({ retired: true, retiredAt: '2026-09-02T00:00:00.000Z' })],
      }),
    );
    expect(buttonByText('Edit')).toBeNull();
  });

  it('shows no Edit action once the Factory Dispatch is finalized (READY_FOR_ERVE)', async () => {
    await renderPage(
      buildPackingList({
        factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001', status: 'READY_FOR_ERVE', version: 2, factoryInvoiceId: null },
        destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }],
      }),
    );
    expect(buttonByText('Edit')).toBeNull();
  });

  it('QA_USER cannot edit a carton', async () => {
    await renderPage(buildPackingList(), 'QA_USER');
    expect(buttonByText('Edit')).toBeNull();
  });

  it('never exposes internal StockAllocation/QaReleaseLine/FactoryDispatchLine ids in the edit form', async () => {
    await renderPage(buildPackingList());
    buttonByText('Edit')!.click();
    await flush();

    const html = container.innerHTML;
    expect(html).not.toMatch(/stockAllocation/i);
    expect(html).not.toMatch(/qaReleaseLine/i);
    expect(html).not.toMatch(/factoryDispatchLineId/i);
  });
});

describe('PackingListPage PDF print (Phase 5)', () => {
  it('no longer renders the legacy "Print Packing List" window.print() button', async () => {
    await renderPage(buildPackingList());
    expect(buttonByText('Print Packing List')).toBeNull();
  });

  it('renders the shared PDF Print/Download action pair instead', async () => {
    await renderPage(buildPackingList());
    expect(buttonByText('Print')).not.toBeNull();
    expect(buttonByText('Download PDF')).not.toBeNull();
  });

  it('clicking Print never calls the top-level window.print() (the legacy path)', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderPage(buildPackingList());

    buttonByText('Print')!.click();
    await flush();
    await flush();

    // The new pipeline prints a real generated PDF Blob through a hidden
    // iframe's OWN contentWindow.print() (see lib/pdf/print.ts) — it never
    // calls the top-level window.print(), which is exactly the legacy call
    // this phase removes from PackingListPage.tsx itself.
    expect(printSpy).not.toHaveBeenCalled();
  });
});
