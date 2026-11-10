/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { DistributorReturnDetailPage } from './DistributorReturnDetailPage.js';
import type { DistributorReturnLineView, DistributorReturnView } from './types.js';

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

function buildReturn(overrides: Partial<DistributorReturnView> = {}): DistributorReturnView {
  return {
    id: 'dr-1',
    returnNumber: 'EIDR/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    returnDate: '2026-09-01T00:00:00.000Z',
    status: 'SUBMITTED',
    returnReason: 'Excess stock',
    remarks: null,
    submittedBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    submittedAt: '2026-09-01T00:00:00.000Z',
    approvedBy: null,
    approvedAt: null,
    approvalRemarks: null,
    rejectionReason: null,
    receivedBy: null,
    receivedAt: null,
    creditNoteReference: null,
    creditNoteDate: null,
    creditNoteRecordedBy: null,
    cancelledBy: null,
    cancelledAt: null,
    lines: [],
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
        <MemoryRouter initialEntries={['/fulfillment/distributor-returns/dr-1']}>
          <Routes>
            <Route path="/fulfillment/distributor-returns/:id" element={<DistributorReturnDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading return'));
}

describe('DistributorReturnDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 500');
    });

    expect(content()).not.toContain('Distributor Return not found');
    expect(content()).toContain('Unable to load return');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const record = buildReturn();
    await renderPage(async (url: string) => {
      if (url === '/distributor-returns/dr-1') return { data: { data: record } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('EIDR/26-27/0001');
    expect(content()).toContain('Distributor One');
    expect(content()).not.toContain('Unable to load return');
  });
});

function returnLine(overrides: Partial<DistributorReturnLineView> = {}): DistributorReturnLineView {
  return {
    id: 'rl-1',
    erveDispatch: { id: 'ed-1', erveDispatchNumber: 'EIED/26-27/0001' },
    saleOrderLineId: 'sol-1',
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    primaryImage: null,
    sizeId: 'size-m',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    sizeSortOrder: 2,
    requestedQuantity: 10,
    approvedQuantity: null,
    receivedQuantity: null,
    returnedStockLotId: null,
    ...overrides,
  };
}

describe('DistributorReturnDetailPage grouped Style x Size (ISS-023 / DEMO-003)', () => {
  const tableOf = (label: string) => container.querySelector<HTMLTableElement>(`table[aria-label="${label}"]`)!;
  const cells = (block: Element, label: string) => {
    const row = Array.from(block.querySelectorAll('tr')).find((tr) => tr.querySelector('th')?.textContent === label)!;
    return Array.from(row.children).map((cell) => cell.textContent);
  };
  const setValue = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!;
    await act(async () => button.click());
  };

  const sizes = [
    returnLine({ id: 'rl-l', saleOrderLineId: 'sol-l', sizeId: 'size-l', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 3, requestedQuantity: 8 }),
    returnLine({ id: 'rl-s', saleOrderLineId: 'sol-s', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 1, requestedQuantity: 3 }),
  ];

  it('summarises Requested / Approved / Received per Size in one Style row, with canonical Size order and not-yet-recorded dashes', async () => {
    await renderPage(async () => ({ data: { data: buildReturn({ lines: sizes }) } }));
    const table = tableOf('Return lines by Style and Size');
    expect(table.querySelectorAll('tbody')).toHaveLength(1);
    expect(Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Measure', 'S', 'L', 'Total']);
    const block = table.querySelector('tbody')!;
    expect(block.textContent).toContain('EIED/26-27/0001 · Order EISO/26-27/0001');
    expect(cells(block, 'Requested')).toEqual(['Requested', '3', '8', '11']);
    expect(cells(block, 'Approved')).toEqual(['Approved', '—', '—', '—']);
    expect(cells(block, 'Received')).toEqual(['Received', '—', '—', '—']);
    expect(table.querySelector('svg')).not.toBeNull();
  });

  it('keeps the same Style under two Dispatches in separate rows', async () => {
    await renderPage(async () => ({
      data: {
        data: buildReturn({
          lines: [
            returnLine({ id: 'a' }),
            returnLine({ id: 'b', erveDispatch: { id: 'ed-2', erveDispatchNumber: 'EIED/26-27/0002' }, saleOrderLineId: 'sol-2' }),
          ],
        }),
      },
    }));
    expect(tableOf('Return lines by Style and Size').querySelectorAll('tbody')).toHaveLength(2);
  });

  it('Finance review: one approved input per original line id, ceilings from the request, and the unchanged approve payload', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: buildReturn() } });
    await renderPage(async () => ({
      data: {
        data: buildReturn({
          lines: [
            ...sizes,
            // A second source line for the same Style/Size must stay independently editable.
            returnLine({ id: 'rl-s2', saleOrderLineId: 'sol-s2', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 1, requestedQuantity: 6 }),
          ],
        }),
      },
    }), 'ACCOUNTANT');

    const table = tableOf('Finance review by Style and Size');
    const inputs = Array.from(table.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.value)).toEqual(['3', '6', '8']);
    expect(inputs.map((input) => input.max)).toEqual(['3', '6', '8']);
    expect(table.textContent).toContain('Line 1');
    expect(table.textContent).toContain('Line 2');

    setValue(inputs[1]!, '4');
    // Editing only the second S line moves only the displayed total (3 + 4 + 8), not the other lines.
    expect(cells(table.querySelector('tbody')!, 'Approve').at(-1)).toBe('15');
    await click('Approve');
    expect(post).toHaveBeenCalledExactlyOnceWith('/distributor-returns/dr-1/approve', {
      expectedVersion: 1,
      lines: [
        { id: 'rl-l', approvedQuantity: 8 },
        { id: 'rl-s', approvedQuantity: 3 },
        { id: 'rl-s2', approvedQuantity: 4 },
      ],
      approvalRemarks: undefined,
    });
  });

  it('physical receipt: defaults to the approved quantity per line and posts per-line received quantities', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: buildReturn() } });
    await renderPage(async () => ({
      data: {
        data: buildReturn({
          status: 'APPROVED',
          lines: [
            returnLine({ id: 'rl-s', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 1, approvedQuantity: 5 }),
            returnLine({ id: 'rl-m', saleOrderLineId: 'sol-m', approvedQuantity: 0 }),
          ],
        }),
      },
    }), 'ADMIN');
    const table = tableOf('Physical receipt by Style and Size');
    const inputs = Array.from(table.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    expect(inputs.map((input) => input.value)).toEqual(['5', '0']);
    expect(inputs.map((input) => input.max)).toEqual(['5', '0']);
    setValue(inputs[0]!, '4');
    await click('Record Receipt');
    expect(post).toHaveBeenCalledExactlyOnceWith('/distributor-returns/dr-1/receive', {
      expectedVersion: 1,
      lines: [
        { id: 'rl-s', receivedQuantity: 4 },
        { id: 'rl-m', receivedQuantity: 0 },
      ],
    });
  });

  it('shows no editable controls to roles that cannot approve or receive', async () => {
    await renderPage(async () => ({ data: { data: buildReturn({ lines: sizes }) } }), 'SENIOR_MANAGEMENT');
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(tableOf('Return lines by Style and Size')).not.toBeNull();
  });
});
