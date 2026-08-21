/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { QaQueuePage } from './QaQueuePage.js';

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

describe('QA work list', () => {
  it('shows configured Quality activities without loading a separate prepared-quantity queue', async () => {
    const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/job-orders/quality-work') {
        return {
          data: {
            data: [
              {
                jobOrderId: 'job-1',
                jobOrderNumber: 'JO-001',
                purchaseOrderNumber: 'PO-001',
                factory: { id: 'factory-1', code: 'FAC', name: 'Factory One' },
                activity: {
                  processFlowVersionStageId: 'quality-1',
                  sequence: 1,
                  name: 'Inline Inspection',
                  status: 'IN_PROGRESS',
                  coverage: {
                    preparedQuantityAuthoritative: true,
                    preparedQuantity: 100,
                    inspectedQuantity: 70,
                    remainingQuantity: 30,
                    complete: false,
                    reconciliationConflict: false,
                    state: 'IN_PROGRESS',
                    passedBatches: 1,
                    failedBatches: 0,
                    hasFailedBatches: false,
                    batches: [],
                  },
                },
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter>
            <QaQueuePage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain('JO-001');
    expect(container.textContent).toContain('Inline Inspection');
    expect(container.textContent).toContain('In Progress');
    expect(container.textContent).toContain('70 / 100');
    expect(container.textContent).not.toContain('Prepared quantity QA work');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/job-orders/quality-work');
  });
});
