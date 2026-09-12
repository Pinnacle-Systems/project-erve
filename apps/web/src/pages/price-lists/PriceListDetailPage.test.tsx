/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthUser, Role } from '@erve/types';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { setStoredToken } from '../../auth/token-storage.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
import { PriceListDetailPage } from './PriceListDetailPage.js';
import type { PriceList, PriceListStatus } from './types.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function buildPriceList(status: PriceListStatus): PriceList {
  return {
    id: 'pl-1',
    code: 'PL-2026-000001',
    name: 'FY 2026 Prices',
    distributor: { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status,
    lineCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: '39026006',
        styleName: 'BOYS REGULAR TSHIRT',
        styleStatus: 'ACTIVE',
        unitPrice: 249.5,
        currency: 'INR',
      },
    ],
  };
}

async function renderDetailPage(roles: Role[], priceList: PriceList): Promise<void> {
  setStoredToken('valid-token');
  const user: AuthUser = { id: 'user-1', email: 'test@test.local', mobile: null, name: 'Test User', roles };

  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/auth/me') {
      return ok(config, { success: true, data: user });
    }
    if (config.url === `/price-lists/${priceList.id}`) {
      return ok(config, { success: true, data: priceList });
    }
    if (config.url === '/styles') {
      return ok(config, {
        success: true,
        data: [
          { id: 'style-1', styleNumber: '39026006', styleName: 'BOYS REGULAR TSHIRT', status: 'ACTIVE' },
          { id: 'style-2', styleNumber: '25426015', styleName: 'GIRLS REGULAR T SHIRTS', status: 'ACTIVE' },
        ],
      });
    }
    throw new Error(`Unexpected request: ${config.url}`);
  }) satisfies AxiosAdapter;

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/price-lists/${priceList.id}`]}>
        <ThemeProvider theme="default" density="comfortable">
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <Routes>
                <Route path="/price-lists/:id" element={<PriceListDetailPage />} />
              </Routes>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function buttonLabels(): string[] {
  return Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '');
}

describe('PriceListDetailPage — status and role gating', () => {
  it('shows draft editing and activation controls to ADMIN on a DRAFT list', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('DRAFT'));

    expect(container.textContent).toContain('PL-2026-000001');
    expect(container.textContent).toContain('Add Style Price');
    expect(buttonLabels()).toContain('Activate');
    expect(buttonLabels()).toContain('Add Line');
    expect(buttonLabels()).toContain('Save');
    expect(buttonLabels()).toContain('Remove');
    expect(container.textContent).toContain('Edit Details');
    // Editable price input for the existing line
    expect(container.querySelector('input[aria-label="Unit price for 39026006"]')).not.toBeNull();
  });

  it('shows retire but no editing controls to ADMIN on an ACTIVE list', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('ACTIVE'));

    expect(buttonLabels()).toContain('Retire');
    expect(buttonLabels()).not.toContain('Activate');
    expect(buttonLabels()).not.toContain('Add Line');
    expect(buttonLabels()).not.toContain('Remove');
    expect(container.textContent).not.toContain('Add Style Price');
    expect(container.textContent).not.toContain('Edit Details');
    // Prices render as read-only text, not inputs
    expect(container.querySelector('input[aria-label="Unit price for 39026006"]')).toBeNull();
    expect(container.textContent).toContain('₹249.50');
  });

  it('renders a retired list as read-only history', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('EXPIRED'));

    expect(container.textContent).toContain('Retired');
    expect(container.textContent).toContain('retired and read-only');
    expect(buttonLabels()).not.toContain('Retire');
    expect(buttonLabels()).not.toContain('Activate');
    expect(buttonLabels()).not.toContain('Add Line');
    expect(container.textContent).toContain('₹249.50');
  });

  it('hides every mutation control from a DISTRIBUTOR user viewing an ACTIVE list', async () => {
    await renderDetailPage(['DISTRIBUTOR'], buildPriceList('ACTIVE'));

    expect(container.textContent).toContain('PL-2026-000001');
    expect(container.textContent).toContain('₹249.50');
    expect(buttonLabels()).not.toContain('Retire');
    expect(buttonLabels()).not.toContain('Activate');
    expect(buttonLabels()).not.toContain('Add Line');
    expect(buttonLabels()).not.toContain('Save');
    expect(buttonLabels()).not.toContain('Remove');
    expect(container.textContent).not.toContain('Edit Details');
  });

  it('hides draft editing controls from read-only roles even on a DRAFT list', async () => {
    await renderDetailPage(['SENIOR_MANAGEMENT'], buildPriceList('DRAFT'));

    expect(buttonLabels()).not.toContain('Activate');
    expect(buttonLabels()).not.toContain('Add Line');
    expect(container.textContent).not.toContain('Add Style Price');
    expect(container.textContent).not.toContain('Edit Details');
    expect(container.textContent).toContain('₹249.50');
  });
});

describe('PriceListDetailPage PDF actions', () => {
  it('shows Download PDF and Print actions in the header', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('ACTIVE'));
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows PDF actions to a read-only DISTRIBUTOR viewer too', async () => {
    await renderDetailPage(['DISTRIBUTOR'], buildPriceList('ACTIVE'));
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('ACTIVE'));
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.find((b) => b.textContent === 'Download PDF')!.disabled).toBe(false);
    expect(buttons.find((b) => b.textContent === 'Print')!.disabled).toBe(false);
    // The page itself is unaffected by the failure.
    expect(container.textContent).toContain('PL-2026-000001');
  });

  it('downloads the price list PDF under a filename built from its code', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('ACTIVE'));
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy).toHaveBeenCalledWith(expect.any(Blob), 'ERVE-Price-List-PL-2026-000001.pdf');
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('ACTIVE'));
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const printSpy = vi.spyOn(printModule, 'printPdfBlob').mockImplementation(() => {});
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => printSpy.mock.calls.length > 0);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('leaves existing edit navigation intact alongside the new PDF actions', async () => {
    await renderDetailPage(['ADMIN'], buildPriceList('DRAFT'));
    const buttons = Array.from(container.querySelectorAll('button, a')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
    expect(buttons).toContain('Edit Details');
    expect(buttons).toContain('Activate');
  });
});
