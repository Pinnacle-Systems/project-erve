/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { DistributorSalesReportDetailPage } from './DistributorSalesReportDetailPage.js';
import type { DistributorSalesReportView } from './types.js';

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

const content = () => container.textContent ?? '';

function buildReport(overrides: Partial<DistributorSalesReportView> = {}): DistributorSalesReportView {
  return {
    id: 'dsr-1',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    reportDate: '2026-09-01T00:00:00.000Z',
    remarks: null,
    submittedBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    submittedAt: '2026-09-01T00:00:00.000Z',
    lines: [],
    ...overrides,
  };
}

async function renderPage(getImpl: (url: string) => Promise<unknown>) {
  vi.spyOn(apiClient, 'get').mockImplementation(getImpl as never);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/distributor-sales-reports/dsr-1']}>
          <Routes>
            <Route path="/fulfillment/distributor-sales-reports/:id" element={<DistributorSalesReportDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading sales report'));
}

describe('DistributorSalesReportDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    await renderPage(async () => {
      throw new Error('Request failed with status code 403');
    });

    expect(content()).not.toContain('Sales report not found');
    expect(content()).toContain('Unable to load sales report');
    expect(content()).toContain('Request failed with status code 403');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('still renders the record normally when the request succeeds', async () => {
    const report = buildReport();
    await renderPage(async (url: string) => {
      if (url === '/distributor-sales-reports/dsr-1') return { data: { data: report } };
      throw new Error(`Unexpected GET: ${url}`);
    });

    expect(content()).toContain('Distributor One');
    expect(content()).not.toContain('Unable to load sales report');
  });
});
