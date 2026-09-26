/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ReportDistributorReturns,
  ReportFulfillment,
  ReportProduction,
  ReportSaleOrReturn,
} from '@erve/types';
import { apiClient } from '../../../lib/api-client.js';
import ChartsSection from './ChartsSection.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

function production(): ReportProduction {
  return {
    filtersApplied: {},
    pipeline: [
      { status: 'IN_PRODUCTION', recordOrigin: 'LIVE_WORKFLOW', count: 4 },
      { status: 'IN_PRODUCTION', recordOrigin: 'HISTORICAL_IMPORT', count: 1 },
    ],
    factoryWorkload: [
      { factory: { id: 'f1', code: 'F1', name: 'Factory One' }, openJobOrders: 5, delayedJobOrders: 2 },
    ],
    quantityFlow: [
      {
        factory: { id: 'f1', code: 'F1', name: 'Factory One' },
        orderedPieces: 100,
        cancelledOrderedPieces: 20,
        preparedPieces: 60,
        qaPassedPieces: 40,
        factoryDispatchedPieces: 30,
      },
    ],
  };
}

function fulfillment(): ReportFulfillment {
  return {
    filtersApplied: {},
    factoryDispatch: { DRAFT: 2, READY_FOR_ERVE: 3 },
    packingAudit: { neverAudited: 1, needingReinspection: 2, currentlyPassed: 4 },
    factoryInvoice: { GENERATED: 1 },
    ervePackingList: { OPEN: 1 },
    erveDispatch: { DISPATCHED: 3, DELIVERED: 5 },
    delivery: { userConfirmed: 4, legacyAssumedFullReceipt: 1 },
  };
}

function saleOrReturn(): ReportSaleOrReturn {
  return {
    filtersApplied: {},
    rows: [
      {
        distributor: { id: 'd1', code: 'D1', name: 'Acme Distributor' },
        received: 100,
        sold: 40,
        returned: 10,
        approvedAwaitingReceipt: 5,
        pendingRequested: 8,
        remainingWithDistributor: 50,
        availableForNewReturn: 37,
      },
    ],
  };
}

function distributorReturns(): ReportDistributorReturns {
  return {
    filtersApplied: {},
    rows: [
      { status: 'SUBMITTED', requested: 12, approvedActive: 0, received: 0 },
      { status: 'APPROVED', requested: 5, approvedActive: 5, received: 0 },
    ],
  };
}

async function renderCharts() {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/reports/production') return { data: { data: production() } };
    if (url === '/reports/fulfillment') return { data: { data: fulfillment() } };
    if (url === '/reports/sale-or-return') return { data: { data: saleOrReturn() } };
    if (url === '/reports/distributor-returns') return { data: { data: distributorReturns() } };
    throw new Error(`Unexpected request: ${url}`);
  });
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChartsSection filters={{}} canViewProduction canViewFulfillment canViewSaleReturn />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('ChartsSection (RPT3)', () => {
  it('renders every chart panel with correct titles and no trend/percentage artifacts', async () => {
    await renderCharts();
    expect(container.textContent).toContain('Production Pipeline');
    expect(container.textContent).toContain('Factory Workload');
    expect(container.textContent).toContain('Production Quantity Flow');
    expect(container.textContent).toContain('Factory Packing');
    expect(container.textContent).toContain('Packing Audit');
    expect(container.textContent).toContain('Factory Invoice');
    expect(container.textContent).toContain('Erve Packing');
    expect(container.textContent).toContain('Erve Dispatch');
    expect(container.textContent).toContain('Delivery Source');
    expect(container.textContent).toContain('Sale-or-Return Distributor Position');
    expect(container.textContent).toContain('Distributor Return Status');
    expect(container.textContent).not.toMatch(/%/);
  });

  it('shows pending requested as a separate annotation, not stacked into the position total', async () => {
    await renderCharts();
    expect(container.textContent).toContain('Acme Distributor — pending requested');
    expect(container.textContent).toContain('8');
  });

  it('renders a factual empty state for a chart with no matching data, rather than an empty chart shell', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/reports/production')
        return { data: { data: { filtersApplied: {}, pipeline: [], factoryWorkload: [], quantityFlow: [] } } };
      if (url === '/reports/fulfillment') return { data: { data: fulfillment() } };
      if (url === '/reports/sale-or-return') return { data: { data: { filtersApplied: {}, rows: [] } } };
      if (url === '/reports/distributor-returns') return { data: { data: { filtersApplied: {}, rows: [] } } };
      throw new Error(`Unexpected request: ${url}`);
    });
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ChartsSection filters={{}} canViewProduction canViewFulfillment canViewSaleReturn />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.textContent).toContain('No Job Orders match this view.');
    expect(container.textContent).toContain('No Sale-or-Return positions match this view.');
    expect(container.textContent).toContain('No Distributor Returns match this view.');
  });

  it('shows an error state when a report request fails', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/reports/production') throw new Error('network down');
      return { data: { data: [] } };
    });
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ChartsSection filters={{}} canViewProduction canViewFulfillment={false} canViewSaleReturn={false} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(container.textContent).toContain('Unable to load charts');
  });
});
