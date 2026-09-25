/** Shared harness proving a paginated list's PDF exports every page (test files only). */
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, vi, type Mock } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import * as AuthContext from '../auth/AuthContext.js';

export interface CursorListPdfCase<T> {
  element: ReactElement;
  path: string;
  row: (n: number) => T;
  // The mocked generator (vi.mock of the page's generate*ListPdf module).
  generator: Mock;
  roles?: Role[];
  otherGet?: (url: string) => unknown;
}

// Serves the list as 2 rows then 1 row (cursor 'c1'), renders the page —
// which shows only the first page — clicks Download PDF, and asserts the
// generator received all 3 rows: the export is not limited to loaded rows.
export async function expectPdfExportsEveryPage<T extends { id: string }>(
  testCase: CursorListPdfCase<T>,
): Promise<void> {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  vi.spyOn(apiClient, 'get').mockImplementation(
    async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url !== testCase.path) return { data: { data: testCase.otherGet?.(url) ?? [] } };
      const second = config?.params?.cursor === 'c1';
      return {
        data: {
          data: second
            ? { items: [testCase.row(3)], pageInfo: { limit: 2, hasMore: false, nextCursor: null } }
            : {
                items: [testCase.row(1), testCase.row(2)],
                pageInfo: { limit: 2, hasMore: true, nextCursor: 'c1' },
              },
        },
      };
    },
  );
  testCase.generator.mockResolvedValue(new Blob(['%PDF']));
  const createObjectURL = vi.fn(() => 'blob:pdf');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
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
    await vi.waitFor(() => expect(container.textContent).toContain('Load more'));
    const download = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => download.click());
    await vi.waitFor(() => expect(testCase.generator).toHaveBeenCalled());
    const exported = testCase.generator.mock.calls[0]![0] as T[];
    expect(exported.map((row) => row.id)).toEqual(
      [testCase.row(1), testCase.row(2), testCase.row(3)].map((row) => row.id),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
}
