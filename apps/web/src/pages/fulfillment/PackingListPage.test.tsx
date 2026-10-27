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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
    netWeight: '12.5',
    grossWeight: '13.2',
    dimensions: '60 x 40 x 35 cm',
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
        primaryImage: null,
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
            primaryImage: null,
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

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sale-orders/so-1/packing-list']}>
          <Routes>
            <Route path="/sale-orders/:id/packing-list" element={<PackingListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading Packing List'));
  return queryClient;
}

function enterQuantity(label: string, value: string) {
  const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  act(() => input.focus());
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => input.blur());
  return input;
}

describe('Batch 3 Factory Packing error feedback', () => {
  function draftDestination(sizeCode = 'M') {
    const source = buildPackingList();
    return buildPackingList({
      destinations: [{
        ...source.destinations[0]!,
        cartons: [],
        lines: [{
          ...source.destinations[0]!.lines[0]!,
          sizeCode,
          sizeLabel: sizeCode === 'M' ? 'Medium' : sizeCode,
          packedQuantity: 9,
        }],
      }],
    });
  }

  it('keeps over-allocation errors visible after focus leaves the Size input and blocks Add Carton', async () => {
    await renderPage(draftDestination('6'));
    act(() => buttonByText('Add Carton')!.click());
    await flush();
    const number = triggerByLabel('Carton Number') as unknown as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(number, 'C2');
      number.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const input = enterQuantity('Quantity for ST-001 6', '11');
    expect(document.activeElement).not.toBe(input);
    expect(content()).toContain('Size 6: only 1 available; you entered 11.');
    expect(content()).toContain('Correct the highlighted Size quantities above before adding this carton.');
    expect(buttonByText('Add Carton')!.disabled).toBe(true);
    // A previously committed quantity must not produce a misleading total while a draft is invalid.
    expect(input.closest('table')!.querySelector('tfoot')).toBeNull();

    enterQuantity('Quantity for ST-001 6', '1');
    expect(content()).not.toContain('Size 6: only 1 available; you entered 11.');
    expect(content()).not.toContain('Correct the highlighted Size quantities above');
    expect(buttonByText('Add Carton')!.disabled).toBe(false);
  });

  it('shows duplicate Carton Number server errors beside the field, retains values and focuses correction', async () => {
    await renderPage(draftDestination());
    const post = vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { error: { code: 'VALIDATION_ERROR', message: 'Carton number 1 already exists on this Factory Dispatch' } },
      },
    });
    act(() => buttonByText('Add Carton')!.click());
    await flush();
    const number = triggerByLabel('Carton Number') as unknown as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(number, '1');
      number.dispatchEvent(new Event('input', { bubbles: true }));
    });
    enterQuantity('Quantity for ST-001 Medium', '1');
    act(() => buttonByText('Add Carton')!.click());
    await vi.waitFor(() => expect(number.getAttribute('aria-invalid')).toBe('true'));
    expect(post).toHaveBeenCalledOnce();
    expect(number.value).toBe('1');
    expect(document.activeElement).toBe(number);
    expect(number.closest('[data-width]')?.textContent).toContain(
      'Carton number 1 already exists on this Factory Dispatch',
    );
    expect(container.querySelector('input[aria-label="Quantity for ST-001 Medium"]')?.getAttribute('value')).toBe('1');

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(number, '2');
      number.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(number.getAttribute('aria-invalid')).toBeNull();
    expect(number.value).toBe('2');
  });
});

describe('Carton quantity matrix', () => {
  it('commits a valid draft before Save click and prevents duplicate pending submissions', async () => {
    const list = buildPackingList();
    await renderPage(list);
    let complete!: (value: never) => void;
    const patch = vi.spyOn(apiClient, 'patch').mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    act(() => buttonByText('Edit')!.click());
    await flush();
    const input = container.querySelector('input[aria-label="Quantity for ST-001 Medium"]') as HTMLInputElement;
    act(() => input.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => buttonByText('Save Changes')!.focus());
    act(() => { buttonByText('Save Changes')!.click(); buttonByText('Save Changes')!.click(); });
    await flush();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/factory-dispatches/fd-1/cartons/carton-1', expect.objectContaining({ lines: [{ saleOrderLineId: 'line-1', quantity: 7 }] }));
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    await act(async () => complete({ data: { data: list } } as never));
    await flush();
  });

  it('clears invalid drafts on Cancel and remounts clean quantities when reopening', async () => {
    await renderPage(buildPackingList());
    act(() => buttonByText('Edit')!.click());
    await flush();
    enterQuantity('Quantity for ST-001 Medium', '11');
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    act(() => buttonByText('Cancel')!.click());
    act(() => buttonByText('Edit')!.click());
    await flush();
    expect(buttonByText('Save Changes')!.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Quantity for ST-001 Medium"]')!.value).toBe('10');
  });

  it('resets quantities and invalid drafts when the edit destination changes', async () => {
    const list = buildPackingList();
    const second = structuredClone(list.destinations[0]!);
    second.id = 'dest-2';
    second.label = 'Second destination';
    second.cartons = [];
    second.lines[0]!.saleOrderLineId = 'second-line';
    second.lines[0]!.packedQuantity = 0;
    list.destinations.push(second);
    await renderPage(list);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: list } } as never);
    act(() => buttonByText('Edit')!.click());
    await flush();
    enterQuantity('Quantity for ST-001 Medium', '11');
    act(() => triggerByLabel('Destination').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    await flush();
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((el) => el.textContent?.includes('Second destination'))!;
    expect(option).toBeTruthy();
    act(() => option.click());
    await flush();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Quantity for ST-001 Medium"]')!.value).toBe('');
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    enterQuantity('Quantity for ST-001 Medium', '4');
    act(() => buttonByText('Save Changes')!.click());
    await flush();
    expect(patch).toHaveBeenCalledWith('/factory-dispatches/fd-1/cartons/carton-1', expect.objectContaining({
      destinationId: 'dest-2', lines: [{ saleOrderLineId: 'second-line', quantity: 4 }],
    }));
  });

  it('groups multiple Styles and canonical Sizes, displays capacity, and posts only positive cells by line identity', async () => {
    const list = buildPackingList();
    const destination = list.destinations[0]!;
    const line = destination.lines[0]!;
    destination.lines = [
      { ...line, saleOrderLineId: 'large', sizeId: 'large', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 2, packedQuantity: 3 },
      { ...line, saleOrderLineId: 'small', sizeId: 'small', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 0, packedQuantity: 0 },
      { ...line, saleOrderLineId: 'polo', styleId: 'polo', styleNumber: 'ST-002', sizeSortOrder: 1, packedQuantity: 0 },
    ];
    destination.cartons = [];
    await renderPage(list);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: list } } as never);
    act(() => buttonByText('Add Carton')!.click());
    await flush();
    const input = container.querySelector('input[aria-label="Quantity for ST-001 Large"]') as HTMLInputElement;
    const table = input.closest('table')!;
    expect(table).toBeTruthy();
    expect(Array.from(table.querySelectorAll('thead th')).map((n) => n.textContent)).toEqual(['Style', 'S', 'M', 'L', 'Total']);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(table.textContent).toContain('7 available');
    expect(table.textContent).toContain('—');
    const number = triggerByLabel('Carton Number') as unknown as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(number, 'C2');
      number.dispatchEvent(new Event('input', { bubbles: true }));
    });
    enterQuantity('Quantity for ST-001 Large', '7');
    enterQuantity('Quantity for ST-001 Small', '0');
    enterQuantity('Quantity for ST-002 Medium', '2');
    act(() => buttonByText('Add Carton')!.click());
    await flush();
    expect(post).toHaveBeenCalledWith('/sale-orders/so-1/packing-list/cartons', expect.objectContaining({
      cartonNumber: 'C2', lines: [{ saleOrderLineId: 'large', quantity: 7 }, { saleOrderLineId: 'polo', quantity: 2 }],
    }));
  });

  it('revalidates against refreshed capacity and keeps selected zero-capacity cells visible', async () => {
    const list = buildPackingList();
    const client = await renderPage(list);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: list } } as never);
    act(() => buttonByText('Edit')!.click());
    await flush();
    enterQuantity('Quantity for ST-001 Medium', '8');
    const updated = structuredClone(list);
    updated.destinations[0]!.lines[0]!.packedQuantity = 20;
    // Even a changed carton response must not inflate the original-own contribution snapshot.
    updated.destinations[0]!.cartons[0]!.lines[0]!.quantity = 20;
    act(() => client.setQueryData(['packing-list', 'so-1'], updated));
    await flush();
    expect(container.querySelector('input[aria-label="Quantity for ST-001 Medium"]')).toBeTruthy();
    expect(content()).toContain('0 available');
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    act(() => buttonByText('Save Changes')!.click());
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects a selected line removed by refetch rather than dropping it from the payload', async () => {
    const list = buildPackingList();
    const client = await renderPage(list);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: list } } as never);
    act(() => buttonByText('Edit')!.click());
    await flush();
    const updated = structuredClone(list);
    updated.destinations[0]!.lines = [];
    act(() => client.setQueryData(['packing-list', 'so-1'], updated));
    await flush();
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    act(() => buttonByText('Save Changes')!.click());
    expect(patch).not.toHaveBeenCalled();
  });

  it('adds back the edited carton own contents but rejects amounts above the replacement capacity', async () => {
    const list = buildPackingList();
    list.destinations[0]!.lines[0]!.requiredQuantity = 15;
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: list } } as never);
    await renderPage(list);
    act(() => buttonByText('Edit')!.click());
    await flush();
    expect(content()).toContain('15 available');
    enterQuantity('Quantity for ST-001 Medium', '16');
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    enterQuantity('Quantity for ST-001 Medium', '15');
    act(() => buttonByText('Save Changes')!.click());
    await flush();
    expect(patch).toHaveBeenCalledWith('/factory-dispatches/fd-1/cartons/carton-1', expect.objectContaining({
      lines: [{ saleOrderLineId: 'line-1', quantity: 15 }], expectedVersion: 1,
    }));
  });
});

describe('PackingListPage carton edit (Phase 4)', () => {
  it('blocks saving an invalid blurred draft instead of submitting its old committed quantity', async () => {
    await renderPage(buildPackingList());
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: buildPackingList() } } as never);
    act(() => buttonByText('Edit')!.click());
    await flush();
    const input = container.querySelector('input[aria-label="Quantity for ST-001 Medium"]') as HTMLInputElement;
    expect(input.type).toBe('text');
    act(() => input.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '11');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // A real pointer click blurs the focused input before dispatching click.
    act(() => buttonByText('Save Changes')!.focus());
    act(() => buttonByText('Save Changes')!.click());
    await flush();
    expect(patch).not.toHaveBeenCalled();
    expect(buttonByText('Save Changes')!.disabled).toBe(true);
    expect(input.value).toBe('11');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    act(() => input.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => input.blur());
    act(() => buttonByText('Save Changes')!.click());
    await flush();
    expect(patch).toHaveBeenCalledWith('/factory-dispatches/fd-1/cartons/carton-1',
      expect.objectContaining({ lines: [{ saleOrderLineId: 'line-1', quantity: 8 }] }));
  });

  it('shows an Edit action for an active DRAFT carton to FACTORY_USER', async () => {
    await renderPage(buildPackingList());
    expect(buttonByText('Edit')).not.toBeNull();
  });

  it('hydrates the edit form from the existing carton (destination, contents, package details, net/gross weight, dimensions)', async () => {
    await renderPage(buildPackingList());
    buttonByText('Edit')!.click();
    await flush();

    expect(content()).toContain('Editing Carton C1');
    expect(content()).toContain('Net Weight, Gross Weight, and Dimensions can be entered later, but are required before finalizing the Factory Packing List.');

    const packageInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === '1 poly bag per unit',
    );
    expect(packageInput).toBeTruthy();
    const netWeightInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === '12.5',
    );
    expect(netWeightInput).toBeTruthy();
    const grossWeightInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === '13.2',
    );
    expect(grossWeightInput).toBeTruthy();
    const dimensionsInput = Array.from(container.querySelectorAll('input')).find(
      (i) => (i as HTMLInputElement).value === '60 x 40 x 35 cm',
    );
    expect(dimensionsInput).toBeTruthy();
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
            buildCarton({ version: 2, netWeight: '15', auditState: 'NEEDS_REINSPECTION', auditHistory: inspectedCarton.auditHistory }),
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

// DEMO-018: carton Net Weight / Gross Weight / Dimensions are captured but
// never required to save packing progress; they are only enforced at
// Factory Packing List finalization, where the API returns a dedicated
// cartonsMissingPackingMetadata blocker this page must render.
describe('PackingListPage carton packing metadata (DEMO-018)', () => {
  it('labels packing metadata clearly as required before finalization but optional during draft save', async () => {
    await renderPage(buildPackingList());
    buttonByText('Add Carton')!.click();
    await flush();

    expect(triggerByLabel('Net Weight, kg')).toBeTruthy();
    expect(triggerByLabel('Gross Weight, kg')).toBeTruthy();
    expect(triggerByLabel('Dimensions')).toBeTruthy();
    expect(content()).toContain('Net Weight, Gross Weight, and Dimensions can be entered later, but are required before finalizing the Factory Packing List.');
  });

  it('does not block Add Carton when Net Weight/Gross Weight/Dimensions are left blank', async () => {
    // The default fixture's line is already fully packed (packedQuantity ===
    // requiredQuantity), so the Add Carton form renders no quantity input
    // for it at all ("remaining" <= 0). Give the line open capacity so the
    // quantity input actually renders.
    await renderPage(
      buildPackingList({
        destinations: [
          {
            ...buildPackingList().destinations[0]!,
            lines: [{ ...buildPackingList().destinations[0]!.lines[0]!, packedQuantity: 0 }],
          },
        ],
      }),
    );
    buttonByText('Add Carton')!.click();
    await flush();

    const cartonNumberInput = triggerByLabel('Carton Number') as unknown as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(cartonNumberInput, 'C2');
      cartonNumberInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const qtyInput = container.querySelector('input[aria-label="Quantity for ST-001 Medium"]') as HTMLInputElement;
    await act(async () => {
      setter.call(qtyInput, '1');
      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      qtyInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(buttonByText('Add Carton')!.hasAttribute('disabled')).toBe(false);
  });

  it('renders the cartonsMissingPackingMetadata finalize error in "CTN-001: Net Weight, Dimensions" style', async () => {
    await renderPage(
      buildPackingList({
        destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }],
      }),
    );

    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            message: 'Cannot finalize: Factory Dispatch has outstanding packing/audit issues',
            details: {
              cartonsNotAudited: [],
              cartonsNeedingReinspection: [],
              emptyCartons: [],
              destinationMismatchCartons: [],
              underPackedLines: [],
              overPackedLines: [],
              internalPackingMismatch: [],
              cartonsMissingPackingMetadata: [{ cartonNumber: 'CTN-001', missingFields: ['netWeight', 'dimensions'] }],
            },
          },
        },
      },
    });

    buttonByText('Finalize (Ready for Erve)')!.click();
    await flush();

    expect(content()).toContain('CTN-001: Net Weight, Dimensions');
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

// UXAUTH-003/004: MERCHANDISER and SENIOR_MANAGEMENT now reach this page via
// the newly-unblocked Factory Packing queue (and already could via the
// Dispatch Order route). This page's mutation gating (canMutateFactoryDispatches)
// was already correct before this batch — these are regression-confirmation
// tests proving broadened READ access did not broaden WRITE access, not a
// behavior change. UXAUTH-012 (M/S -> "View Factory Invoice" -> Forbidden,
// once out of scope for Batch 2) is now fixed and covered below.
describe('PackingListPage read-only regression — MERCHANDISER/SENIOR_MANAGEMENT (UXAUTH-003/004)', () => {
  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    '%s sees no Factory Packing mutation controls on an active DRAFT Factory Dispatch',
    async (role) => {
      await renderPage(buildPackingList(), role);
      expect(buttonByText('Edit')).toBeNull();
      expect(buttonByText('Retire')).toBeNull();
      expect(buttonByText('Delete')).toBeNull();
      expect(buttonByText('Add Carton')).toBeNull();
      expect(buttonByText('Finalize (Ready for Erve)')).toBeNull();
      expect(buttonByText('Abandon')).toBeNull();
    },
  );

  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    '%s still sees the read-only Print/Download PDF actions',
    async (role) => {
      await renderPage(buildPackingList(), role);
      expect(buttonByText('Print')).not.toBeNull();
      expect(buttonByText('Download PDF')).not.toBeNull();
    },
  );
});

// UXAUTH-012: an invoice existing on the Factory Dispatch is not enough to
// show "View Factory Invoice" — the target route
// (/fulfillment/factory-invoices/:id) is guarded by FACTORY_INVOICE_VIEW_ROLES
// (ADMIN, ACCOUNTANT, FACTORY_USER), which is narrower than the roles that
// can read this Packing List (FACTORY_DISPATCH_VIEW_ROLES, which additionally
// includes MERCHANDISER/SENIOR_MANAGEMENT). Before this fix the button
// rendered for every viewer whenever factoryInvoiceId was set, regardless of
// role, sending MERCHANDISER/SENIOR_MANAGEMENT to a route they cannot enter.
describe('PackingListPage Factory Invoice cross-link (UXAUTH-012)', () => {
  const withInvoice = () =>
    buildPackingList({
      factoryDispatch: {
        id: 'fd-1',
        factoryDispatchNumber: 'EIFD/26-27/0001',
        status: 'READY_FOR_ERVE',
        version: 2,
        factoryInvoiceId: 'inv-1',
      },
    });

  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    '%s does not see View Factory Invoice even though an invoice exists',
    async (role) => {
      await renderPage(withInvoice(), role);
      expect(buttonByText('View Factory Invoice')).toBeNull();
    },
  );

  it.each(['ADMIN', 'FACTORY_USER'] as const)(
    '%s (a Factory Invoice viewer) still sees View Factory Invoice when an invoice exists',
    async (role) => {
      await renderPage(withInvoice(), role);
      expect(buttonByText('View Factory Invoice')).not.toBeNull();
    },
  );

  it('does not render View Factory Invoice for any role when no invoice exists yet', async () => {
    await renderPage(buildPackingList(), 'ADMIN');
    expect(buttonByText('View Factory Invoice')).toBeNull();
  });
});

// DEMO-019: a discoverable per-carton label print/download action, gated to
// a currently Inspected carton — the business requirement that final carton
// labels must come from confirmed/audited carton data.
describe('PackingListPage carton label print/download (DEMO-019)', () => {
  it('shows a disabled Print/Download Label action for a Not Inspected carton', async () => {
    await renderPage(buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'NOT_INSPECTED' })] }] }));
    expect(buttonByText('Print Label')!.disabled).toBe(true);
    expect(buttonByText('Download Label')!.disabled).toBe(true);
  });

  it('shows a disabled Print/Download Label action for a carton Needing Reinspection', async () => {
    await renderPage(
      buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'NEEDS_REINSPECTION' })] }] }),
    );
    expect(buttonByText('Print Label')!.disabled).toBe(true);
    expect(buttonByText('Download Label')!.disabled).toBe(true);
  });

  it('enables the Print/Download Label action once the carton is Inspected', async () => {
    await renderPage(
      buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }] }),
    );
    expect(buttonByText('Print Label')!.disabled).toBe(false);
    expect(buttonByText('Download Label')!.disabled).toBe(false);
  });

  it('is visible to a read-only viewer (MERCHANDISER) just like the page-level PDF actions, without granting mutation controls', async () => {
    await renderPage(
      buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }] }),
      'MERCHANDISER',
    );
    expect(buttonByText('Print Label')).not.toBeNull();
    expect(buttonByText('Edit')).toBeNull();
    expect(buttonByText('Delete')).toBeNull();
  });

  it('still renders the label action once the Factory Dispatch is finalized (READY_FOR_ERVE), when Edit/Retire are gone', async () => {
    await renderPage(
      buildPackingList({
        factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001', status: 'READY_FOR_ERVE', version: 2, factoryInvoiceId: null },
        destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }],
      }),
    );
    expect(buttonByText('Edit')).toBeNull();
    expect(buttonByText('Print Label')!.disabled).toBe(false);
  });

  it('clicking Print Label never calls the top-level window.print() (reuses the established PDF print pipeline)', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    await renderPage(
      buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }] }),
    );
    buttonByText('Print Label')!.click();
    await flush();
    await flush();
    expect(printSpy).not.toHaveBeenCalled();
  });

  it('downloading a label does not mutate carton/audit/dispatch state (no POST/PATCH/DELETE call fires)', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    const patchSpy = vi.spyOn(apiClient, 'patch');
    const deleteSpy = vi.spyOn(apiClient, 'delete');
    await renderPage(
      buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [buildCarton({ auditState: 'INSPECTED' })] }] }),
    );
    buttonByText('Download Label')!.click();
    await flush();
    await flush();
    expect(postSpy).not.toHaveBeenCalled();
    expect(patchSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ISS-007/ISS-010: a carton's contents render as one Style row with Sizes as
// columns, rather than one list item per Style+Size combination.
describe('PackingListPage carton Style x Size presentation (ISS-007/ISS-010)', () => {
  it('shows the destination-authorized Style image for every carton row and does not leak images between destinations (ISS-035)', async () => {
    // A carton projection can have null primaryImage even when the destination
    // summary already includes the same Style's real primary image.
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const image = {
      id: 'img-1', styleId: 'style-1', fileId: 'file-1', fileName: 'style.jpg',
      mimeType: 'image/jpeg', sizeBytes: 100, isPrimary: true, sortOrder: 0,
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    };
    const first = buildPackingList().destinations[0]!;
    const firstCartons = [
      buildCarton(),
      buildCarton({ id: 'carton-2', cartonNumber: 'C2' }),
    ];
    const secondCarton = buildCarton({
      id: 'carton-3', cartonNumber: 'C3', destinationId: 'dest-2',
      lines: buildCarton().lines.map((line) => ({ ...line, currentDestinationId: 'dest-2' })),
    });
    await renderPage(buildPackingList({
      destinations: [
        { ...first, lines: first.lines.map((line) => ({ ...line, primaryImage: image })), cartons: firstCartons },
        { ...first, id: 'dest-2', lines: first.lines, cartons: [secondCarton] },
      ],
    }));

    const cells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    expect(cells).toHaveLength(7); // destination 1: Required, Packed, two cartons; destination 2: three rows
    expect(cells.slice(0, 4).every((cell) => cell.querySelector('button[aria-label="View style image"]'))).toBe(true);
    expect(cells.slice(4).every((cell) => !cell.querySelector('button[aria-label="View style image"]'))).toBe(true);
    // The thumbnail must be resolved only from the already-authorized Packing List payload.
    expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(1);
  });

  it('groups multiple Sizes of the same Style into a single row instead of repeating the Style', async () => {
    const carton = buildCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', quantity: 3, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-2', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-3', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-3', sizeCode: 'L', sizeLabel: 'Large', quantity: 2, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 9,
    });
    await renderPage(buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [carton] }] }));

    // "ST-001" appears once in the Required matrix, once in the Packed
    // matrix, and once in the carton's own Style x Size grid — it never
    // repeats across separate rows within any one grid the way the old
    // per-Size <ul>/flat table did.
    const styleCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    expect(styleCells).toHaveLength(3);
    // Size codes appear as column headers.
    expect(content()).toContain('S');
    expect(content()).toContain('M');
    expect(content()).toContain('L');
    // The row total (3+4+2) and column totals reconcile to source records.
    expect(content()).toContain('9');
  });

  it('keeps two cartons visually and numerically distinct (no cross-carton merging)', async () => {
    const cartonA = buildCarton({
      id: 'carton-a',
      cartonNumber: 'CTN-A',
      lines: [{ saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 5, currentDestinationId: 'dest-1' }],
      totalQuantity: 5,
    });
    const cartonB = buildCarton({
      id: 'carton-b',
      cartonNumber: 'CTN-B',
      lines: [{ saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 7, currentDestinationId: 'dest-1' }],
      totalQuantity: 7,
    });
    await renderPage(buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [cartonA, cartonB] }] }));

    expect(content()).toContain('Carton CTN-A');
    expect(content()).toContain('Carton CTN-B');
    // Each carton's own row total is distinct and visible — 5 is not merged into 7 or vice versa.
    expect(content()).toContain('5');
    expect(content()).toContain('7');
  });

  it('renders a dash for a Size that does not apply to a given Style when the carton holds multiple Styles with different Size ranges', async () => {
    const carton = buildCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', quantity: 3, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-2', styleId: 'style-2', styleNumber: 'ST-002', styleName: 'Polo', primaryImage: null, sizeId: 'size-2', sizeCode: 'XL', sizeLabel: 'Extra Large', quantity: 2, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 5,
    });
    await renderPage(buildPackingList({ destinations: [{ ...buildPackingList().destinations[0]!, cartons: [carton] }] }));
    // Two Style rows, each missing a cell for the Size that doesn't apply to it.
    const dashCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.trim() === '—');
    expect(dashCells.length).toBeGreaterThanOrEqual(2);
  });
});

// ISS-023 Phase 2: the destination's Required/Packed progress summary as two
// Style x Size matrices instead of one flat row per Style+Size combination.
describe('PackingListPage destination Required/Packed Style x Size presentation (ISS-023 Phase 2)', () => {
  it('shows a "Required" and a "Packed" matrix, grouping multiple Styles each into their own row', async () => {
    const destination = {
      ...buildPackingList().destinations[0]!,
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', requiredQuantity: 10, packedQuantity: 6 },
        { saleOrderLineId: 'line-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-2', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 8, packedQuantity: 8 },
        { saleOrderLineId: 'line-3', styleId: 'style-2', styleNumber: 'ST-002', styleName: 'Polo', primaryImage: null, sizeId: 'size-3', sizeCode: 'L', sizeLabel: 'Large', requiredQuantity: 5, packedQuantity: 0 },
      ],
      cartons: [],
    };
    await renderPage(buildPackingList({ destinations: [destination] }));

    expect(content()).toContain('Required');
    expect(content()).toContain('Packed');
    // Each Style number appears exactly once per matrix (grouped, not repeated per Size).
    const styleOneCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    expect(styleOneCells).toHaveLength(2);
    const styleTwoCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-002'));
    expect(styleTwoCells).toHaveLength(2);
    // Required total (10+8+5=23) and Packed total (6+8+0=14) both reconcile to the source lines.
    expect(content()).toContain('23');
    expect(content()).toContain('14');
  });

  it('shows a real zero Packed quantity (not blank) when nothing has been packed yet', async () => {
    const destination = {
      ...buildPackingList().destinations[0]!,
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 12, packedQuantity: 0 },
      ],
      cartons: [],
    };
    await renderPage(buildPackingList({ destinations: [destination] }));
    const packedInputs = Array.from(container.querySelectorAll('input[aria-label="ST-001 M quantity"]'));
    expect(packedInputs.some((input) => (input as HTMLInputElement).value === '0')).toBe(true);
  });
});

// UXAUTH-018: a failed fetch (403/500/network error) must render the real
// ErrorState, not fall through to the "Dispatch Order not found" EmptyState
// — that EmptyState is reserved for a genuine no-such-record response.
describe('PackingListPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    mockAuth('FACTORY_USER');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/so-1/packing-list') throw new Error('Request failed with status code 500');
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

    expect(content()).not.toContain('Dispatch Order not found');
    expect(content()).toContain('Unable to load Packing List');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
