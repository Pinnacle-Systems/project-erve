/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { AxiosError } from 'axios';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { SaleOrReturnPositionListPage } from './SaleOrReturnPositionListPage.js';
import type { SaleOrReturnPositionRow } from './types.js';

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

function distributorOption(overrides: Partial<{ id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE' }> = {}) {
  return { id: 'dist-A', code: 'DIST-A', name: 'Distributor A', status: 'ACTIVE' as const, ...overrides };
}

function positionRow(overrides: Partial<SaleOrReturnPositionRow> = {}): SaleOrReturnPositionRow {
  return {
    erveDispatchId: 'ed-1',
    erveDispatchNumber: 'EIED/26-27/0001',
    dispatchDate: '2026-08-01T00:00:00.000Z',
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributor: { id: 'dist-A', code: 'DIST-A', name: 'Distributor A' },
    saleOrderLineId: 'line-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    dispatchedQuantity: 100,
    receivedQuantity: 100,
    actualSoldQuantity: 0,
    returnedQuantity: 0,
    approvedAwaitingReceiptQuantity: 0,
    pendingRequestedQuantity: 0,
    remainingWithDistributor: 100,
    returnableQuantity: 100,
    ...overrides,
  };
}

// Mirrors GET /distributors/options(/:id): the by-id hydration returns the
// Distributor in any status or 404s; the search returns name/code matches.
function distributorGet(url: string, options: Array<ReturnType<typeof distributorOption>>) {
  const byId = url.match(/^\/distributors\/options\/(.+)$/);
  if (byId) {
    const found = options.find((option) => option.id === decodeURIComponent(byId[1]!));
    if (found) return Promise.resolve({ data: { data: found } });
    return Promise.reject(
      new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 404,
        statusText: 'Not Found',
        data: { error: { message: 'Distributor not found' } },
        headers: {},
        config: {} as never,
      }),
    );
  }
  if (url === '/distributors/options') return Promise.resolve({ data: { data: options } });
  return Promise.reject(new Error(`Unexpected GET: ${url}`));
}

type GetImpl = (url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: { data: unknown } }>;

async function renderPage(role: Role, initialUrl: string, getImpl: GetImpl, postImpl?: (url: string, body: unknown) => Promise<{ data: { data: unknown } }>) {
  mockAuth(role);
  const getSpy = vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);
  const postSpy = vi.spyOn(apiClient, 'post').mockImplementation((postImpl ?? (async () => ({ data: { data: {} } }))) as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/fulfillment/sale-or-return" element={<SaleOrReturnPositionListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  await flush();
  return { getSpy, postSpy };
}

function calledUrls(getSpy: { mock: { calls: unknown[][] } }): string[] {
  return getSpy.mock.calls.map((call) => call[0] as string);
}

describe('SaleOrReturnPositionListPage — UXAUTH-016', () => {
  describe('DISTRIBUTOR (no selector, already server-scoped)', () => {
    it('never renders a Distributor selector and requests carry no distributorId', async () => {
      const { getSpy } = await renderPage('DISTRIBUTOR', '/fulfillment/sale-or-return', async (url) => {
        if (url === '/sale-or-return-positions') return { data: { data: { items: [positionRow()] } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).not.toContain('Select a Distributor');
      expect(calledUrls(getSpy)).not.toContain('/distributors');
      const positionsCall = getSpy.mock.calls.find((c) => c[0] === '/sale-or-return-positions')!;
      expect((positionsCall[1] as { params?: Record<string, unknown> } | undefined)?.params).toBeUndefined();
      expect(content()).toContain('ST-001');
    });

    it("submits using the single Distributor uniquely represented by the returned rows, never trusting row order", async () => {
      const { postSpy } = await renderPage(
        'DISTRIBUTOR',
        '/fulfillment/sale-or-return',
        async (url) => {
          if (url === '/sale-or-return-positions') return { data: { data: { items: [positionRow()] } } };
          throw new Error(`Unexpected GET: ${url}`);
        },
        async () => ({ data: { data: { id: 'report-1' } } }),
      );

      const qtyInput = Array.from(container.querySelectorAll('input[type="number"]'))[0] as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        nativeSetter.call(qtyInput, '10');
        qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();

      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      act(() => {
        nativeSetter.call(dateInput, '2026-09-01');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();

      const submitButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Submit ('))!;
      act(() => {
        submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();

      const submitCall = postSpy.mock.calls.find((c) => c[0] === '/distributor-sales-reports')!;
      expect((submitCall[1] as { distributorId: string }).distributorId).toBe('dist-A');
    });
  });

  describe('broad readers without submit capability (MERCHANDISER/SENIOR_MANAGEMENT/ACCOUNTANT) — unfiltered browsing unchanged', () => {
    it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'] as const)(
      '%s never sees the selector and the full multi-Distributor list renders',
      async (role) => {
        const { getSpy } = await renderPage(role, '/fulfillment/sale-or-return', async (url) => {
          if (url === '/sale-or-return-positions') {
            return {
              data: {
                data: {
                  items: [
                    positionRow({ erveDispatchId: 'ed-A', saleOrderLineId: 'line-A', distributor: { id: 'dist-A', code: 'DIST-A', name: 'Distributor A' } }),
                    positionRow({ erveDispatchId: 'ed-B', saleOrderLineId: 'line-B', distributor: { id: 'dist-B', code: 'DIST-B', name: 'Distributor B' }, styleNumber: 'ST-002' }),
                  ],
                },
              },
            };
          }
          throw new Error(`Unexpected GET: ${url}`);
        });

        expect(content()).not.toContain('Select a Distributor');
        expect(calledUrls(getSpy)).not.toContain('/distributors');
        expect(content()).toContain('Distributor A');
        expect(content()).toContain('Distributor B');
        // No submission capability at all for these roles.
        expect(content()).not.toContain('Report Sold Qty');
        expect(content()).not.toContain('Return Goods Qty');
      },
    );
  });

  describe('ADMIN — context required', () => {
    it('shows the selector and a context prompt, and issues no positions request before choosing', async () => {
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Select a Distributor to view Sale or Return positions');
      expect(content()).not.toContain('No Sale-or-Return stock');
      expect(calledUrls(getSpy)).not.toContain('/sale-or-return-positions');
    });

    it('the URL Distributor failing to load shows "Unable to load Distributor" and issues no positions request', async () => {
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url) => {
        if (url.startsWith('/distributors')) throw new Error('boom');
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Unable to load Distributor');
      expect(calledUrls(getSpy)).not.toContain('/sale-or-return-positions');
    });

    it('an unknown/stale distributorId in the URL shows an invalid-context message and issues no positions request', async () => {
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=unknown-dist', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Select a valid Distributor');
      expect(content()).not.toContain('No Sale-or-Return stock');
      expect(calledUrls(getSpy)).not.toContain('/sale-or-return-positions');
    });
  });

  describe('ADMIN — Distributor lookup (P1L7)', () => {
    it('an INACTIVE Distributor in the URL is treated as stale, as before', async () => {
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption({ status: 'INACTIVE' })]);
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Select a valid Distributor');
      expect(calledUrls(getSpy)).not.toContain('/sale-or-return-positions');
    });

    it('resolves the URL Distributor by id and never downloads the Distributor master', async () => {
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
        if (url === '/sale-or-return-positions') return { data: { data: { items: [positionRow()] } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(calledUrls(getSpy)).toContain('/distributors/options/dist-A');
      expect(calledUrls(getSpy)).not.toContain('/distributors');
      expect((document.getElementById('lookup-distributor') as HTMLInputElement).value).toBe('Distributor A');
    });

    it('choosing a Distributor from the lookup puts it in context and loads its positions', async () => {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
      const options = [distributorOption(), distributorOption({ id: 'dist-B', code: 'DIST-B', name: 'Distributor B' })];
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return', async (url, config) => {
        if (url.startsWith('/distributors')) return distributorGet(url, options);
        if (url === '/sale-or-return-positions') {
          return config?.params?.distributorId === 'dist-B'
            ? { data: { data: { items: [positionRow({ styleNumber: 'B-STYLE', distributor: { id: 'dist-B', code: 'DIST-B', name: 'Distributor B' } })] } } }
            : { data: { data: { items: [] } } };
        }
        throw new Error(`Unexpected GET: ${url}`);
      });

      const input = document.getElementById('lookup-distributor') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        input.focus();
        setter.call(input, 'dist');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      for (let i = 0; i < 100 && !document.body.querySelector('[role="option"]'); i += 1) await flush();
      const optionB = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((option) =>
        option.textContent?.includes('Distributor B'),
      )!;
      await act(async () => optionB.click());
      await flush();
      await flush();

      expect(content()).toContain('B-STYLE');
      const positionsCall = getSpy.mock.calls.find((c) => c[0] === '/sale-or-return-positions')!;
      expect((positionsCall[1] as { params?: Record<string, unknown> }).params).toEqual({ distributorId: 'dist-B' });
      // The picked option seeds the by-id cache: no re-fetch, no master download.
      expect(calledUrls(getSpy)).not.toContain('/distributors/options/dist-B');
      expect(calledUrls(getSpy)).not.toContain('/distributors');
    });
  });

  describe('ADMIN — Distributor A selected', () => {
    it('requests carry distributorId=A and A rows render', async () => {
      const { getSpy } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
        if (url === '/sale-or-return-positions') return { data: { data: { items: [positionRow({ styleNumber: 'A-STYLE' })] } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('A-STYLE');
      const positionsCall = getSpy.mock.calls.find((c) => c[0] === '/sale-or-return-positions')!;
      expect((positionsCall[1] as { params?: Record<string, unknown> }).params).toEqual({ distributorId: 'dist-A' });
    });

    it('Sales Report submission payload carries distributorId=A and only A lines, never row order', async () => {
      const { postSpy } = await renderPage(
        'ADMIN',
        '/fulfillment/sale-or-return?distributorId=dist-A',
        async (url) => {
          if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
          if (url === '/sale-or-return-positions') return { data: { data: { items: [positionRow({ styleNumber: 'A-STYLE' })] } } };
          throw new Error(`Unexpected GET: ${url}`);
        },
        async () => ({ data: { data: { id: 'report-1' } } }),
      );

      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const qtyInput = Array.from(container.querySelectorAll('input[type="number"]'))[0] as HTMLInputElement;
      act(() => {
        nativeSetter.call(qtyInput, '10');
        qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      act(() => {
        nativeSetter.call(dateInput, '2026-09-01');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();

      const submitButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Submit ('))!;
      act(() => {
        submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();

      const submitCall = postSpy.mock.calls.find((c) => c[0] === '/distributor-sales-reports')!;
      const body = submitCall[1] as { distributorId: string; lines: Array<{ erveDispatchId: string }> };
      expect(body.distributorId).toBe('dist-A');
      expect(body.lines).toHaveLength(1);
    });

    it('Return submission payload carries distributorId=A and only A lines', async () => {
      const { postSpy } = await renderPage(
        'ADMIN',
        '/fulfillment/sale-or-return?distributorId=dist-A',
        async (url) => {
          if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
          if (url === '/sale-or-return-positions') return { data: { data: { items: [positionRow({ styleNumber: 'A-STYLE' })] } } };
          throw new Error(`Unexpected GET: ${url}`);
        },
        async () => ({ data: { data: { id: 'return-1' } } }),
      );

      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const returnQtyInput = Array.from(container.querySelectorAll('input[type="number"]'))[1] as HTMLInputElement;
      act(() => {
        nativeSetter.call(returnQtyInput, '5');
        returnQtyInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      act(() => {
        nativeSetter.call(dateInput, '2026-09-01');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // Return Reason renders through the shared TextField without an
      // explicit `type` prop, so it has no `type` attribute to select on —
      // its placeholder is the stable hook instead.
      const reasonInput = Array.from(container.querySelectorAll('input')).find((el) =>
        el.placeholder?.includes('End of season'),
      ) as HTMLInputElement;
      act(() => {
        nativeSetter.call(reasonInput, 'End of season');
        reasonInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();

      const submitButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Submit Return ('))!;
      act(() => {
        submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();

      const submitCall = postSpy.mock.calls.find((c) => c[0] === '/distributor-returns')!;
      const body = submitCall[1] as { distributorId: string; lines: Array<{ erveDispatchId: string }> };
      expect(body.distributorId).toBe('dist-A');
      expect(body.lines).toHaveLength(1);
    });
  });

  describe('ADMIN — switching Distributor A -> Distributor B', () => {
    it('uses a different query key/request and never shows Distributor A rows as Distributor B data', async () => {
      const options = [distributorOption({ id: 'dist-A', code: 'DIST-A' }), distributorOption({ id: 'dist-B', code: 'DIST-B' })];

      const { getSpy: getSpyA } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url, config) => {
        if (url.startsWith('/distributors')) return distributorGet(url, options);
        if (url === '/sale-or-return-positions') {
          const distributorId = config?.params?.distributorId;
          return { data: { data: { items: distributorId === 'dist-A' ? [positionRow({ styleNumber: 'A-STYLE' })] : [] } } };
        }
        throw new Error(`Unexpected GET: ${url}`);
      });
      expect(content()).toContain('A-STYLE');
      getSpyA.mockClear();

      act(() => root.unmount());
      container.innerHTML = '';
      root = createRoot(container);
      const { getSpy: getSpyB } = await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-B', async (url, config) => {
        if (url.startsWith('/distributors')) return distributorGet(url, options);
        if (url === '/sale-or-return-positions') {
          const distributorId = config?.params?.distributorId;
          return { data: { data: { items: distributorId === 'dist-B' ? [positionRow({ styleNumber: 'B-STYLE', distributor: { id: 'dist-B', code: 'DIST-B', name: 'Distributor B' } })] : [] } } };
        }
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('B-STYLE');
      expect(content()).not.toContain('A-STYLE');
      const positionsCallB = getSpyB.mock.calls.find((c) => c[0] === '/sale-or-return-positions')!;
      expect((positionsCallB[1] as { params?: Record<string, unknown> }).params).toEqual({ distributorId: 'dist-B' });
    });
  });

  describe('ADMIN — successful empty vs. request error', () => {
    it('a genuinely empty [] response shows the legitimate empty state', async () => {
      await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
        if (url === '/sale-or-return-positions') return { data: { data: { items: [] } } };
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('No Sale-or-Return stock');
    });

    it('positions query rejecting shows ErrorState, never the legitimate empty state', async () => {
      await renderPage('ADMIN', '/fulfillment/sale-or-return?distributorId=dist-A', async (url) => {
        if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption()]);
        if (url === '/sale-or-return-positions') throw new Error('boom');
        throw new Error(`Unexpected GET: ${url}`);
      });

      expect(content()).toContain('Unable to load Sale-or-Return positions');
      expect(content()).not.toContain('No Sale-or-Return stock');
    });
  });

  describe('ADMIN — defensive client-coherence check (regression for the original rows[0] bug)', () => {
    it('blocks submission client-side, without sending a request, if returned rows are not all the selected Distributor', async () => {
      // Simulates a hypothetical server-side scoping regression: distributorId=B was
      // requested, but the (misbehaving) server response mixes in an A row too —
      // proving the fix no longer trusts "whichever row is first" the way the
      // original rows[0]?.distributor.id bug did.
      const { postSpy } = await renderPage(
        'ADMIN',
        '/fulfillment/sale-or-return?distributorId=dist-B',
        async (url) => {
          if (url.startsWith('/distributors')) return distributorGet(url, [distributorOption({ id: 'dist-A' }), distributorOption({ id: 'dist-B', code: 'DIST-B' })]);
          if (url === '/sale-or-return-positions') {
            return {
              data: {
                data: {
                  items: [
                    positionRow({ erveDispatchId: 'ed-A', saleOrderLineId: 'line-A', distributor: { id: 'dist-A', code: 'DIST-A', name: 'Distributor A' } }),
                    positionRow({ erveDispatchId: 'ed-B', saleOrderLineId: 'line-B', distributor: { id: 'dist-B', code: 'DIST-B', name: 'Distributor B' }, styleNumber: 'B-STYLE' }),
                  ],
                },
              },
            };
          }
          throw new Error(`Unexpected GET: ${url}`);
        },
        async () => ({ data: { data: { id: 'report-1' } } }),
      );

      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const qtyInputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
      // Enter a quantity against BOTH the A row and the B row's "report" input
      // (columns alternate report/return per row — the first two number inputs
      // belong to the first row's report+return cells; enter on both rows'
      // report cell instead, i.e. inputs at index 0 and 2).
      const rowAReportInput = qtyInputs[0]!;
      const rowBReportInput = qtyInputs[2]!;
      act(() => {
        nativeSetter.call(rowAReportInput, '10');
        rowAReportInput.dispatchEvent(new Event('input', { bubbles: true }));
        nativeSetter.call(rowBReportInput, '5');
        rowBReportInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      act(() => {
        nativeSetter.call(dateInput, '2026-09-01');
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();

      const submitButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Submit ('))!;
      act(() => {
        submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();

      expect(postSpy.mock.calls.find((c) => c[0] === '/distributor-sales-reports')).toBeUndefined();
      expect(content()).toContain('single Distributor');
    });
  });
});
