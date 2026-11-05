/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { ErveDispatchDetailPage } from './ErveDispatchDetailPage.js';
import { ErveDispatchRecordPage } from './ErveDispatchRecordPage.js';
import { getLocalDateString } from '../../lib/dates.js';

let container: HTMLDivElement;
let root: Root;
const dispatch = {
  id: 'ed',
  erveDispatchNumber: 'ED-1',
  status: 'DISPATCHED',
  version: 3,
  distributor: { id: 'dist', name: 'Distributor' },
  ervePackingList: { id: 'pl', ervePackingListNumber: 'PL-1' },
  dispatchDate: '2026-11-01',
  dispatchedBy: { name: 'Admin' },
  totalQuantity: 12,
  invoiceHandoffs: [],
  saleOrReturnLines: [],
  deliveryLines: [],
  quantityLines: [
    {
      saleOrderLineId: 'one',
      styleId: 'st',
      styleNumber: 'ST-1',
      styleName: 'Tee',
      primaryImage: null,
      sizeId: 'large',
      sizeCode: 'L',
      sizeLabel: 'Large',
      sizeSortOrder: 2,
      quantity: 5,
    },
    {
      saleOrderLineId: 'two',
      styleId: 'st',
      styleNumber: 'ST-1',
      styleName: 'Tee',
      primaryImage: null,
      sizeId: 'small',
      sizeCode: 'S',
      sizeLabel: 'Small',
      sizeSortOrder: 1,
      quantity: 3,
    },
    {
      saleOrderLineId: 'three',
      styleId: 'st',
      styleNumber: 'ST-1',
      styleName: 'Tee',
      primaryImage: null,
      sizeId: 'small',
      sizeCode: 'S',
      sizeLabel: 'Small',
      sizeSortOrder: 1,
      quantity: 4,
    },
  ],
};
const packing = {
  id: 'pl',
  ervePackingListNumber: 'PL-1',
  status: 'FINALIZED',
  dispatch: null,
  distributor: { name: 'Distributor' },
  destination: { label: 'Store' },
  cartonCount: 2,
  totalQuantity: 12,
};
function Location() {
  const location = useLocation();
  return <output data-location>{location.pathname + location.search}</output>;
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (String(url).startsWith('/tax-invoices/'))
      throw { isAxiosError: true, response: { status: 404 } };
    return { data: { data: String(url).startsWith('/erve-packing-lists/') ? packing : dispatch } };
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(path: string, role: Role = 'ADMIN') {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: { roles: [role], name: 'User' } as AuthUser,
  } as ReturnType<typeof AuthContext.useAuth>);
  act(() =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Location />
          <Routes>
            <Route path="/fulfillment/erve-dispatches/new" element={<ErveDispatchRecordPage />} />
            <Route path="/fulfillment/erve-dispatches/:id" element={<ErveDispatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.textContent).not.toMatch(/Loading/));
}
function active() {
  return container.querySelector('[role="tabpanel"][data-state="active"]')!;
}
it('loads QR evidence only when the Transport & Delivery tab is opened', async () => {
  await render('/fulfillment/erve-dispatches/ed');
  expect(vi.mocked(apiClient.get).mock.calls.some(([url]) => String(url).startsWith('/carton-delivery/'))).toBe(false);
  await select('Transport & Delivery');
  await vi.waitFor(() => expect(vi.mocked(apiClient.get).mock.calls.some(([url]) => String(url).startsWith('/carton-delivery/'))).toBe(true));
});
function button(label: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
}
function changeInput(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function select(label: string) {
  await act(async () =>
    button(label).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })),
  );
}

it.each(['', '?tab=invalid'])(
  'defaults %s to Overview with an ordered, aggregated matrix',
  async (query) => {
    await render('/fulfillment/erve-dispatches/ed' + query);
    expect(active().textContent).toContain('ST-1');
    const headings = [...active().querySelectorAll('th')].map((el) => el.textContent);
    expect(headings).toEqual(['Style', 'S', 'L', 'Total']);
    expect(active().querySelectorAll('tbody tr')).toHaveLength(1);
    expect(
      [...active().querySelectorAll<HTMLInputElement>('tbody input')].map((el) => el.value),
    ).toEqual(['7', '5']);
    expect(active().querySelector('tfoot')?.textContent).toContain('12');
    await vi.waitFor(() => expect(active().textContent).toContain('No active Tax Invoice'));
    expect(container.textContent).not.toContain('Sale-or-Return Position');
  },
);

it.each(['overview', 'transport-delivery', 'distributor-receipt'])(
  'supports direct %s links and persistent identity',
  async (tab) => {
    await render('/fulfillment/erve-dispatches/ed?tab=' + tab);
    expect(
      container.querySelector('[role="tab"][data-state="active"]')?.getAttribute('aria-controls'),
    ).toBe(active().id);
    expect(container.textContent).toContain('ED-1');
    expect(container.textContent).toContain('Distributor');
  },
);

it('updates the tab URL without losing other parameters or transport drafts', async () => {
  await render('/fulfillment/erve-dispatches/ed?tab=overview&source=history');
  await select('Transport & Delivery');
  expect(container.querySelector('[data-location]')?.textContent).toContain('source=history');
  expect(container.querySelector('[data-location]')?.textContent).toContain(
    'tab=transport-delivery',
  );
  expect(active().textContent).toContain('Update Transport');
  await select('Distributor Receipt');
  expect(active().textContent).toContain('Separate distributor confirmation is not yet available');
  expect(active().querySelectorAll('input,textarea')).toHaveLength(0);
});

it.each(['DISTRIBUTOR', 'ACCOUNTANT', 'SENIOR_MANAGEMENT'] as const)(
  'keeps %s read-only and hides forbidden document links',
  async (role) => {
    await render('/fulfillment/erve-dispatches/ed?tab=transport-delivery', role);
    expect(active().textContent).not.toContain('Confirm Delivery');
    expect(active().textContent).not.toContain('Save');
    if (role !== 'SENIOR_MANAGEMENT')
      expect(container.querySelector('a[href="/fulfillment/erve-packing-lists/pl"]')).toBeNull();
  },
);

it('records only after an explicit submit, preserves payload, and blocks repeated pending submits', async () => {
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(apiClient, 'post').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render('/fulfillment/erve-dispatches/new?ervePackingListId=pl');
  expect(post).not.toHaveBeenCalled();
  await act(async () => {
    button('Record Dispatch').click();
    button('Record Dispatch').click();
  });
  expect(post).toHaveBeenCalledExactlyOnceWith('/erve-dispatches', {
    ervePackingListId: 'pl',
    dispatchDate: getLocalDateString(),
    transporter: null,
    vehicleNumber: null,
    lrNumber: null,
    remarks: null,
  });
  await vi.waitFor(() => expect(button('Record Dispatch').disabled).toBe(true));
  await act(async () => resolve({ data: { data: { id: 'ed' } } }));
  await vi.waitFor(() =>
    expect(container.querySelector('[data-location]')?.textContent).toBe(
      '/fulfillment/erve-dispatches/ed',
    ),
  );
});

it.each(['OPEN', 'missing'])('does not offer recording for %s context', async (status) => {
  if (status === 'OPEN')
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: { ...packing, status } } });
  await render(
    '/fulfillment/erve-dispatches/new' + (status === 'missing' ? '' : '?ervePackingListId=pl'),
  );
  expect(button('Record Dispatch')).toBeUndefined();
});

it('takes an already dispatched packing list to its existing dispatch without posting', async () => {
  const post = vi.spyOn(apiClient, 'post');
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: {
      data: String(url).startsWith('/erve-packing-lists/')
        ? { ...packing, status: 'DISPATCHED', dispatch: { id: 'ed' } }
        : dispatch,
    },
  }));
  await render('/fulfillment/erve-dispatches/new?ervePackingListId=pl');
  await vi.waitFor(() =>
    expect(container.querySelector('[data-location]')?.textContent).toBe(
      '/fulfillment/erve-dispatches/ed',
    ),
  );
  expect(post).not.toHaveBeenCalled();
});

it.each(['LEGACY_ASSUMED_FULL_RECEIPT', 'USER_CONFIRMED'])(
  'labels %s evidence without inventing distributor confirmation',
  async (source) => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        data: {
          ...dispatch,
          status: 'DELIVERED',
          deliveryConfirmationSource: source,
          deliveryLines: [
            { saleOrderLineId: 'one', receivedQuantity: 2 },
            { saleOrderLineId: 'two', receivedQuantity: 0 },
          ],
        },
      },
    });
    await render('/fulfillment/erve-dispatches/ed?tab=distributor-receipt', 'DISTRIBUTOR');
    expect(active().textContent).toContain(
      source === 'USER_CONFIRMED' ? 'Admin / Merchandiser fallback' : 'not actually confirmed',
    );
    expect(active().textContent).toContain(
      'Separate distributor confirmation is not yet available',
    );
    expect(
      [...active().querySelectorAll('tbody input')].map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['0', '2']);
    expect([...active().querySelectorAll('input')].every((input) => input.readOnly)).toBe(true);
    expect(active().querySelector('tfoot')?.textContent).toContain('2');
  },
);

it('shows the existing Tax Invoice link without creating an invoice', async () => {
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: {
      data: String(url).startsWith('/tax-invoices/')
        ? { id: 'invoice', invoiceNumber: 'INV-1', status: 'FINALIZED' }
        : dispatch,
    },
  }));
  await render('/fulfillment/erve-dispatches/ed', 'ACCOUNTANT');
  await vi.waitFor(() =>
    expect(
      container.querySelector('a[href="/fulfillment/tax-invoices/invoice"]')?.textContent,
    ).toContain('INV-1'),
  );
});

it('distinguishes invoice failures from an absent invoice', async () => {
  vi.mocked(apiClient.get).mockImplementation(async (url) => {
    if (String(url).startsWith('/tax-invoices/'))
      throw { isAxiosError: true, response: { status: 403 } };
    return { data: { data: dispatch } };
  });
  await render('/fulfillment/erve-dispatches/ed');
  await vi.waitFor(() => expect(active().textContent).toContain('Unable to load Tax Invoice'));
  expect(active().textContent).not.toContain('No active Tax Invoice');
});

it('recovers a recording conflict by refreshing and opening the existing dispatch', async () => {
  vi.spyOn(apiClient, 'post').mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
  await render('/fulfillment/erve-dispatches/new?ervePackingListId=pl');
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: {
      data: String(url).startsWith('/erve-packing-lists/')
        ? { ...packing, status: 'DISPATCHED', dispatch: { id: 'ed' } }
        : dispatch,
    },
  }));
  await act(async () => button('Record Dispatch').click());
  await vi.waitFor(() =>
    expect(container.querySelector('[data-location]')?.textContent).toBe(
      '/fulfillment/erve-dispatches/ed',
    ),
  );
});

it.each(['DISTRIBUTOR', 'ACCOUNTANT', 'SENIOR_MANAGEMENT', 'FACTORY_USER'] as const)(
  'does not fetch recording context for %s',
  async (role) => {
    await render('/fulfillment/erve-dispatches/new?ervePackingListId=pl', role);
    expect(container.textContent).toContain('Not authorized');
    expect(apiClient.get).not.toHaveBeenCalled();
  },
);

it.each([403, 404, 500])('handles dispatch detail HTTP %s honestly', async (status) => {
  vi.mocked(apiClient.get).mockRejectedValue({ isAxiosError: true, response: { status } });
  await render('/fulfillment/erve-dispatches/ed');
  expect(container.textContent).toContain(
    status === 404 ? 'Dispatch not found' : 'Unable to load dispatch',
  );
});

it.each(['Save', 'Confirm Delivery'])(
  'recovers a stale %s version without automatically retrying the mutation',
  async (action) => {
    const patch = vi
      .spyOn(apiClient, 'patch')
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } })
      .mockResolvedValue({ data: { data: dispatch } });
    await render('/fulfillment/erve-dispatches/ed?tab=transport-delivery');
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: { ...dispatch, version: 4 } } });
    await act(async () => button(action).click());
    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/erve-dispatches/ed'));
    await vi.waitFor(() => expect(button('Refresh Dispatch')).toBeDefined());
    const refresh = button('Refresh Dispatch');
    await act(async () => refresh.click());
    await vi.waitFor(() => expect(button('Refresh Dispatch')).toBeUndefined());
    expect(patch).toHaveBeenCalledTimes(1);
    await act(async () => button(action).click());
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1]![1]).toMatchObject({ expectedVersion: 4 });
  },
);

it('prevents transport draft edits while a save is pending', async () => {
  let resolve!: (value: unknown) => void;
  vi.spyOn(apiClient, 'patch').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render('/fulfillment/erve-dispatches/ed?tab=transport-delivery');
  await act(async () => button('Save').click());
  const transporter = [...active().querySelectorAll('input')].find((el) =>
    el.closest('div')?.textContent?.includes('Transporter'),
  )!;
  await vi.waitFor(() => expect(transporter.matches(':disabled')).toBe(true));
  await act(async () => resolve({ data: { data: dispatch } }));
  await vi.waitFor(() => expect(transporter.matches(':disabled')).toBe(false));
});

it('submits projection lines separately when a Style and Size repeat, preserving shortages and version', async () => {
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: dispatch } });
  await render('/fulfillment/erve-dispatches/ed?tab=transport-delivery');
  const quantities = active().querySelectorAll<HTMLInputElement>('input[type="number"]');
  expect(quantities).toHaveLength(3);
  changeInput(quantities[0]!, '4');
  const remarks = [...active().querySelectorAll<HTMLInputElement>('input')].find((el) =>
    el.closest('div')?.textContent?.includes('Delivery Remarks'),
  )!;
  changeInput(remarks, 'One piece short');
  await act(async () => button('Confirm Delivery').click());
  expect(patch).toHaveBeenCalledExactlyOnceWith('/erve-dispatches/ed/delivery', {
    expectedVersion: 3,
    remarks: 'One piece short',
    lines: [
      { saleOrderLineId: 'one', receivedQuantity: 4 },
      { saleOrderLineId: 'two', receivedQuantity: 3 },
      { saleOrderLineId: 'three', receivedQuantity: 4 },
    ],
  });
});
