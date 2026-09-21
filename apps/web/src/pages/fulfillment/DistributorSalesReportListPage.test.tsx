/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { DistributorSalesReportListPage } from './DistributorSalesReportListPage.js';

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

function renderPage() {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/distributor-sales-reports']}>
          <Routes>
            <Route path="/fulfillment/distributor-sales-reports" element={<DistributorSalesReportListPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('DistributorSalesReportListPage — request failure handling (UXAUTH-018)', () => {
  it('shows a visible error, not a silent empty list, when the request fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Network Error'));

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading sales reports'));

    expect(content()).not.toContain('No sales reports yet');
    expect(content()).toContain('Unable to load sales reports');
    expect(content()).toContain('Network Error');
  });

  it('renders an empty-list state (not an error) when the request succeeds with zero records', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading sales reports'));

    expect(content()).toContain('No sales reports yet');
    expect(content()).not.toContain('Unable to load sales reports');
  });
});
