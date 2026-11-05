/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CartonDeliveryPanel } from './CartonDeliveryPanel.js';
import { apiClient } from '../../../lib/api-client.js';
vi.mock('../../../auth/AuthContext.js', () => ({
  useAuth: () => ({ user: { id: 'u1', roles: ['DISTRIBUTOR'] } }),
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CartonDeliveryPanel dispatchId="dispatch-1" />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it('shows authoritative totals independent of the current page and includes unlabelled pending cartons', async () => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (_url, options) => ({
    data: {
      data: {
        enabled: true,
        totalCartons: 12,
        confirmedCartons: 1,
        pendingCartons: 11,
        items: options?.params.cursor
          ? [{ cartonId: 'c2', cartonNumber: 'C1', labelReference: null, evidence: null }]
          : [
              {
                cartonId: 'c1',
                cartonNumber: 'C1',
                labelReference: 'REF1',
                evidence: {
                  recipientName: 'Recipient',
                  deliveredAt: '2026-11-05T07:00:00Z',
                  submittedAt: '2026-11-05T07:01:00Z',
                  timezone: 'Asia/Kolkata',
                  offsetMinutes: 330,
                  remarks: 'Received intact',
                },
              },
            ],
        pageInfo: {
          limit: 25,
          hasMore: !options?.params.cursor,
          nextCursor: options?.params.cursor ? null : 'c1',
        },
      },
    },
  }));
  await render();
  expect(document.body.textContent).toContain('QR Carton Delivery Evidence');
  expect(document.body.textContent).toContain('Total cartons: 12');
  expect(document.body.textContent).toContain('QR-confirmed cartons: 1');
  expect(document.body.textContent).toContain('Pending cartons: 11');
  expect(document.body.textContent).toContain('Recipient');
  expect(document.body.textContent).toContain('Received intact');
  await act(async () =>
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Next cartons')!
      .click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain('QR not issued');
  expect(document.body.textContent).toContain('Pending cartons: 11');
  expect(document.body.textContent).not.toContain('Manage credential');
});
it('adds no panel while the feature is disabled', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: { enabled: false } } });
  await render();
  expect(container.textContent).toBe('');
});
