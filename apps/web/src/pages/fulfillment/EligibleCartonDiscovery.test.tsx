/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, EligibleErveCartonView, ErvePackingListDetail } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ErvePackingListCreatePage } from './ErvePackingListCreatePage.js';
import { ErvePackingListDetailPage } from './ErvePackingListDetailPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const carton = (id: string, quantity = 10): EligibleErveCartonView => ({
  id,
  cartonNumber: id,
  factory: { id: `factory-${id}`, code: id, name: `Factory ${id}` },
  factoryDispatchId: `fd-${id}`,
  factoryDispatchNumber: `FPL-${id}`,
  saleOrder: { id: `so-${id}`, saleOrderNumber: `DO-${id}` },
  distributor: { id: 'dist', code: 'D', name: 'Distributor' },
  destination: { id: 'dest', label: null, city: 'Chennai', state: 'TN' },
  packageDetails: null,
  weight: '1.5',
  totalQuantity: quantity,
  lines: [
    {
      saleOrderLineId: `line-${id}`,
      styleNumber: 'ST1',
      styleName: 'Tee',
      sizeCode: 'M',
      sizeLabel: 'Medium',
      quantity,
    },
  ],
});
const detail = (
  id = 'list-a',
  status: ErvePackingListDetail['status'] = 'OPEN',
): ErvePackingListDetail => ({
  id,
  status,
  ervePackingListNumber: id,
  distributor: carton('A').distributor,
  saleOrder: null,
  destination: {
    label: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    addressLine1: 'Street',
    addressLine2: null,
    city: 'Chennai',
    state: 'TN',
    country: 'India',
    postalCode: null,
  },
  createdBy: { id: 'user', name: 'User', email: 'user@test.local' },
  createdAt: '2026-01-01T00:00:00Z',
  cartonCount: 0,
  totalQuantity: 0,
  sourceFactories: [],
  sourceDispatchOrders: [],
  dispatch: null,
  finalizedBy: null,
  finalizedAt: null,
  cartons: [],
  styleSizeSummary: [],
});
const response = (items: EligibleErveCartonView[], nextCursor: string | null = null) => ({
  data: { data: { items, pageInfo: { limit: 25, hasMore: nextCursor !== null, nextCursor } } },
});
const text = () => container.textContent ?? '';
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
const checkbox = (id: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="Select carton ${id}"]`)!;
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function settle(assertion: () => void) {
  const deadline = Date.now() + 3000;
  for (;;) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
}
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search eligible cartons"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('Search'));
}
function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/lists/list-b')}>Go to list B</button>;
}
function render(mode: 'create' | 'add', navigation = false) {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[mode === 'create' ? '/new' : '/lists/list-a']}>
          {navigation && <Navigation />}
          <Routes>
            <Route path="/new" element={<ErvePackingListCreatePage />} />
            <Route path="/lists/:id" element={<ErvePackingListDetailPage />} />
            <Route path="/fulfillment/erve-packing-lists/:id" element={<div>Created</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const user: AuthUser = {
    id: 'user',
    email: 'user@test.local',
    name: 'User',
    mobile: null,
    roles: ['ADMIN'],
  };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({ user } as ReturnType<
    typeof AuthContext.useAuth
  >);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  vi.restoreAllMocks();
});

describe.each(['create', 'add'] as const)('%s bounded carton discovery', (mode) => {
  it('requests bounded pages, preserves selection across search, and submits all retained IDs', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url !== '/erve-packing-lists/eligible-cartons') return { data: { data: detail() } };
      const params = config?.params as Record<string, unknown>;
      requests.push(params);
      if (params.search === 'later') return response([carton('C', 30)]);
      if (params.cursor) return response([carton('B', 20)]);
      return response([carton('A')], 'page-2');
    });
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValue(new Error('Carton was claimed; remove it and retry'));
    render(mode);
    await settle(() => expect(checkbox('A')).not.toBeNull());
    expect(requests[0]).toMatchObject({ limit: 25, search: '' });
    if (mode === 'add') expect(requests[0]?.ervePackingListId).toBe('list-a');
    await click(checkbox('A'));
    await click(button('Load more'));
    await settle(() => expect(checkbox('B')).not.toBeNull());
    await click(checkbox('B'));
    await search('later');
    await settle(() => expect(checkbox('C')).not.toBeNull());
    expect(checkbox('A')).toBeNull();
    if (mode === 'add') expect(text()).toContain('Selected: 2 cartons · 30 pieces');
    expect(container.querySelector('[aria-label="Remove selected carton A"]')).not.toBeNull();
    if (mode === 'create') {
      expect(text()).toContain('Source Factories');
      expect(text()).toContain('Source Dispatch Orders');
      for (const label of ['Source Factories', 'Source Dispatch Orders']) {
        const field = [...container.querySelectorAll('div')].find(
          (node) => node.textContent === label,
        )!;
        expect(field.parentElement?.textContent).toBe(`${label}2`);
      }
      const pieces = [...container.querySelectorAll('div')].find(
        (node) => node.textContent === 'Total Pieces',
      )!;
      expect(pieces.parentElement?.textContent).toBe('Total Pieces30');
      expect(text()).toContain('ST1');
      expect(text()).toContain('Tee');
      const summary = container.querySelector('[aria-label="Selected cartons"]')!;
      expect(summary.textContent).toContain('A');
      expect(summary.textContent).toContain('B');
    }
    await click(button(mode === 'create' ? 'Create Erve Packing List' : 'Add Selected Cartons'));
    await settle(() => expect(text()).toContain('Carton was claimed'));
    expect(post).toHaveBeenLastCalledWith(
      mode === 'create' ? '/erve-packing-lists' : '/erve-packing-lists/list-a/cartons',
      { cartonIds: ['A', 'B'] },
    );
    expect(container.querySelector('[aria-label="Remove selected carton A"]')).not.toBeNull();
    await click(container.querySelector<HTMLElement>('[aria-label="Remove selected carton A"]')!);
    await click(checkbox('C'));
    const requestsBeforeSuccess = requests.length;
    const detailUpdatedBefore =
      client.getQueryState(['erve-packing-list', 'list-a'])?.dataUpdatedAt ?? 0;
    post.mockResolvedValue({ data: { data: { id: 'created' } } });
    await click(button(mode === 'create' ? 'Create Erve Packing List' : 'Add Selected Cartons'));
    await settle(() =>
      expect(post).toHaveBeenLastCalledWith(
        mode === 'create' ? '/erve-packing-lists' : '/erve-packing-lists/list-a/cartons',
        { cartonIds: ['B', 'C'] },
      ),
    );
    if (mode === 'add') {
      await settle(() =>
        expect(container.querySelector('[aria-label="Remove selected carton B"]')).toBeNull(),
      );
      await settle(() => expect(requests.length).toBeGreaterThan(requestsBeforeSuccess));
      await settle(() =>
        expect(
          client.getQueryState(['erve-packing-list', 'list-a'])?.dataUpdatedAt,
        ).toBeGreaterThan(detailUpdatedBefore),
      );
    }
    expect(requests.every((params) => params.limit === 25)).toBe(true);
  });

  it('keeps retained summaries through empty intermediate pages, search loading, failure and same-cursor retry', async () => {
    let fail = true;
    const cursors: unknown[] = [];
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url !== '/erve-packing-lists/eligible-cartons') return { data: { data: detail() } };
      const params = config?.params as Record<string, unknown>;
      cursors.push(params.cursor);
      if (params.cursor === 'empty-next') {
        if (fail) throw new Error('Search unavailable');
        return response([carton('Z')]);
      }
      if (params.search === 'empty') return response([], 'empty-next');
      return response([carton('A')]);
    });
    render(mode);
    await settle(() => expect(checkbox('A')).not.toBeNull());
    await click(checkbox('A'));
    await search('empty');
    await settle(() => expect(button('Continue searching')).toBeDefined());
    expect(text()).not.toContain('Nothing eligible');
    expect(container.querySelector('[aria-label="Remove selected carton A"]')).not.toBeNull();
    const continuation = button('Continue searching');
    continuation.focus();
    expect(document.activeElement).toBe(continuation);
    expect(continuation.type).toBe('button');
    await click(continuation);
    await settle(() => expect(button('Retry search')).toBeDefined());
    expect(container.querySelector('[aria-label="Remove selected carton A"]')).not.toBeNull();
    fail = false;
    await click(button('Retry search'));
    await settle(() => expect(checkbox('Z')).not.toBeNull());
    expect(cursors.slice(-2)).toEqual(['empty-next', 'empty-next']);
    expect(button('Continue searching')).toBeUndefined();
  });

  it('shows an initial loading state and retries an initial request failure', async () => {
    let rejectInitial!: (error: Error) => void;
    let calls = 0;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
      if (url !== '/erve-packing-lists/eligible-cartons') return { data: { data: detail() } };
      if (calls++ === 0)
        return new Promise((_resolve, reject) => {
          rejectInitial = reject;
        });
      return response([]);
    });
    render(mode);
    await settle(() => expect(text()).toContain('Loading eligible cartons'));
    await act(async () => rejectInitial(new Error('Temporary network failure')));
    await settle(() => expect(button('Retry search')).toBeDefined());
    await click(button('Retry search'));
    await settle(() => expect(text()).toContain('No more eligible cartons'));
  });

  it('keeps selection during a pending search and when returning to a previous search', async () => {
    let resolveSearch!: (value: ReturnType<typeof response>) => void;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url !== '/erve-packing-lists/eligible-cartons') return { data: { data: detail() } };
      if (config?.params.search === 'pending')
        return new Promise((resolve) => {
          resolveSearch = resolve;
        });
      return response([carton('A')]);
    });
    render(mode);
    await settle(() => expect(checkbox('A')).not.toBeNull());
    await click(checkbox('A'));
    await search('pending');
    await settle(() => expect(text()).toContain('Loading eligible cartons'));
    expect(container.querySelector('[aria-label="Remove selected carton A"]')).not.toBeNull();
    await act(async () => resolveSearch(response([])));
    await settle(() => expect(text()).toContain('No more eligible cartons'));
    await search('');
    await settle(() => expect(checkbox('A')?.checked).toBe(true));
  });
});

describe('Add Cartons identity and access', () => {
  it('does not fetch addable cartons for a finalized list or read-only actor', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: { data: detail('list-a', 'FINALIZED') } });
    render('add');
    await settle(() => expect(text()).toContain('Finalized'));
    expect(get.mock.calls.some(([url]) => url === '/erve-packing-lists/eligible-cartons')).toBe(
      false,
    );
    expect(text()).not.toContain('Add Cartons');
  });

  it('does not carry selection, late page responses or pending mutation targets into another list', async () => {
    let resolveOldPage!: (value: ReturnType<typeof response>) => void;
    let resolveAdd!: (value: unknown) => void;
    const targets: string[] = [];
    vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
      if (url !== '/erve-packing-lists/eligible-cartons')
        return { data: { data: detail(url.endsWith('list-b') ? 'list-b' : 'list-a') } };
      const params = config?.params as Record<string, unknown>;
      if (params.ervePackingListId === 'list-b') return response([carton('B')]);
      if (params.cursor)
        return new Promise((resolve) => {
          resolveOldPage = resolve;
        });
      return response([carton('A')], 'old-next');
    });
    vi.spyOn(apiClient, 'post').mockImplementation((url) => {
      targets.push(url);
      return new Promise((resolve) => {
        resolveAdd = resolve;
      });
    });
    render('add', true);
    await settle(() => expect(checkbox('A')).not.toBeNull());
    await click(checkbox('A'));
    await click(button('Load more'));
    await click(button('Add Selected Cartons'));
    await click(button('Go to list B'));
    await settle(() => expect(checkbox('B')).not.toBeNull());
    await act(async () => {
      resolveOldPage(response([carton('STALE')]));
      resolveAdd({ data: { data: detail() } });
    });
    await settle(() => expect(checkbox('B')).not.toBeNull());
    expect(checkbox('STALE')).toBeNull();
    expect(checkbox('A')).toBeNull();
    expect(button('Add Selected Cartons').disabled).toBe(true);
    expect(targets).toEqual(['/erve-packing-lists/list-a/cartons']);
  });
});
