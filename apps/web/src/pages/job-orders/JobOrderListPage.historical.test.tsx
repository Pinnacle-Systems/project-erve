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

// recordOrigin=HISTORICAL_IMPORT rows carry a raw PENDING confirmation and a
// 0 prepared total only as placeholders — neither was ever recorded — so the
// list must say "Not recorded", while live rows keep their exact behaviour.

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

function jobOrder(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    jobOrderNumber: id.toUpperCase(),
    financialYear: { id: 'fy-1', code: '2026-27' },
    factory: { name: 'Green Way' },
    processFlowVersion: { versionNumber: 3, processFlow: { name: 'Erve Production + Quality' } },
    sourceOrderSheetCount: 0,
    orderedQuantityTotal: 1008,
    createdAt: '2026-09-24T00:00:00.000Z',
    historicalImport: null,
    operationalState: { primaryDisplayState: { label: 'Sewing In Progress', tone: 'info' } },
    ...overrides,
  };
}

const items = [
  jobOrder('hist-aw25', {
    status: 'PRODUCTION_COMPLETE',
    factoryConfirmationStatus: 'PENDING',
    preparedQuantityTotal: 0,
    historicalImport: { legacyReferenceNumber: 'EI25018', historicalBusinessDate: '2025-08-15', importedAt: '2026-09-24T00:00:00Z' },
    operationalState: { primaryDisplayState: { label: 'Production Complete', tone: 'success' } },
  }),
  jobOrder('live-unconfirmed', { status: 'SENT_TO_FACTORY', factoryConfirmationStatus: 'PENDING', preparedQuantityTotal: 0 }),
  jobOrder('live-confirmed-zero', { status: 'IN_PRODUCTION', factoryConfirmationStatus: 'CONFIRMED', preparedQuantityTotal: 0 }),
  jobOrder('live-confirmed-prepared', { status: 'IN_PRODUCTION', factoryConfirmationStatus: 'CONFIRMED', preparedQuantityTotal: 1008 }),
];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/job-orders/factory-options') return { data: { data: [] } };
    if (url.includes('/financial-years')) return { data: { data: [] } };
    return { data: { data: { items, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
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

async function renderList() {
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
  await vi.waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(items.length));
}

function cells(jobOrderNumber: string): Record<string, string> {
  const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
  const row = Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(jobOrderNumber))!;
  const values = Array.from(row.querySelectorAll('td')).map((td) => td.textContent ?? '');
  return Object.fromEntries(headers.map((header, i) => [header, values[i]!]));
}

describe('JobOrderListPage historical presentation', () => {
  it('shows Not recorded for a historical row\'s Confirmation and Prepared, keeping Production Complete and Ordered', async () => {
    await renderList();
    const row = cells('HIST-AW25');
    expect(row['Confirmation']).toBe('Not recorded');
    expect(row['Prepared']).toBe('Not recorded');
    expect(row['Current State']).toBe('Production Complete');
    expect(row['Ordered']).toBe((1008).toLocaleString());
    expect(row['Confirmation']).not.toBe('Pending');
    expect(row['Prepared']).not.toBe('0');
  });

  it('keeps live workflow Confirmation exactly as before: Pending when unconfirmed, Confirmed when confirmed', async () => {
    await renderList();
    expect(cells('LIVE-UNCONFIRMED')['Confirmation']).toBe('Pending');
    expect(cells('LIVE-CONFIRMED-ZERO')['Confirmation']).toBe('Confirmed');
  });

  it('keeps a live recorded prepared 0 as 0 and formats a live prepared quantity numerically', async () => {
    await renderList();
    expect(cells('LIVE-UNCONFIRMED')['Prepared']).toBe('0');
    expect(cells('LIVE-CONFIRMED-ZERO')['Prepared']).toBe('0');
    expect(cells('LIVE-CONFIRMED-PREPARED')['Prepared']).toBe((1008).toLocaleString());
  });

  it('offers no factory-confirmation action on the list', async () => {
    await renderList();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(buttons.some((text) => /confirm/i.test(text))).toBe(false);
  });
});
