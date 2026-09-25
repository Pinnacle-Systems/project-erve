/** Shared harness for list-page pagination tests (test files only). */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import * as AuthContext from '../auth/AuthContext.js';

export interface CursorListPageCase<T> {
  element: ReactElement;
  path: string;
  // Builds row n; the harness serves 25 on the first page and 3 on the
  // second, as a cursor-paginated endpoint would.
  row: (n: number) => T;
  // Text that identifies row n in the rendered table.
  rowText: (n: number) => string;
  noun: string;
  roles?: Role[];
  // Responses for every other GET the page makes (filters, options…).
  otherGet?: (url: string) => unknown;
}

// Renders the page against a two-page endpoint and proves it reaches every
// row: 25 → Load more → 28 (all loaded), the second request carrying the
// first page's nextCursor.
export async function expectLoadsEveryPage<T>(testCase: CursorListPageCase<T>): Promise<void> {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  const user: AuthUser = {
    id: 'u1',
    email: 'admin@test.local',
    mobile: null,
    name: 'Admin',
    roles: testCase.roles ?? ['ADMIN'],
  };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 't',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);

  const listCalls: Array<Record<string, unknown>> = [];
  vi.spyOn(apiClient, 'get').mockImplementation(
    async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url !== testCase.path) {
        const other = testCase.otherGet?.(url);
        return { data: { data: other ?? [] } };
      }
      listCalls.push(config?.params ?? {});
      const page =
        config?.params?.cursor === 'cursor-1'
          ? {
              items: [26, 27, 28].map(testCase.row),
              pageInfo: { limit: 25, hasMore: false, nextCursor: null },
            }
          : {
              items: Array.from({ length: 25 }, (_, i) => testCase.row(i + 1)),
              pageInfo: { limit: 25, hasMore: true, nextCursor: 'cursor-1' },
            };
      return { data: { data: page } };
    },
  );

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const loadMore = () =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load more');
  try {
    act(() => {
      root.render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter>{testCase.element}</MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(25));
    expect(container.textContent).toContain(`Showing 25 ${testCase.noun}`);
    expect(container.textContent).not.toContain('(all loaded)');
    expect(listCalls[0]?.cursor).toBeUndefined();

    act(() => loadMore()!.click());
    await vi.waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(28));
    expect(listCalls.at(-1)?.cursor).toBe('cursor-1');
    expect(container.textContent).toContain(testCase.rowText(1));
    expect(container.textContent).toContain(testCase.rowText(28));
    expect(container.textContent).toContain(`Showing 28 ${testCase.noun} (all loaded)`);
    expect(loadMore()).toBeUndefined();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}
