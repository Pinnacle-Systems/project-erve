/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { PackingAuditQueuePage } from './PackingAuditQueuePage.js';

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
        <MemoryRouter initialEntries={['/fulfillment/packing-audit']}>
          <AuthProvider>
            <Routes>
              <Route path="/fulfillment/packing-audit" element={<PackingAuditQueuePage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('ISS-024 Packing Audit cartons list density', () => {
  it('uses one table boundary, a separately spaced Cartons heading, and preserves audit states and actions', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: 'carton-1',
              saleOrder: { saleOrderNumber: 'EISO/26-27/0001' },
              factory: { name: 'Test Factory' },
              cartonNumber: 'C-001',
              totalQuantity: 60,
              auditState: 'NOT_INSPECTED',
            },
            {
              id: 'carton-2',
              saleOrder: { saleOrderNumber: 'EISO/26-27/0002' },
              factory: { name: 'Test Factory' },
              cartonNumber: 'C-002',
              totalQuantity: 120,
              auditState: 'NEEDS_REINSPECTION',
            },
          ],
          pageInfo: { limit: 100, hasMore: false, nextCursor: null },
        },
      },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).toContain('EISO/26-27/0001'));

    const section = container.querySelector('section[aria-labelledby="packing-audit-cartons-heading"]');
    expect(section).not.toBeNull();
    expect(section?.classList.contains('space-y-2')).toBe(true);
    expect(section?.querySelector('h2')?.textContent?.trim()).toBe('Cartons');
    expect(section?.querySelectorAll('table')).toHaveLength(1);
    // DataTable owns the border; no nested Panel wrapper adds another.
    expect(section?.querySelectorAll('.rounded-panel')).toHaveLength(1);
    expect(section?.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(section?.textContent).toContain('Not Inspected');
    expect(section?.textContent).toContain('Needs Reinspection');
    expect(section?.textContent).toContain('60');
    expect(section?.textContent).toContain('120');
    const quantityHeader = Array.from(section!.querySelectorAll('th')).find(
      (cell) => cell.textContent === 'Total Qty',
    );
    expect(quantityHeader?.classList.contains('text-right')).toBe(true);
    expect(content()).toContain('Download PDF');
    expect(content()).toContain('Print');
  });
});

describe('PackingAuditQueuePage — request failure handling (UXAUTH-018)', () => {
  it('shows a visible error, not a silent empty list, when the request fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Network Error'));

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading Packing Audit queue'));

    expect(content()).not.toContain('Nothing to inspect');
    expect(content()).toContain('Unable to load Packing Audit queue');
    expect(content()).toContain('Network Error');
  });

  it('renders an empty-list state (not an error) when the request succeeds with zero records', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 100, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading Packing Audit queue'));

    expect(content()).toContain('Nothing to inspect');
    expect(content()).toContain('No open cartons are currently awaiting Packing Audit.');
    expect(content()).not.toContain('Unable to load Packing Audit queue');
  });
});
