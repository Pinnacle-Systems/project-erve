/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, ErveDispatchDistributorReceiptView, Role } from '@erve/types';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { ErveDispatchDetailPage } from './ErveDispatchDetailPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let current: any;

const quantityLine = (overrides: Record<string, unknown>) => ({
  saleOrderLineId: 'one',
  styleId: 'st',
  styleNumber: 'ST-1',
  styleName: 'Tee',
  primaryImage: null,
  sizeId: 'small',
  sizeCode: 'S',
  sizeLabel: 'Small',
  sizeSortOrder: 1,
  quantity: 5,
  saleOrderNumber: 'EISO/1',
  purchaseMode: 'SALE_RETURN',
  ...overrides,
});
const baseDispatch = {
  id: 'ed',
  erveDispatchNumber: 'ED-1',
  status: 'DISPATCHED',
  version: 3,
  distributor: { id: 'dist', name: 'Distributor' },
  ervePackingList: { id: 'pl', ervePackingListNumber: 'PL-1' },
  dispatchDate: '2026-11-01',
  dispatchedBy: { name: 'Admin' },
  totalQuantity: 15,
  invoiceHandoffs: [],
  saleOrReturnLines: [],
  deliveryLines: [],
  deliveryConfirmationSource: null,
  deliveredBy: null,
  deliveredAt: null,
  deliveryRemarks: null,
  distributorReceipt: null,
  canSubmitDistributorReceipt: true,
  // ST-1 / S comes from two Sale Order lines (mixed modes); ST-1 / L from one.
  quantityLines: [
    quantityLine({ saleOrderLineId: 'a', quantity: 6, saleOrderNumber: 'EISO/1', purchaseMode: 'SALE_RETURN' }),
    quantityLine({ saleOrderLineId: 'b', quantity: 4, saleOrderNumber: 'EISO/2', purchaseMode: 'OUTRIGHT' }),
    quantityLine({ saleOrderLineId: 'c', sizeId: 'large', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 2, quantity: 5 }),
  ],
};

function receipt(overrides: Partial<ErveDispatchDistributorReceiptView> = {}): ErveDispatchDistributorReceiptView {
  return {
    id: 'r1',
    receivedBy: { id: 'u', name: 'Dana Distributor' },
    receivedAt: '2026-11-02T10:00:00.000Z',
    remarks: 'Two cartons short',
    ledgerDisposition: 'APPLIED',
    totalDispatchedQuantity: 15,
    totalReceivedQuantity: 13,
    totalShortageQuantity: 2,
    prior: { status: 'DISPATCHED', deliveryConfirmationSource: null, deliveredBy: null, deliveredAt: null, deliveryRemarks: null },
    downstreamBasis: 'DISTRIBUTOR_RECEIPT',
    hasLedgerDiscrepancy: false,
    lines: [
      { saleOrderLineId: 'a', styleId: 'st', styleNumber: 'ST-1', styleName: 'Tee', sizeId: 'small', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 1, saleOrderNumber: 'EISO/1', purchaseMode: 'SALE_RETURN', dispatchedQuantity: 6, receivedQuantity: 4, shortageQuantity: 2, previousLedgerQuantity: null, currentLedgerQuantity: 4 },
      { saleOrderLineId: 'b', styleId: 'st', styleNumber: 'ST-1', styleName: 'Tee', sizeId: 'small', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 1, saleOrderNumber: 'EISO/2', purchaseMode: 'OUTRIGHT', dispatchedQuantity: 4, receivedQuantity: 4, shortageQuantity: 0, previousLedgerQuantity: null, currentLedgerQuantity: 4 },
      { saleOrderLineId: 'c', styleId: 'st', styleNumber: 'ST-1', styleName: 'Tee', sizeId: 'large', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 2, saleOrderNumber: 'EISO/1', purchaseMode: 'SALE_RETURN', dispatchedQuantity: 5, receivedQuantity: 5, shortageQuantity: 0, previousLedgerQuantity: null, currentLedgerQuantity: 5 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  current = baseDispatch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (String(url).startsWith('/tax-invoices/')) throw { isAxiosError: true, response: { status: 404 } };
    return { data: { data: current } };
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(role: Role, path = '/fulfillment/erve-dispatches/ed?tab=distributor-receipt') {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: { roles: [role], name: 'User' } as AuthUser,
  } as ReturnType<typeof AuthContext.useAuth>);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fulfillment/erve-dispatches/:id" element={<ErveDispatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.textContent).not.toMatch(/Loading/));
}
const active = () => container.querySelector('[role="tabpanel"][data-state="active"]')!;
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label) as HTMLButtonElement | undefined;
function cell(label: string) {
  return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
// NumericField only commits on blur, so value + focusout in one act().
function enter(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}
function remarksInput() {
  return [...active().querySelectorAll<HTMLInputElement>('input')].find((el) => el.closest('div')?.textContent?.includes('Receipt Remarks'))!;
}
function plainChange(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const httpError = (status: number, code: string, message: string) => ({ isAxiosError: true, response: { status, data: { error: { code, message } } } });

describe('Distributor Receipt tab — entry', () => {
  it('starts with empty cells, blocks review until complete, and fills as dispatched on request', async () => {
    await render('DISTRIBUTOR');
    expect(cell('ST-1 S received quantity').value).toBe('');
    expect(button('Review Receipt')!.disabled).toBe(true);
    expect(active().textContent).toMatch(/Enter a received quantity for every Style and Size/);
    expect(active().textContent).toContain('Dispatched 10'); // 6 + 4 supplied by two order lines

    await act(async () => button('Fill as Dispatched')!.click());
    expect(cell('ST-1 S received quantity').value).toBe('10');
    expect(cell('ST-1 L received quantity').value).toBe('5');
    expect(button('Review Receipt')!.disabled).toBe(false);
    expect(active().textContent).not.toMatch(/Allocate partial receipts/);
  });

  it('requires remarks for any shortage, including an all-zero receipt', async () => {
    await render('DISTRIBUTOR');
    enter(cell('ST-1 S received quantity'), '10');
    enter(cell('ST-1 L received quantity'), '3');
    expect(active().textContent).toContain('Short 2');
    expect(button('Review Receipt')!.disabled).toBe(true);
    expect(active().textContent).toMatch(/Remarks are required when any quantity is short/);
    plainChange(remarksInput(), '2 damaged');
    expect(button('Review Receipt')!.disabled).toBe(false);

    enter(cell('ST-1 S received quantity'), '0');
    enter(cell('ST-1 L received quantity'), '0');
    plainChange(remarksInput(), '');
    expect(button('Review Receipt')!.disabled).toBe(true);
    plainChange(remarksInput(), 'Nothing arrived');
    expect(button('Review Receipt')!.disabled).toBe(false);
  });

  it('blocks over-receipt', async () => {
    await render('DISTRIBUTOR');
    enter(cell('ST-1 L received quantity'), '6');
    enter(cell('ST-1 S received quantity'), '10');
    expect(button('Review Receipt')!.disabled).toBe(true);
  });

  it('asks for explicit source-line allocation only for a partial receipt of a multi-line group', async () => {
    await render('DISTRIBUTOR');
    enter(cell('ST-1 L received quantity'), '5');
    enter(cell('ST-1 S received quantity'), '10');
    expect(active().textContent).not.toMatch(/Allocate partial receipts/);

    enter(cell('ST-1 S received quantity'), '7');
    plainChange(remarksInput(), 'Short');
    expect(active().textContent).toMatch(/Allocate partial receipts to source lines/);
    expect(active().textContent).toContain('EISO/1');
    expect(active().textContent).toContain('Sale or Return');
    expect(active().textContent).toContain('Outright');
    expect(button('Review Receipt')!.disabled).toBe(true);

    enter(cell('ST-1 S EISO/1 allocated received quantity'), '3');
    enter(cell('ST-1 S EISO/2 allocated received quantity'), '3');
    expect(active().textContent).toMatch(/Allocations total 6; they must total 7/);
    expect(button('Review Receipt')!.disabled).toBe(true);
    enter(cell('ST-1 S EISO/2 allocated received quantity'), '4');
    expect(button('Review Receipt')!.disabled).toBe(false);
  });
});

describe('Distributor Receipt tab — review and submission', () => {
  async function toReview() {
    await render('DISTRIBUTOR');
    enter(cell('ST-1 L received quantity'), '5');
    enter(cell('ST-1 S received quantity'), '7');
    plainChange(remarksInput(), 'Short');
    enter(cell('ST-1 S EISO/1 allocated received quantity'), '3');
    enter(cell('ST-1 S EISO/2 allocated received quantity'), '4');
    await act(async () => button('Review Receipt')!.click());
  }

  it('requires the final acknowledgement, posts the strict payload once, and then shows read-only evidence', async () => {
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async () => ({
      data: { data: { ...baseDispatch, status: 'DELIVERED', version: 4, canSubmitDistributorReceipt: false, distributorReceipt: receipt() } },
    }));
    await toReview();
    expect(active().textContent).toMatch(/Review and Confirm Receipt/);
    expect(button('Confirm Receipt')!.disabled).toBe(true);
    await act(async () => active().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(button('Confirm Receipt')!.disabled).toBe(false);

    await act(async () => {
      button('Confirm Receipt')!.click();
      button('Confirm Receipt')!.click();
    });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0]!;
    expect(url).toBe('/erve-dispatches/ed/distributor-receipt');
    expect(body).toEqual({
      expectedVersion: 3,
      acknowledged: true,
      remarks: 'Short',
      groups: [
        { styleId: 'st', sizeId: 'small', receivedQuantity: 7, allocations: [{ saleOrderLineId: 'a', receivedQuantity: 3 }, { saleOrderLineId: 'b', receivedQuantity: 4 }] },
        { styleId: 'st', sizeId: 'large', receivedQuantity: 5 },
      ],
    });
    expect((config as { headers: Record<string, string> }).headers['Idempotency-Key']).toMatch(/\S+/);

    await vi.waitFor(() => expect(container.textContent).toMatch(/final confirmation/i));
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(button('Confirm Receipt')).toBeUndefined();
    expect(active().textContent).toContain('Dana Distributor');
    expect(active().textContent).toContain('Two cartons short');
    expect(active().textContent).toMatch(/now the received quantities used by Actual Sales/);
  });

  it('keeps entries on a stale-version conflict, requires a refresh, then resubmits with the fresh version and the same key', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(httpError(409, 'STALE_VERSION', 'The job order changed since it was loaded'))
      .mockResolvedValue({ data: { data: { ...baseDispatch, status: 'DELIVERED', version: 5, distributorReceipt: receipt(), canSubmitDistributorReceipt: false } } });
    await toReview();
    await act(async () => active().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button('Confirm Receipt')!.click());

    await vi.waitFor(() => expect(active().textContent).toMatch(/your entries are kept/));
    expect(button('Confirm Receipt')!.disabled).toBe(true);
    current = { ...baseDispatch, version: 4 };
    await act(async () => button('Refresh Dispatch')!.click());
    await vi.waitFor(() => expect(button('Refresh Dispatch')).toBeUndefined());
    expect(active().textContent).toMatch(/Review and Confirm Receipt/);

    await act(async () => button('Confirm Receipt')!.click());
    expect(post).toHaveBeenCalledTimes(2);
    expect((post.mock.calls[1]![1] as { expectedVersion: number }).expectedVersion).toBe(4);
    expect((post.mock.calls[1]![2] as { headers: Record<string, string> }).headers['Idempotency-Key']).toBe(
      (post.mock.calls[0]![2] as { headers: Record<string, string> }).headers['Idempotency-Key'],
    );
  });

  it('keeps entries after a network failure and retries with the same request key', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce({ isAxiosError: true })
      .mockResolvedValue({ data: { data: { ...baseDispatch, status: 'DELIVERED', version: 4, distributorReceipt: receipt(), canSubmitDistributorReceipt: false } } });
    await toReview();
    await act(async () => active().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button('Confirm Receipt')!.click());
    await vi.waitFor(() => expect(active().textContent).toMatch(/could not confirm whether the receipt was recorded/));
    expect(button('Confirm Receipt')!.disabled).toBe(false);

    await act(async () => button('Confirm Receipt')!.click());
    expect(post).toHaveBeenCalledTimes(2);
    expect((post.mock.calls[1]![2] as { headers: Record<string, string> }).headers['Idempotency-Key']).toBe(
      (post.mock.calls[0]![2] as { headers: Record<string, string> }).headers['Idempotency-Key'],
    );
  });

  it('warns when confirming that nothing was received', async () => {
    await render('DISTRIBUTOR');
    enter(cell('ST-1 S received quantity'), '0');
    enter(cell('ST-1 L received quantity'), '0');
    plainChange(remarksInput(), 'Nothing arrived');
    await act(async () => button('Review Receipt')!.click());
    expect(active().textContent).toMatch(/nothing was received/);
  });
});

describe('Distributor Receipt tab — roles and evidence', () => {
  it('offers no entry form to staff and says no receipt has been submitted', async () => {
    current = { ...baseDispatch, canSubmitDistributorReceipt: false };
    await render('ADMIN');
    expect(button('Review Receipt')).toBeUndefined();
    expect(active().textContent).toMatch(/has not yet submitted a final receipt/);
  });

  it('points the distributor at the receipt tab from the overview', async () => {
    await render('DISTRIBUTOR', '/fulfillment/erve-dispatches/ed');
    expect(button('Go to Distributor Receipt')).toBeTruthy();
    await act(async () => button('Go to Distributor Receipt')!.click());
    await vi.waitFor(() => expect(button('Fill as Dispatched')).toBeTruthy());
  });

  it('shows an evidence-only receipt beside the earlier ledger in use, highlighting the difference', async () => {
    current = {
      ...baseDispatch,
      status: 'DELIVERED',
      canSubmitDistributorReceipt: false,
      deliveryConfirmationSource: 'USER_CONFIRMED',
      deliveredBy: { id: 'm', name: 'Mia Merch', email: 'm@x' },
      deliveredAt: '2026-11-01T09:00:00.000Z',
      deliveryLines: [{ saleOrderLineId: 'a', receivedQuantity: 6 }, { saleOrderLineId: 'b', receivedQuantity: 4 }, { saleOrderLineId: 'c', receivedQuantity: 5 }],
      distributorReceipt: receipt({
        ledgerDisposition: 'EVIDENCE_ONLY_EXISTING',
        downstreamBasis: 'EXISTING_LEDGER',
        hasLedgerDiscrepancy: true,
        prior: { status: 'DELIVERED', deliveryConfirmationSource: 'USER_CONFIRMED', deliveredBy: { id: 'm', name: 'Mia Merch' }, deliveredAt: '2026-11-01T09:00:00.000Z', deliveryRemarks: null },
        lines: receipt().lines.map((l) => ({ ...l, previousLedgerQuantity: l.dispatchedQuantity, currentLedgerQuantity: l.dispatchedQuantity })),
      }),
    };
    await render('MERCHANDISER');
    const text = active().textContent!;
    expect(text).toMatch(/continue to use the Admin \/ Merchandiser delivery confirmation/);
    expect(text).toMatch(/differs from the quantities currently used for Sales and Returns/);
    expect(text).toContain('Ledger in Use');
    expect(text).toContain('Delivery Confirmation Ledger (In Use)');
    expect(text).toContain('Mia Merch');
  });

  it('explains a final all-zero receipt and hides the Admin fallback on the transport tab', async () => {
    current = {
      ...baseDispatch,
      canSubmitDistributorReceipt: false,
      distributorReceipt: receipt({
        ledgerDisposition: 'NOT_APPLIED_ZERO',
        downstreamBasis: 'NONE',
        totalReceivedQuantity: 0,
        totalShortageQuantity: 15,
        lines: receipt().lines.map((l) => ({ ...l, receivedQuantity: 0, shortageQuantity: l.dispatchedQuantity, currentLedgerQuantity: null })),
      }),
    };
    await render('ADMIN');
    expect(active().textContent).toMatch(/confirmed that nothing was received/);
    expect(active().textContent).toMatch(/remains Dispatched/);

    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (String(url).startsWith('/tax-invoices/') || String(url).startsWith('/carton-delivery/')) throw { isAxiosError: true, response: { status: 404 } };
      return { data: { data: current } };
    });
    await act(async () =>
      [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Transport & Delivery')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })),
    );
    await vi.waitFor(() => expect(active().textContent).toMatch(/Distributor reports nothing received/));
    expect(button('Confirm Delivery')).toBeUndefined();
  });
});

describe('Distributor Receipt tab — grouped confirmation summary and evidence detail (ISS-023 / DEMO-003)', () => {
  const tableOf = (label: string) => container.querySelector<HTMLTableElement>(`table[aria-label="${label}"]`)!;
  const cells = (block: Element, label: string) => {
    const row = [...block.querySelectorAll('tr')].find((tr) => tr.querySelector('th')?.textContent === label)!;
    return [...row.children].map((c) => c.textContent);
  };

  it('review step shows one Style row with Size columns and totals, with each source-line allocation listed beneath', async () => {
    await render('DISTRIBUTOR');
    enter(cell('ST-1 L received quantity'), '5');
    enter(cell('ST-1 S received quantity'), '7');
    plainChange(remarksInput(), 'Short');
    enter(cell('ST-1 S EISO/1 allocated received quantity'), '3');
    enter(cell('ST-1 S EISO/2 allocated received quantity'), '4');
    await act(async () => button('Review Receipt')!.click());

    const summary = tableOf('Receipt summary');
    expect(summary.querySelectorAll('tbody')).toHaveLength(1);
    expect([...summary.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Measure', 'S', 'L', 'Total']);
    const block = summary.querySelector('tbody')!;
    expect(cells(block, 'Dispatched')).toEqual(['Dispatched', '10', '5', '15']);
    expect(cells(block, 'Received')).toEqual(['Received', '7', '5', '12']);
    expect(cells(block, 'Short')).toEqual(['Short', '3', '0', '3']);
    // The two Sale Order lines behind ST-1 / S keep their own allocation: nothing is merged away.
    expect(block.textContent).toContain('S · EISO/1 · Sale or Return: dispatched 6, received 3, short 3');
    expect(block.textContent).toContain('S · EISO/2 · Outright: dispatched 4, received 4, short 0');
    expect(summary.querySelector('svg')).not.toBeNull();
  });

  it('evidence detail groups the Style, keeps both source lines of a Size, and flags a source that differs from the ledger in use', async () => {
    current = {
      ...baseDispatch,
      status: 'DELIVERED',
      canSubmitDistributorReceipt: false,
      deliveryConfirmationSource: 'USER_CONFIRMED',
      distributorReceipt: receipt({
        ledgerDisposition: 'EVIDENCE_ONLY_EXISTING',
        downstreamBasis: 'EXISTING_LEDGER',
        hasLedgerDiscrepancy: true,
        lines: receipt().lines.map((l) => (l.saleOrderLineId === 'a' ? { ...l, currentLedgerQuantity: 6 } : l)),
      }),
    };
    await render('ADMIN');

    const detail = tableOf('Distributor receipt detail');
    expect(detail.querySelectorAll('tbody')).toHaveLength(1);
    const block = detail.querySelector('tbody')!;
    expect(cells(block, 'Dispatched')).toEqual(['Dispatched', '10', '5', '15']);
    expect(cells(block, 'Received')).toEqual(['Received', '8', '5', '13']);
    expect(cells(block, 'Short')).toEqual(['Short', '2', '0', '2']);
    expect(cells(block, 'Ledger in Use')).toEqual(['Ledger in Use', '10', '5', '15']);
    expect(block.textContent).toContain('EISO/1 · Sale or Return: dispatched 6, received 4, short 2, ledger in use 6');
    expect(block.textContent).toContain('(differs from the Distributor receipt)');
    expect(block.textContent).toContain('EISO/2 · Outright: dispatched 4, received 4, short 0, ledger in use 4');
    expect(active().textContent).toMatch(/differs from the quantities currently used/);
  });

  it('evidence detail omits the ledger measure when the receipt itself is the ledger', async () => {
    current = {
      ...baseDispatch,
      status: 'DELIVERED',
      canSubmitDistributorReceipt: false,
      deliveryConfirmationSource: 'DISTRIBUTOR_CONFIRMED',
      distributorReceipt: receipt(),
    };
    await render('ADMIN');
    const labels = [...tableOf('Distributor receipt detail').querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent);
    expect(labels).toEqual(['Dispatched', 'Received', 'Short']);
  });
});
