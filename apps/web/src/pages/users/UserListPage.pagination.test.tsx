/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { expectPdfExportsEveryPage } from '../../test-support/cursor-list-pdf.js';
import { UserListPage } from './UserListPage.js';
import type { AdminUserSummary } from '../master-data/types.js';

const userListGenerator = vi.fn();
vi.mock('./pdf/generateUserListPdf.js', () => ({
  generateUserListPdfBlob: (...args: unknown[]) => userListGenerator(...args),
}));

const pad = (n: number) => String(n).padStart(3, '0');

function user(n: number): AdminUserSummary {
  return {
    id: `user-${n}`,
    name: `User ${pad(n)}`,
    email: `user${pad(n)}@erve.test`,
    mobile: null,
    status: 'ACTIVE',
    roles: ['MERCHANDISER'],
    distributors: [],
    factories: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}

// UP1: the User list pages by cursor (opt-in via limit) and its PDF exports
// every matching page, not only the loaded rows.
describe('User list pagination (UP1)', () => {
  beforeEach(() => userListGenerator.mockReset());

  it('reaches every user with Load more', async () => {
    await expectLoadsEveryPage({
      element: <UserListPage />,
      path: '/users',
      noun: 'users',
      row: user,
      rowText: (n) => `User ${pad(n)}`,
    });
  });

  it('exports every page to the PDF, not just the loaded rows', async () => {
    await expectPdfExportsEveryPage({
      element: <UserListPage />,
      path: '/users',
      row: user,
      generator: userListGenerator,
    });
  });
});

describe('User list pagination — filters, cache key and errors (UP1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let calls: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const admin: AuthUser = {
      id: 'u1',
      email: 'admin@test.local',
      mobile: null,
      name: 'Admin',
      roles: ['ADMIN'],
    };
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: admin,
      token: 't',
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
      isInitializing: false,
    } as unknown as ReturnType<typeof AuthContext.useAuth>);
    userListGenerator.mockReset();
    userListGenerator.mockResolvedValue(new Blob(['%PDF']));
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }),
    );
    calls = [];
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

  // Serves `rows` filtered by ?search= (name contains), paged by limit/cursor
  // like the real endpoint; `failCursor` makes that page's request fail.
  function serve(rows: AdminUserSummary[], options: { failCursor?: string } = {}) {
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url: string, config?: { params?: Record<string, unknown> }) => {
        if (url !== '/users') throw new Error(`Unexpected request: ${url}`);
        const params = config?.params ?? {};
        calls.push(params);
        if (options.failCursor && params.cursor === options.failCursor) throw new Error('boom');
        const search = String(params.search ?? '').toLowerCase();
        const matching = rows.filter((row) => row.name.toLowerCase().includes(search));
        const start = params.cursor ? matching.findIndex((row) => row.id === params.cursor) + 1 : 0;
        const limit = Number(params.limit);
        const items = matching.slice(start, start + limit);
        const hasMore = start + limit < matching.length;
        return {
          data: {
            data: {
              items,
              pageInfo: { limit, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null },
            },
          },
        };
      },
    );
  }

  function render() {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <UserListPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  const rowCount = () => container.querySelectorAll('tbody tr').length;
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);

  async function search(text: string) {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search by name or email"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // 30 "Kochi" users plus 30 others: two list pages of matching rows.
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ ...user(i + 1), name: `Kochi ${pad(i + 1)}` })),
    ...Array.from({ length: 30 }, (_, i) => user(i + 101)),
  ];

  it('requests 25 per page, and a search change restarts from the first page', async () => {
    serve(rows);
    render();
    await vi.waitFor(() => expect(rowCount()).toBe(25));
    expect(calls[0]).toEqual({ limit: 25, cursor: undefined });

    act(() => button('Load more')!.click());
    await vi.waitFor(() => expect(rowCount()).toBe(50));

    await search('kochi');
    await vi.waitFor(() => expect(rowCount()).toBe(25));
    expect(calls.at(-1)).toEqual({ search: 'kochi', limit: 25, cursor: undefined });
    expect(container.textContent).toContain('Kochi 001');
    expect(container.textContent).not.toContain('User 101');
  });

  it("keeps the 'admin-users' query-key prefix the user screens invalidate", async () => {
    serve(rows);
    render();
    await vi.waitFor(() => expect(rowCount()).toBe(25));
    const before = calls.length;

    await act(async () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }));

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it('exports every page of the filtered list with the screen’s filters', async () => {
    serve(rows);
    render();
    await search('kochi');
    await vi.waitFor(() => expect(calls.at(-1)?.search).toBe('kochi'));
    await vi.waitFor(() => expect(rowCount()).toBe(25));
    const listCalls = calls.length;

    act(() => button('Download PDF')!.click());
    await vi.waitFor(() => expect(userListGenerator).toHaveBeenCalled());

    const exportCalls = calls.slice(listCalls);
    expect(exportCalls.length).toBeGreaterThan(0);
    expect(exportCalls.every((params) => params.search === 'kochi')).toBe(true);
    const [exported, filters] = userListGenerator.mock.calls[0]! as [
      AdminUserSummary[],
      { search: string },
    ];
    expect(exported.map((row) => row.name)).toEqual(
      Array.from({ length: 30 }, (_, i) => `Kochi ${pad(i + 1)}`),
    );
    expect(filters.search).toBe('kochi');
  });

  it('keeps loaded rows and shows the established error when Load more fails', async () => {
    serve(rows, { failCursor: 'user-25' });
    render();
    await vi.waitFor(() => expect(rowCount()).toBe(25));

    act(() => button('Load more')!.click());
    await vi.waitFor(() => expect(container.textContent).toContain('Unable to load more users'));
  });
});
