/** @vitest-environment jsdom */
/**
 * Regression: a write whose 401 triggers a token refresh that then FAILS.
 *
 * Device trace (release-readiness run): the submit was answered 401, the shared
 * client started `POST /auth/mobile/refresh`, the client aborted that request
 * after its 30 s timeout, and the original request's promise was rejected with
 * the *refresh* error (a different error object with a different config). The
 * write tracker used to release a request's token only via the error that
 * carried that request's own config, so the submit's token leaked and the
 * update banner kept saying "finish your current task" — on the login screen —
 * until the 10-minute expiry.
 *
 * This test drives the REAL shared client (not a lookalike interceptor), so the
 * rejection path is exactly the production one.
 */
import { AxiosError, type AxiosAdapter } from 'axios';
import { apiClient, configureRefreshCredentialProvider } from '@erve/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InFlightWriteTracker, WRITE_SETTLE_GRACE_MS } from './inflight-writes.js';

const REFRESH_URL = '/auth/mobile/refresh';

describe('InFlightWriteTracker with the real shared client', () => {
  const originalAdapter = apiClient.defaults.adapter;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    sessionStorage.setItem('erve.accessToken', 'expired-access-token');
    configureRefreshCredentialProvider({
      get: async () => 'stored-refresh-token',
      set: async () => undefined,
      clear: async () => undefined,
    });
  });

  afterEach(() => {
    uninstall?.();
    apiClient.defaults.adapter = originalAdapter;
    configureRefreshCredentialProvider(null);
    sessionStorage.clear();
    vi.useRealTimers();
  });

  function adapterWhere(refresh: 'times-out' | 'succeeds') {
    const seen: string[] = [];
    const adapter: AxiosAdapter = async (config) => {
      seen.push(`${config.method} ${config.url}`);
      if (config.url === REFRESH_URL) {
        if (refresh === 'times-out') {
          throw new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', config);
        }
        return {
          data: {
            success: true,
            data: { accessToken: 'fresh-access-token', refreshToken: 'next-refresh-token' },
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
      const authorised = config.headers.get('Authorization') === 'Bearer fresh-access-token';
      if (authorised) {
        return {
          data: { success: true, data: {} },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
      const response = { data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config };
      throw new AxiosError('401', 'ERR_BAD_REQUEST', config, undefined, response);
    };
    return { adapter, seen };
  }

  it('releases the original write when the refresh it triggered fails (the device-trace failure)', async () => {
    const { adapter, seen } = adapterWhere('times-out');
    apiClient.defaults.adapter = adapter;
    const tracker = new InFlightWriteTracker();
    uninstall = tracker.install(apiClient);

    const submit = apiClient.post('/job-orders/j1/actions/update-prepared-quantity', {});
    const outcome = submit.then(
      () => 'resolved',
      (error: AxiosError) => error.code,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toBe('ECONNABORTED'); // rejected with the refresh error, as on the device
    expect(seen).toEqual([
      'post /job-orders/j1/actions/update-prepared-quantity',
      `post ${REFRESH_URL}`,
    ]); // and the write was never retried

    await vi.advanceTimersByTimeAsync(WRITE_SETTLE_GRACE_MS + 100);
    expect(tracker.count()).toBe(0);
    expect(tracker.blockingReason()).toBeNull();
  });

  it('still holds updates for the whole 401 -> refresh -> retry chain, then releases', async () => {
    const { adapter, seen } = adapterWhere('succeeds');
    apiClient.defaults.adapter = adapter;
    const tracker = new InFlightWriteTracker();
    uninstall = tracker.install(apiClient);

    const reasonsDuringChain: Array<string | null> = [];
    const adapterWithProbe: AxiosAdapter = async (config) => {
      reasonsDuringChain.push(tracker.blockingReason());
      return adapter(config);
    };
    apiClient.defaults.adapter = adapterWithProbe;

    const submit = apiClient.post('/job-orders/j1/actions/update-prepared-quantity', {});
    await vi.advanceTimersByTimeAsync(0);
    await expect(submit).resolves.toBeDefined();
    expect(seen).toEqual([
      'post /job-orders/j1/actions/update-prepared-quantity',
      `post ${REFRESH_URL}`,
      'post /job-orders/j1/actions/update-prepared-quantity',
    ]);
    // every HTTP attempt of the chain (write, refresh, retry) saw the guard held
    expect(reasonsDuringChain).toHaveLength(3);
    expect(reasonsDuringChain.every((reason) => reason !== null)).toBe(true);

    await vi.advanceTimersByTimeAsync(WRITE_SETTLE_GRACE_MS + 100);
    expect(tracker.count()).toBe(0);
  });
});
