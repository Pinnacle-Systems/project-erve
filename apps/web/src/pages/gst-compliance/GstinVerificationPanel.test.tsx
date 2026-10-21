/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { GstVerificationView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import {
  GstinVerificationPanel,
  GstinVerificationResult,
  formatFiledPeriod,
} from './GstinVerificationPanel.js';

const evidence = {
  id: 'sample',
  requestedGstin: '33AAAAA0000A1Z5',
  normalizedGstin: '33AAAAA0000A1Z5',
  lookupGstin: '00AAAAA0000A1ZT',
  returnedGstin: '00AAAAA0000A1ZT',
  mode: 'DEMO' as const,
  level: 'COMPLETE' as const,
  governmentStatus: 'ACTIVE' as const,
  legalName: 'Synthetic Company',
  tradeName: null,
  taxpayerType: 'Regular',
  registeredAddress: null,
  registrationDate: null,
  businessConstitution: null,
  filingFrequency: 'Monthly',
  gstr1FiledTill: '2026-08',
  gstr3bFiledTill: '2026-08',
  partial: true,
  unavailable: ['gstr3b_filed_till'],
  retrievedAt: '2026-10-14T06:00:00Z',
  expiresAt: '2026-10-21T06:00:00Z',
  ttlSeconds: 604800,
  estimatedCredits: 0,
  actualCredits: null,
  billingCategory: 'test',
};
const view = (): GstVerificationView => ({
  enabled: true,
  mode: 'DEMO',
  level: 'COMPLETE',
  canVerify: true,
  canRefresh: true,
  cacheState: 'FRESH',
  evidence,
  latestFailure: null,
});
let container: HTMLDivElement;
let root: Root;
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
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(component: React.ReactNode) {
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        {component}
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
describe('GSTIN verification UI', () => {
  it('shows fresh Basic registration without a stale warning or expired Complete filing values', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await render(
      <GstinVerificationResult
        view={{
          ...view(),
          cacheState: 'BASIC_ONLY',
          evidence: { ...evidence, level: 'BASIC', expiresAt: '2099-01-01T00:00:00Z' },
        }}
      />,
    );
    expect(container.textContent).toContain('Synthetic Company');
    expect(container.textContent).not.toContain('Stale');
    expect(container.textContent).toContain('Fresh Complete Profile information is unavailable');
    expect(container.textContent).not.toContain('August 2026');
    expect(container.querySelector('details')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it('marks an open result stale even at the maximum 30-day TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
    try {
      act(() =>
        root.render(
          <GstinVerificationResult
            view={{ ...view(), evidence: { ...evidence, expiresAt: '2026-11-20T00:00:00Z' } }}
          />,
        ),
      );
      expect(container.textContent).not.toContain('Stale');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31 * 86400000);
      });
      expect(container.textContent).toContain('Stale');
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not display profile values explicitly marked unavailable', async () => {
    await render(
      <GstinVerificationResult
        view={{
          ...view(),
          evidence: {
            ...evidence,
            unavailable: ['legal_name', 'trade_name', 'taxpayer_type'],
            tradeName: 'Unreliable trade name',
          },
        }}
      />,
    );
    expect(container.textContent).not.toContain('Synthetic Company');
    expect(container.textContent).not.toContain('Unreliable trade name');
    expect(container.textContent).not.toContain('Regular');
  });
  it('derives stale status from expiry even if the last server read said fresh', async () => {
    await render(
      <GstinVerificationResult
        view={{ ...view(), evidence: { ...evidence, expiresAt: '2020-01-01T00:00:00Z' } }}
      />,
    );
    expect(container.textContent).toContain('Stale');
    expect(container.textContent).toContain('information may be outdated');
  });
  it.each([
    ['2026-08', 'August 2026'],
    [null, 'Information unavailable'],
    ['2026-13', 'Information unavailable'],
    ['2026-08-10', 'Information unavailable'],
  ])('formats filed-through period %s', (input, expected) =>
    expect(formatFiledPeriod(input)).toBe(expected),
  );
  it('labels Demo sample, keeps registration data and renders unavailable filing fields without requests', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await render(<GstinVerificationResult view={view()} />);
    expect(container.textContent).toContain('The entered GSTIN has not been verified');
    expect(container.textContent).toContain('Synthetic Company');
    expect(container.textContent).toContain('August 2026');
    expect(container.textContent).toContain('Information unavailable');
    expect(container.textContent).not.toMatch(/Not Filed|gstinapi|Filing Date/);
    act(() => container.querySelector('summary')!.click());
    expect(post).not.toHaveBeenCalled();
  });
  it('hides all extra UI when verification is OFF', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: { enabled: false } } });
    await render(<GstinVerificationPanel gstin="33AAAAA0000A1Z5" standalone />);
    expect(container.textContent).toBe('');
  });
  it('keeps Basic separate from Complete and labels expired evidence stale', async () => {
    await render(
      <GstinVerificationResult
        view={{ ...view(), cacheState: 'STALE', evidence: { ...evidence, level: 'BASIC' } }}
      />,
    );
    expect(container.textContent).toContain('Stale');
    expect(container.textContent).toContain('Fresh Complete Profile information is unavailable');
    expect(container.querySelector('details')).toBeNull();
  });
  it('confirms Live miss with exact GSTIN and cost; cancel makes no execution request', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url) => ({
      data: {
        data: url.endsWith('/policy')
          ? { enabled: true }
          : { ...view(), mode: 'LIVE', cacheState: 'NONE', evidence: null },
      },
    }));
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        data: {
          kind: 'CONFIRMATION',
          intentId: 'intent',
          gstin: '33AAAAA0000A1Z5',
          level: 'COMPLETE',
          mode: 'LIVE',
          estimatedCredits: 2,
          freshCacheAvailable: false,
          refresh: false,
          expiresAt: '2026-10-21T06:05:00Z',
        },
      },
    });
    await render(<GstinVerificationPanel gstin="33AAAAA0000A1Z5" standalone />);
    expect(post).not.toHaveBeenCalled();
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent === 'Retrieve Complete Profile')!
        .click(),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('33AAAAA0000A1Z5');
    expect(dialog?.textContent).toContain('2 API credits');
    await act(async () =>
      [...dialog!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click(),
    );
    expect(post.mock.calls.every(([url]) => url.endsWith('/prepare'))).toBe(true);
  });
});
