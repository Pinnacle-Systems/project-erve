/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { FactoryPackingQueuePage } from './FactoryPackingQueuePage.js';
import type { FactoryDispatchSummary, FactoryPackingQueueLine } from './types.js';

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

function factoryOption(overrides: Partial<{ id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE' }> = {}) {
  return { id: 'fac-1', code: 'FAC-001', name: 'Chennai Factory', status: 'ACTIVE' as const, ...overrides };
}

function queueLine(overrides: Partial<FactoryPackingQueueLine> = {}): FactoryPackingQueueLine {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    saleOrderLineId: 'line-1',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeId: 'size-1',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    allocatedQuantity: 10,
    packedQuantity: 0,
    remainingQuantity: 10,
    ...overrides,
  };
}

function queueApiResponse(
  items: FactoryPackingQueueLine[],
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null } = { limit: 25, hasMore: false, nextCursor: null },
) {
  return { data: { data: { items, pageInfo } } };
}

function dispatchSummary(overrides: Partial<FactoryDispatchSummary> = {}): FactoryDispatchSummary {
  return {
    id: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'fac-1', code: 'FAC-001', name: 'Chennai Factory' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One' }] },
    status: 'DRAFT',
    version: 1,
    preparedAt: '2026-09-01T00:00:00.000Z',
    finalizedAt: null,
    consolidated: false,
    ...overrides,
  };
}

type GetImpl = (url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: { data: unknown } }>;

async function renderPage(role: Role, initialUrl: string, getImpl: GetImpl) {
  mockAuth(role);
  const getSpy = vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/fulfillment/factory-dispatches" element={<FactoryPackingQueuePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
  return getSpy;
}

function calledUrls(getSpy: { mock: { calls: unknown[][] } }): string[] {
  return getSpy.mock.calls.map((call) => call[0] as string);
}

describe('FactoryPackingQueuePage — UXAUTH-003/004/005', () => {
  describe('FACTORY_USER (no selector)', () => {
    it('never renders a Factory selector and requests carry no factoryId', async () => {
      const getSpy = await renderPage('FACTORY_USER', '/fulfillment/factory-dispatches', async (url) => {
        if (url === '/factory-dispatches/packing-queue') return queueApiResponse([queueLine()]);
        if (url === '/factory-dispatches') return { data: { data: { items: [dispatchSummary()], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).not.toContain('Select a Factory');
      expect(content()).not.toContain('Unable to load Factories');
      expect(calledUrls(getSpy)).not.toContain('/factory-dispatches/factory-options');

      const queueCall = getSpy.mock.calls.find((c) => c[0] === '/factory-dispatches/packing-queue')!;
      expect((queueCall[1] as { params?: Record<string, unknown> } | undefined)?.params).toMatchObject({ limit: 25 });
      expect((queueCall[1] as { params?: Record<string, unknown> } | undefined)?.params?.factoryId).toBeUndefined();
      expect(content()).toContain('ST-001');
      expect(content()).toContain('EIFD/26-27/0001');
    });
  });

  describe('broad readers (ADMIN/MERCHANDISER/SENIOR_MANAGEMENT) — context required', () => {
    it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
      '%s sees the selector and a context prompt, and issues no queue/dispatches request before choosing',
      async (role) => {
        const getSpy = await renderPage(role, '/fulfillment/factory-dispatches', async (url) => {
          if (url === '/factory-dispatches/factory-options') return { data: { data: [factoryOption()] } };
          throw new Error(`Unexpected GET: ${url}`);
        });

        expect(content()).toContain('Select a Factory to view its packing queue');
        expect(content()).not.toContain('Nothing to pack');
        expect(content()).not.toContain('No Factory Dispatches yet');
        expect(calledUrls(getSpy)).not.toContain('/factory-dispatches/packing-queue');
        expect(calledUrls(getSpy)).not.toContain('/factory-dispatches');
      },
    );
  });

  describe('Factory A selected', () => {
    it('requests carry factoryId=A and Factory A rows render', async () => {
      const getSpy = await renderPage(
        'ADMIN',
        '/fulfillment/factory-dispatches?factoryId=fac-A',
        async (url) => {
          if (url === '/factory-dispatches/factory-options') {
            return { data: { data: [factoryOption({ id: 'fac-A', code: 'FAC-A', name: 'Factory A' })] } };
          }
          if (url === '/factory-dispatches/packing-queue') {
            return queueApiResponse([queueLine({ styleNumber: 'A-STYLE' })]);
          }
          if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
          throw new Error(`Unexpected GET: ${url}`);
        },
      );

      expect(content()).toContain('A-STYLE');
      const queueCall = getSpy.mock.calls.find((c) => c[0] === '/factory-dispatches/packing-queue')!;
      expect((queueCall[1] as { params?: Record<string, unknown> }).params).toMatchObject({ factoryId: 'fac-A', limit: 25 });
      const listCall = getSpy.mock.calls.find((c) => c[0] === '/factory-dispatches')!;
      expect((listCall[1] as { params?: Record<string, unknown> }).params).toMatchObject({ factoryId: 'fac-A', limit: 25 });
    });
  });

  describe('switching Factory A -> Factory B', () => {
    it('uses a different query key/request and never shows Factory A data as Factory B data', async () => {
      const optionsByFactory = [
        factoryOption({ id: 'fac-A', code: 'FAC-A', name: 'Factory A' }),
        factoryOption({ id: 'fac-B', code: 'FAC-B', name: 'Factory B' }),
      ];

      // First render Factory A.
      const getSpyA = await renderPage('MERCHANDISER', '/fulfillment/factory-dispatches?factoryId=fac-A', async (url, config) => {
        if (url === '/factory-dispatches/factory-options') return { data: { data: optionsByFactory } };
        if (url === '/factory-dispatches/packing-queue') {
          const factoryId = config?.params?.factoryId;
          return queueApiResponse(factoryId === 'fac-A' ? [queueLine({ styleNumber: 'A-STYLE' })] : []);
        }
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });
      expect(content()).toContain('A-STYLE');
      getSpyA.mockClear();

      // Re-render fresh as if navigating to Factory B (a distinct query key —
      // proves switching Factory cannot surface stale Factory A rows).
      act(() => root.unmount());
      container.innerHTML = '';
      root = createRoot(container);
      const getSpyB = await renderPage('MERCHANDISER', '/fulfillment/factory-dispatches?factoryId=fac-B', async (url, config) => {
        if (url === '/factory-dispatches/factory-options') return { data: { data: optionsByFactory } };
        if (url === '/factory-dispatches/packing-queue') {
          const factoryId = config?.params?.factoryId;
          return queueApiResponse(factoryId === 'fac-B' ? [queueLine({ styleNumber: 'B-STYLE' })] : [queueLine({ styleNumber: 'A-STYLE' })]);
        }
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('B-STYLE');
      expect(content()).not.toContain('A-STYLE');
      const queueCallB = getSpyB.mock.calls.find((c) => c[0] === '/factory-dispatches/packing-queue')!;
      expect((queueCallB[1] as { params?: Record<string, unknown> }).params).toMatchObject({ factoryId: 'fac-B', limit: 25 });
    });
  });

  describe('successful empty vs. request error', () => {
    it('a genuinely empty [] response shows the legitimate empty state', async () => {
      await renderPage('SENIOR_MANAGEMENT', '/fulfillment/factory-dispatches?factoryId=fac-A', async (url) => {
        if (url === '/factory-dispatches/factory-options') return { data: { data: [factoryOption({ id: 'fac-A' })] } };
        if (url === '/factory-dispatches/packing-queue') return queueApiResponse([]);
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Nothing to pack');
      expect(content()).toContain('No Factory Dispatches yet');
    });

    it('queueQuery rejecting shows ErrorState, never "Nothing to pack", and hides the PDF action', async () => {
      await renderPage('SENIOR_MANAGEMENT', '/fulfillment/factory-dispatches?factoryId=fac-A', async (url) => {
        if (url === '/factory-dispatches/factory-options') return { data: { data: [factoryOption({ id: 'fac-A' })] } };
        if (url === '/factory-dispatches/packing-queue') throw new Error('boom');
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Unable to load the packing queue');
      expect(content()).not.toContain('Nothing to pack');
      expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Download'))).toBe(false);
    });

    it('dispatchesQuery rejecting shows its own ErrorState, never "No Factory Dispatches yet"', async () => {
      await renderPage('SENIOR_MANAGEMENT', '/fulfillment/factory-dispatches?factoryId=fac-A', async (url) => {
        if (url === '/factory-dispatches/factory-options') return { data: { data: [factoryOption({ id: 'fac-A' })] } };
        if (url === '/factory-dispatches/packing-queue') return queueApiResponse([]);
        if (url === '/factory-dispatches') throw new Error('boom');
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Unable to load Factory Dispatches');
      expect(content()).not.toContain('No Factory Dispatches yet');
      // The queue panel's own legitimate empty state is unaffected by the
      // sibling panel's error.
      expect(content()).toContain('Nothing to pack');
    });

    it('factoryOptionsQuery rejecting shows "Unable to load Factories" and issues no queue/list request', async () => {
      const getSpy = await renderPage('ADMIN', '/fulfillment/factory-dispatches', async (url) => {
        if (url === '/factory-dispatches/factory-options') throw new Error('boom');
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Unable to load Factories');
      expect(calledUrls(getSpy)).not.toContain('/factory-dispatches/packing-queue');
      expect(calledUrls(getSpy)).not.toContain('/factory-dispatches');
    });
  });

  describe('stale/unknown Factory in the URL', () => {
    it('shows an invalid-context message and issues no queue/list request', async () => {
      const getSpy = await renderPage('ADMIN', '/fulfillment/factory-dispatches?factoryId=unknown-factory', async (url) => {
        if (url === '/factory-dispatches/factory-options') return { data: { data: [factoryOption({ id: 'fac-A' })] } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Select a valid Factory');
      expect(content()).not.toContain('Nothing to pack');
      expect(content()).not.toContain('No Factory Dispatches yet');
      expect(calledUrls(getSpy)).not.toContain('/factory-dispatches/packing-queue');
      expect(calledUrls(getSpy)).not.toContain('/factory-dispatches');
    });
  });

  describe('inactive Factory', () => {
    it('is labelled "(inactive)", remains selectable, and its id is what the selector currently holds', async () => {
      await renderPage('ADMIN', '/fulfillment/factory-dispatches?factoryId=fac-inactive', async (url) => {
        if (url === '/factory-dispatches/factory-options') {
          return {
            data: {
              data: [
                factoryOption({ id: 'fac-active', code: 'FAC-001', name: 'Chennai Factory', status: 'ACTIVE' }),
                factoryOption({ id: 'fac-inactive', code: 'FAC-004', name: 'Legacy Factory', status: 'INACTIVE' }),
              ],
            },
          };
        }
        if (url === '/factory-dispatches/packing-queue') return queueApiResponse([]);
        if (url === '/factory-dispatches') return { data: { data: { items: [dispatchSummary()], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('FAC-004 — Legacy Factory (inactive)');
      // Selecting it did not degrade into the "no selection" or "invalid"
      // states — the valid-context panels (with real, not stale, data) render.
      expect(content()).toContain('EIFD/26-27/0001');
    });
  });

  describe('PAG-P1-05 pagination in Awaiting Packing', () => {
    it('renders Load more button when queue hasMore is true and appends next page', async () => {
      const line1 = queueLine({ saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001' });
      const line2 = queueLine({ saleOrderLineId: 'line-2', styleId: 'style-2', styleNumber: 'ST-002', sizeId: 'size-2', sizeCode: 'L', sizeLabel: 'Large' });

      await renderPage('FACTORY_USER', '/fulfillment/factory-dispatches', async (url, config) => {
        if (url === '/factory-dispatches/packing-queue') {
          const cursor = config?.params?.cursor;
          if (!cursor) {
            return queueApiResponse([line1], { limit: 25, hasMore: true, nextCursor: 'cursor-token' });
          }
          return queueApiResponse([line2], { limit: 25, hasMore: false, nextCursor: null });
        }
        if (url === '/factory-dispatches') {
          return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        }
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('ST-001');
      expect(content()).toContain('Load more');

      const loadMoreButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Load more'));
      expect(loadMoreButton).toBeDefined();

      act(() => {
        loadMoreButton?.click();
      });
      await flush();
      await flush();

      expect(content()).toContain('ST-001');
      expect(content()).toContain('ST-002');
      expect(content()).toContain('Showing 2 lines (all loaded)');
    });
  });

  // ISS-023 Phase 2: the queue groups into one Style x Size section per
  // (Dispatch Order, Distributor) instead of one flat row per line.
  describe('ISS-023 Phase 2 — Style x Size sections in Awaiting Packing', () => {
    it('groups multiple Sizes of the same Style into one row per section, and keeps two different Dispatch Order/Distributor combinations in separate sections', async () => {
      const lineA1 = queueLine({ saleOrderLineId: 'line-a1', saleOrderId: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' }, styleId: 'style-1', styleNumber: 'ST-001', sizeId: 'size-1', sizeCode: 'S', allocatedQuantity: 10, packedQuantity: 4, remainingQuantity: 6 });
      const lineA2 = queueLine({ saleOrderLineId: 'line-a2', saleOrderId: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' }, styleId: 'style-1', styleNumber: 'ST-001', sizeId: 'size-2', sizeCode: 'M', allocatedQuantity: 8, packedQuantity: 8, remainingQuantity: 0 });
      const lineB = queueLine({ saleOrderLineId: 'line-b', saleOrderId: 'so-2', saleOrderNumber: 'EISO/26-27/0002', distributor: { id: 'dist-2', code: 'D2', name: 'Distributor Two' }, styleId: 'style-2', styleNumber: 'ST-002', sizeId: 'size-3', sizeCode: 'L', allocatedQuantity: 5, packedQuantity: 5, remainingQuantity: 0 });

      await renderPage('FACTORY_USER', '/fulfillment/factory-dispatches', async (url) => {
        if (url === '/factory-dispatches/packing-queue') return queueApiResponse([lineA1, lineA2, lineB]);
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      // Two section headings, one per (Dispatch Order, Distributor).
      expect(content()).toContain('EISO/26-27/0001 — Distributor One');
      expect(content()).toContain('EISO/26-27/0002 — Distributor Two');
      // ST-001 appears once per matrix within its own section (Required/Packed/Remaining), never once per Size.
      const styleOneCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
      expect(styleOneCells).toHaveLength(3);
      // Required total for section A (10+8=18) and Remaining total (6+0=6) both reconcile to the source lines.
      expect(content()).toContain('18');
      expect(content()).toContain('6');
    });

    it('navigates to the Packing List for a section when its heading is clicked, not per individual row', async () => {
      mockAuth('FACTORY_USER');
      vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
        if (url === '/factory-dispatches/packing-queue') return queueApiResponse([queueLine({ saleOrderId: 'so-9' })]);
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      act(() => {
        root.render(
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <MemoryRouter initialEntries={['/fulfillment/factory-dispatches']}>
              <Routes>
                <Route path="/fulfillment/factory-dispatches" element={<FactoryPackingQueuePage />} />
                <Route path="/sale-orders/:id/packing-list" element={<div>Packing List Page for so-9</div>} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      await flush();
      await flush();

      const sectionLink = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('EISO/26-27/0001 — Distributor One'),
      );
      expect(sectionLink).toBeDefined();
      act(() => sectionLink?.click());
      await flush();
      expect(content()).toContain('Packing List Page for so-9');
    });

    it('warns that totals are loaded-lines-only while more pages remain, and the warning clears once everything is loaded', async () => {
      const lineA1 = queueLine({ saleOrderLineId: 'line-a1', saleOrderId: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' }, styleId: 'style-1', styleNumber: 'ST-001', sizeId: 'size-1', sizeCode: 'S', allocatedQuantity: 10, packedQuantity: 4, remainingQuantity: 6 });

      await renderPage('FACTORY_USER', '/fulfillment/factory-dispatches', async (url, config) => {
        if (url === '/factory-dispatches/packing-queue') {
          if (!config?.params?.cursor) return queueApiResponse([lineA1], { limit: 25, hasMore: true, nextCursor: 'cursor-token' });
          return queueApiResponse([], { limit: 25, hasMore: false, nextCursor: null });
        }
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('loaded so far');
      expect(content()).toContain('Load more');

      const loadMoreButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Load more'));
      act(() => loadMoreButton?.click());
      await flush();
      await flush();

      expect(content()).not.toContain('loaded so far');
    });

    it('updates a section\'s totals correctly when its own lines continue onto the next page', async () => {
      const lineA1 = queueLine({ saleOrderLineId: 'line-a1', saleOrderId: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' }, styleId: 'style-1', styleNumber: 'ST-001', sizeId: 'size-1', sizeCode: 'S', allocatedQuantity: 10, packedQuantity: 4, remainingQuantity: 6 });
      const lineA2 = queueLine({ saleOrderLineId: 'line-a2', saleOrderId: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' }, styleId: 'style-1', styleNumber: 'ST-001', sizeId: 'size-2', sizeCode: 'M', allocatedQuantity: 8, packedQuantity: 8, remainingQuantity: 0 });

      await renderPage('FACTORY_USER', '/fulfillment/factory-dispatches', async (url, config) => {
        if (url === '/factory-dispatches/packing-queue') {
          if (!config?.params?.cursor) return queueApiResponse([lineA1], { limit: 25, hasMore: true, nextCursor: 'cursor-token' });
          return queueApiResponse([lineA2], { limit: 25, hasMore: false, nextCursor: null });
        }
        if (url === '/factory-dispatches') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      // Page 1 alone: only the Small line is loaded, Required total is 10 (not yet 18).
      expect(content()).toContain('EISO/26-27/0001 — Distributor One');
      expect(content()).toContain('loaded so far');
      const styleCellsBeforeLoadMore = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
      // One row (Small only) per matrix — Required/Packed/Remaining.
      expect(styleCellsBeforeLoadMore).toHaveLength(3);

      const loadMoreButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Load more'));
      act(() => loadMoreButton?.click());
      await flush();
      await flush();

      // Still one section (same Dispatch Order/Distributor), but its own Style row now carries both
      // Sizes and the Required total updates from 10 to 18 (10+8) — the page-2 line merged in, not
      // treated as a second, separate section.
      const sectionHeadings = Array.from(container.querySelectorAll('button')).filter((b) =>
        b.textContent?.includes('EISO/26-27/0001 — Distributor One'),
      );
      expect(sectionHeadings).toHaveLength(1);
      expect(content()).toContain('18');
      expect(content()).not.toContain('loaded so far');
    });
  });
});
