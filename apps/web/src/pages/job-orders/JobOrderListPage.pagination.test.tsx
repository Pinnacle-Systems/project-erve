/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser } from '@erve/types';
import { JobOrderListPage } from './JobOrderListPage.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';

// GET /job-orders is cursor-paginated (25 per page by default). The list
// must reach every row, not just the first page.

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let listCalls: Array<Record<string, unknown>>;

function jobOrder(n: number) {
  return {
    id: `jo-${n}`,
    jobOrderNumber: `EIJOH/26-27/${String(n).padStart(4, '0')}`,
    financialYear: { id: 'fy-1', code: '2026-27' },
    factory: { name: 'Clifton' },
    processFlowVersion: { versionNumber: 2, processFlow: { name: 'Erve Production + Quality' } },
    sourceOrderSheetCount: 0,
    orderedQuantityTotal: 1008,
    preparedQuantityTotal: 0,
    status: 'PRODUCTION_COMPLETE',
    factoryConfirmationStatus: 'PENDING',
    createdAt: '2026-09-25T00:00:00.000Z',
    historicalImport: { legacyReferenceNumber: `EI25${String(n).padStart(3, '0')}`, historicalBusinessDate: '2025-08-15', importedAt: '2026-09-25T00:00:00Z' },
    operationalState: { primaryDisplayState: { label: 'Production Complete', tone: 'success' } },
  };
}

const firstPage = Array.from({ length: 25 }, (_, i) => jobOrder(91 - i));
const secondPage = Array.from({ length: 3 }, (_, i) => jobOrder(66 - i));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  listCalls = [];
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/job-orders/factory-options') return { data: { data: [] } };
    if (url.includes('/financial-years')) return { data: { data: [] } };
    listCalls.push(config?.params ?? {});
    const page = config?.params?.cursor === 'cursor-1'
      ? { items: secondPage, pageInfo: { limit: 25, hasMore: false, nextCursor: null } }
      : { items: firstPage, pageInfo: { limit: 25, hasMore: true, nextCursor: 'cursor-1' } };
    return { data: { data: page } };
  });
  const user: AuthUser = { id: 'u1', email: 'admin@test.local', mobile: null, name: 'Admin', roles: ['ADMIN'] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 't',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function loadMoreButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load more');
}

describe('JobOrderListPage pagination', () => {
  it('loads the next page by cursor and appends it, then reports all loaded', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/job-orders']}>
            <JobOrderListPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(25));
    expect(container.textContent).toContain('Showing 25 job orders');
    expect(listCalls[0]?.cursor).toBeUndefined();

    act(() => loadMoreButton()!.click());
    await vi.waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(28));
    expect(listCalls.at(-1)?.cursor).toBe('cursor-1');
    expect(container.textContent).toContain('EIJOH/26-27/0091');
    expect(container.textContent).toContain('EIJOH/26-27/0064');
    expect(container.textContent).toContain('Showing 28 job orders (all loaded)');
    expect(loadMoreButton()).toBeUndefined();
  });
});
