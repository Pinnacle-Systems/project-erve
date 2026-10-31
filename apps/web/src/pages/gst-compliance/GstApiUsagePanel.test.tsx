/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GstApiUsageToday } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { GstApiUsagePanel } from './GstApiUsagePanel.js';

const usage = (overrides: Partial<GstApiUsageToday> = {}): GstApiUsageToday => ({
  totalCalls: 42,
  successfulCalls: 40,
  errorCalls: 2,
  creditsUsed: 40,
  fetchedAt: '2026-10-31T06:30:00.000Z',
  ...overrides,
});
let container: HTMLDivElement;
let root: Root;
let get: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
  get = vi.spyOn(apiClient, 'get');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <GstApiUsagePanel />
      </QueryClientProvider>,
    ),
  );
  await settle();
}
function refreshButton() {
  const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes('Refresh Usage'),
  );
  if (!element) throw new Error('Missing Refresh Usage');
  return element;
}
const click = () =>
  act(async () => {
    refreshButton().click();
  });
const reply = (data: GstApiUsageToday) => ({ data: { success: true, data } });
const values = () => [...container.querySelectorAll('dd')].map((node) => node.textContent);

describe('GSTINAPI usage panel', () => {
  it('renders the heading, note and Refresh button without making any request', async () => {
    await mount();
    expect(container.textContent).toContain("GSTINAPI — Today's Usage");
    expect(container.textContent).toContain('API key configured on the ERVE server');
    expect(container.textContent).toContain('Usage has not been retrieved');
    expect(refreshButton().disabled).toBe(false);
    expect(get).not.toHaveBeenCalled();
    await settle();
    expect(get).not.toHaveBeenCalled();
  });
  it('fetches once per click from the fixed route and shows all four labelled values', async () => {
    get.mockResolvedValue(reply(usage()));
    await mount();
    await click();
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/gst-compliance/usage');
    expect(values()).toEqual(['42', '40', '2', '40']);
    for (const label of ['Total Calls', 'Successful', 'Errors', 'Credits Used Today'])
      expect(container.textContent).toContain(label);
    expect(container.textContent).toContain('Retrieved on');
    expect(container.textContent).toContain(
      new Date('2026-10-31T06:30:00.000Z').toLocaleString('en-IN'),
    );
  });
  it('shows zero counters as real zeros', async () => {
    get.mockResolvedValue(
      reply(usage({ totalCalls: 0, successfulCalls: 0, errorCalls: 0, creditsUsed: 0 })),
    );
    await mount();
    await click();
    await settle();
    expect(values()).toEqual(['0', '0', '0', '0']);
  });
  it('shows loading and prevents overlapping requests from repeated clicks', async () => {
    let finish!: (value: unknown) => void;
    get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await click();
    // React Query notifies observers on a macrotask; the request stays pending, so waiting is deterministic.
    await settle();
    expect(container.textContent).toContain('Retrieving usage');
    expect(refreshButton().disabled).toBe(true);
    await click();
    await click();
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => finish(reply(usage())));
    await settle();
    expect(container.textContent).not.toContain('Retrieving usage');
    expect(refreshButton().disabled).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('replaces displayed statistics on a successful refresh', async () => {
    get.mockResolvedValueOnce(reply(usage())).mockResolvedValueOnce(
      reply(
        usage({
          totalCalls: 50,
          successfulCalls: 47,
          errorCalls: 3,
          creditsUsed: 47,
          fetchedAt: '2026-10-31T07:00:00.000Z',
        }),
      ),
    );
    await mount();
    await click();
    await settle();
    await click();
    await settle();
    expect(values()).toEqual(['50', '47', '3', '47']);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('shows a clear error on first failure without inventing zeros', async () => {
    get.mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            message:
              'API usage is unavailable. Ask your administrator to check the GSTINAPI configuration.',
          },
        },
      },
    });
    await mount();
    await click();
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'API usage is unavailable. Ask your administrator to check the GSTINAPI configuration.',
    );
    expect(container.querySelectorAll('dd')).toHaveLength(0);
    expect(container.textContent).not.toContain('Total Calls');
    expect(refreshButton().disabled).toBe(false);
  });
  it('keeps previously successful values, identified as last successful, after a failed refresh', async () => {
    get.mockResolvedValueOnce(reply(usage())).mockRejectedValueOnce(new Error('network down'));
    await mount();
    await click();
    await settle();
    await click();
    await settle();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(values()).toEqual(['42', '40', '2', '40']);
    expect(container.textContent).toContain('Last successful retrieval');
    expect(container.textContent).toContain('may be outdated');
    await click();
    expect(get).toHaveBeenCalledTimes(3);
  });
  it('never shows a balance or remaining-credit figure', async () => {
    get.mockResolvedValue(reply(usage()));
    await mount();
    await click();
    await settle();
    expect(container.textContent).not.toMatch(/balance|remaining|available credits|estimated/i);
  });
  it('does not fetch again on re-render, window focus or elapsed time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      get.mockResolvedValue(reply(usage()));
      await mount();
      await click();
      await settle();
      expect(get).toHaveBeenCalledTimes(1);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
