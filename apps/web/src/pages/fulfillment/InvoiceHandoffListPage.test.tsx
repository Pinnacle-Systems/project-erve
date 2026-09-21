/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { InvoiceHandoffListPage } from './InvoiceHandoffListPage.js';

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
        <MemoryRouter initialEntries={['/fulfillment/invoices']}>
          <AuthProvider>
            <Routes>
              <Route path="/fulfillment/invoices" element={<InvoiceHandoffListPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('InvoiceHandoffListPage — request failure handling (UXAUTH-018)', () => {
  it('shows a visible error, not a silent empty list, when the request fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Network Error'));

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading invoice handoffs'));

    expect(content()).not.toContain('Nothing here');
    expect(content()).toContain('Unable to load invoice handoffs');
    expect(content()).toContain('Network Error');
  });

  it('renders an empty-list state (not an error) when the request succeeds with zero records', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading invoice handoffs'));

    expect(content()).toContain('Nothing here');
    expect(content()).toContain('No invoice handoffs match this filter.');
    expect(content()).not.toContain('Unable to load invoice handoffs');
  });
});
