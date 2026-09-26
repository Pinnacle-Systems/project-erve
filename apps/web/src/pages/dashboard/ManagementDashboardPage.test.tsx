/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, ReportOperationsSummary } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ManagementDashboardPage } from './ManagementDashboardPage.js';

let container: HTMLDivElement;
let root: Root;

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

function mockUser(): AuthUser {
  return { id: 'u1', email: 'admin@test.local', mobile: null, name: 'Admin', roles: ['ADMIN'] };
}

function fullSummary(): ReportOperationsSummary {
  return {
    generatedAt: '2026-09-26T00:00:00.000Z',
    businessDate: '2026-09-26',
    filtersApplied: {},
    sectionsOmitted: [],
    production: { openByStatus: { IN_PRODUCTION: 3, DRAFT: 1 }, openTotal: 4, delayed: 2 },
    qa: {
      workByStatus: { AVAILABLE: 5, IN_PROGRESS: 1, COMPLETED: 10, FAILED: 0, MISSED: 0 },
      reconciliationConflicts: 1,
      availableStockPieces: 120,
    },
    packing: {
      piecesAwaitingPacking: 40,
      packingListsAwaitingCompletion: 2,
      cartonsNeverAudited: 3,
      cartonsNeedingReinspection: 1,
    },
    delivery: { awaitingConfirmation: 6 },
    saleReturn: { remainingWithDistributors: 250 },
  };
}

// Empty-but-correctly-shaped responses for the chart-data endpoints
// ChartsSection also requests, so a test that only cares about the KPI
// cards/summary doesn't have to know Chart's own response shapes.
function defaultOtherResponse(url: string): unknown {
  if (url === '/reports/production') {
    return { filtersApplied: {}, pipeline: [], factoryWorkload: [], quantityFlow: [] };
  }
  if (url === '/reports/fulfillment') {
    return {
      filtersApplied: {},
      factoryDispatch: {},
      packingAudit: { neverAudited: 0, needingReinspection: 0, currentlyPassed: 0 },
      factoryInvoice: {},
      ervePackingList: {},
      erveDispatch: {},
      delivery: { userConfirmed: 0, legacyAssumedFullReceipt: 0 },
    };
  }
  if (url === '/reports/sale-or-return' || url === '/reports/distributor-returns') {
    return { filtersApplied: {}, rows: [] };
  }
  return [];
}

async function render(mockGet: (url: string) => unknown) {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: mockUser(),
    token: 't',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => ({ data: { data: mockGet(url) } }));

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ManagementDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('ManagementDashboardPage (RPT2)', () => {
  it('shows every KPI card with correct labels and factual values when every section is present', async () => {
    await render((url) => {
      if (url === '/reports/operations/summary') return fullSummary();
      return defaultOtherResponse(url);
    });

    expect(container.textContent).toContain('Open Job Orders');
    expect(container.textContent).toContain('Delayed Job Orders');
    expect(container.textContent).toContain('QA-Passed Available Stock');
    expect(container.textContent).toContain('Packing Pending');
    expect(container.textContent).toContain('Cartons Awaiting Audit');
    expect(container.textContent).toContain('Awaiting Delivery Confirmation');
    expect(container.textContent).toContain('Sale-or-Return Remaining with Distributors');
    expect(container.textContent).toContain('QA Work Status');
    // The exact spec-mandated label — never "To Be Delivered".
    expect(container.textContent).not.toContain('To Be Delivered');
    // Never a synthetic "sales pending"/"overdue sales" label.
    expect(container.textContent).not.toContain('pending');
    expect(container.textContent).not.toContain('overdue');
    // No percentages/conversion rates anywhere on the dashboard.
    expect(container.textContent).not.toMatch(/%/);
  });

  it('drills the Open/Delayed Job Orders cards down to the Job Orders list with the matching filter, only when the viewer can reach it', async () => {
    await render((url) => {
      if (url === '/reports/operations/summary') return fullSummary();
      return defaultOtherResponse(url);
    });
    const links = Array.from(container.querySelectorAll('a'));
    const openLink = links.find((a) => a.textContent?.includes('Open Job Orders'));
    const delayedLink = links.find((a) => a.textContent?.includes('Delayed Job Orders'));
    expect(openLink?.getAttribute('href')).toBe('/job-orders');
    expect(delayedLink?.getAttribute('href')).toBe('/job-orders?delayed=true');
  });

  it('sends recordOrigin=LIVE_WORKFLOW by default', async () => {
    const paramsSeen: Array<Record<string, unknown>> = [];
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: mockUser(),
      token: 't',
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
      isInitializing: false,
    } as unknown as ReturnType<typeof AuthContext.useAuth>);
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url: string, config?: { params?: Record<string, unknown> }) => {
        if (url === '/reports/operations/summary') {
          paramsSeen.push(config?.params ?? {});
          return { data: { data: fullSummary() } };
        }
        return { data: { data: defaultOtherResponse(url) } };
      },
    );
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <ManagementDashboardPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(paramsSeen.at(-1)).toMatchObject({ recordOrigin: 'LIVE_WORKFLOW' });
  });

  it('hides a section entirely (never renders a zero) when the API omits it for the viewer role', async () => {
    await render((url) => {
      if (url === '/reports/operations/summary') {
        const summary = fullSummary();
        return {
          ...summary,
          qa: undefined,
          packing: { piecesAwaitingPacking: undefined, packingListsAwaitingCompletion: undefined, cartonsNeverAudited: undefined, cartonsNeedingReinspection: undefined },
          sectionsOmitted: ['qa', 'packing.audit'],
        };
      }
      return defaultOtherResponse(url);
    });
    expect(container.textContent).not.toContain('QA-Passed Available Stock');
    expect(container.textContent).not.toContain('QA Work Status');
    expect(container.textContent).not.toContain('Cartons Awaiting Audit');
    expect(container.textContent).toContain('Some sections are hidden');
  });

  it('shows a page-level error state when the summary request fails', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: mockUser(),
      token: 't',
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
      isInitializing: false,
    } as unknown as ReturnType<typeof AuthContext.useAuth>);
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/reports/operations/summary') throw new Error('network down');
      return { data: { data: defaultOtherResponse(url) } };
    });
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <ManagementDashboardPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain('Unable to load the dashboard');
  });

  it('renders factual zero values plainly rather than hiding a genuinely empty section', async () => {
    await render((url) => {
      if (url === '/reports/operations/summary') {
        return {
          ...fullSummary(),
          production: { openByStatus: {}, openTotal: 0, delayed: 0 },
          delivery: { awaitingConfirmation: 0 },
        };
      }
      return defaultOtherResponse(url);
    });
    expect(container.textContent).toContain('Open Job Orders');
    expect(container.textContent).toContain('Awaiting Delivery Confirmation');
  });
});
