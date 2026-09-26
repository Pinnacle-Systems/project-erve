import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '@erve/types';
import {
  apiClient,
  AUTH_EXPIRED_EVENT,
  configureRefreshCoordinator,
  configureRefreshCredentialProvider,
  configureSessionActivitySource,
  logoutSession,
  publishSignedInSession,
  refreshAccessToken,
  SessionIdentityChangedError,
  setExpectedSessionUser,
  subscribeSessionEvents,
  type SessionEvent,
} from '../api-client.js';
import { clearStoredToken, getStoredToken, setStoredToken } from '../token-storage.js';
import type { RefreshCoordinator, SessionBroadcast } from './refresh-coordinator.js';
import { getSessionTiming, setSessionTiming } from './session-timing.js';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
    removeItem: vi.fn((key: string) => void values.delete(key)),
    clear: vi.fn(() => values.clear()),
  };
}

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number): never {
  throw new AxiosError(`HTTP ${status}`, AxiosError.ERR_BAD_REQUEST, config, undefined, {
    data: { success: false },
    status,
    statusText: String(status),
    headers: {},
    config,
  });
}

function networkError(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
}

function sessionInfo(userId: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    userId,
    serverTime: '2026-09-26T10:00:00.000Z',
    accessExpiresAt: '2026-09-26T10:05:00.000Z',
    idleExpiresAt: '2026-09-26T10:20:00.000Z',
    absoluteExpiresAt: '2026-09-26T18:00:00.000Z',
    idleTimeoutSeconds: 1200,
    ...overrides,
  };
}

/** Two tabs sharing one lock and one broadcast channel, like a real browser. */
function createFakeBrowser() {
  const listeners = new Map<string, Set<(message: SessionBroadcast) => void>>();
  let lockTail: Promise<unknown> = Promise.resolve();
  const lockRequests: string[] = [];

  function tab(tabId: string): RefreshCoordinator & { published: SessionBroadcast[] } {
    const published: SessionBroadcast[] = [];
    return {
      published,
      withRefreshLock(task) {
        lockRequests.push(tabId);
        const run = lockTail.then(task, task);
        lockTail = run.catch(() => undefined);
        return run;
      },
      publish(message) {
        published.push(message);
        for (const [otherTab, set] of listeners) {
          if (otherTab !== tabId) for (const listener of set) listener(message);
        }
      },
      subscribe(listener) {
        const set = listeners.get(tabId) ?? new Set();
        set.add(listener);
        listeners.set(tabId, set);
        return () => set.delete(listener);
      },
    };
  }

  return { tab, lockRequests };
}

describe('apiClient session behaviour', () => {
  let originalAdapter: typeof apiClient.defaults.adapter;
  let events: SessionEvent[];
  let unsubscribe: () => void;
  let authExpired: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    originalAdapter = apiClient.defaults.adapter;
    vi.stubGlobal('sessionStorage', createStorage());
    vi.stubGlobal('window', new EventTarget());
    authExpired = vi.fn<() => void>();
    window.addEventListener(AUTH_EXPIRED_EVENT, authExpired);
    clearStoredToken();
    setSessionTiming(null);
    events = [];
    unsubscribe = subscribeSessionEvents((event) => events.push(event));
  });

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    unsubscribe();
    configureRefreshCoordinator(null);
    configureRefreshCredentialProvider(null);
    configureSessionActivitySource(null);
    setExpectedSessionUser(null);
    setSessionTiming(null);
    clearStoredToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('failures that must not end the session', () => {
    it.each([
      ['403 Forbidden', (config: InternalAxiosRequestConfig) => fail(config, 403)],
      ['a network error', networkError],
      ['a 500 response', (config: InternalAxiosRequestConfig) => fail(config, 500)],
      ['a 503 response', (config: InternalAxiosRequestConfig) => fail(config, 503)],
    ])('%s on a protected request keeps auth state and never refreshes', async (_, respond) => {
      setStoredToken('valid-token');
      const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        if (config.url === '/protected') respond(config);
        throw new Error(`Unexpected request: ${config.url}`);
      }) satisfies AxiosAdapter;
      apiClient.defaults.adapter = adapter;

      await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(AxiosError);

      expect(adapter).toHaveBeenCalledTimes(1);
      expect(getStoredToken()).toBe('valid-token');
      expect(authExpired).not.toHaveBeenCalled();
    });

    it.each([
      ['a network error', networkError],
      ['a 502 response', (config: InternalAxiosRequestConfig) => fail(config, 502)],
    ])('%s during the refresh after a 401 does not end the session', async (_, respond) => {
      setStoredToken('expired-token');
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        if (config.url === '/protected') fail(config, 401);
        if (config.url === '/auth/refresh') respond(config);
        throw new Error(`Unexpected request: ${config.url}`);
      }) satisfies AxiosAdapter;

      await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(AxiosError);
      expect(authExpired).not.toHaveBeenCalled();
    });
  });

  it('refreshes, retries the original request and keeps auth after an access-token 401', async () => {
    setStoredToken('expired-token');
    setExpectedSessionUser('user-a');
    let protectedCalls = 0;
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/protected') {
        protectedCalls += 1;
        if (protectedCalls === 1) fail(config, 401);
        expect(config.headers.Authorization).toBe('Bearer fresh-token');
        return ok(config, { success: true, data: 'ok' });
      }
      if (config.url === '/auth/refresh') {
        return ok(config, {
          success: true,
          data: { accessToken: 'fresh-token', session: sessionInfo('user-a') },
        });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    await expect(apiClient.get('/protected')).resolves.toMatchObject({ data: { data: 'ok' } });
    expect(getStoredToken()).toBe('fresh-token');
    expect(getSessionTiming()).toMatchObject({ userId: 'user-a', idleTimeoutMs: 1_200_000 });
    expect(authExpired).not.toHaveBeenCalled();
  });

  it('raises auth expiry when the refresh session is genuinely rejected', async () => {
    setStoredToken('expired-token');
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
      fail(config, 401),
    ) satisfies AxiosAdapter;

    await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(AxiosError);
    expect(authExpired).toHaveBeenCalledTimes(1);
    expect(getStoredToken()).toBeNull();
  });

  describe('activity flag', () => {
    it('reports the configured activity source on the cookie refresh', async () => {
      const bodies: unknown[] = [];
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        bodies.push(config.data);
        return ok(config, { success: true, data: { accessToken: 't' } });
      }) satisfies AxiosAdapter;

      configureSessionActivitySource(() => false);
      await refreshAccessToken();
      configureSessionActivitySource(() => true);
      await refreshAccessToken();
      await refreshAccessToken({ activity: false });

      expect(bodies).toEqual([
        JSON.stringify({ activity: false }),
        JSON.stringify({ activity: true }),
        JSON.stringify({ activity: false }),
      ]);
    });

    it('sends no activity flag when no source is configured (mobile, older behaviour)', async () => {
      const bodies: unknown[] = [];
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        bodies.push(config.data);
        return ok(config, { success: true, data: { accessToken: 't' } });
      }) satisfies AxiosAdapter;

      await refreshAccessToken();
      expect(bodies).toEqual([undefined]);
    });

    it('keeps the native mobile refresh body unchanged when no source is configured', async () => {
      configureRefreshCredentialProvider({
        get: async () => 'native-refresh',
        set: async () => undefined,
        clear: async () => undefined,
      });
      let body: unknown;
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        body = config.data;
        return ok(config, {
          success: true,
          data: { accessToken: 'a', refreshToken: 'r2', session: sessionInfo('user-m') },
        });
      }) satisfies AxiosAdapter;

      await refreshAccessToken();
      expect(body).toBe(JSON.stringify({ refreshToken: 'native-refresh' }));
    });
  });

  describe('identity reconciliation', () => {
    it('discards a refreshed token that belongs to a different user', async () => {
      setStoredToken('user-a-token');
      setExpectedSessionUser('user-a');
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        if (config.url === '/protected') fail(config, 401);
        return ok(config, {
          success: true,
          data: { accessToken: 'user-b-token', session: sessionInfo('user-b') },
        });
      }) satisfies AxiosAdapter;

      await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(SessionIdentityChangedError);
      expect(getStoredToken()).toBeNull();
      expect(events).toEqual([{ type: 'identity-changed' }]);
      // Identity change is handled by a reset, not by the "session expired" flow.
      expect(authExpired).not.toHaveBeenCalled();
    });
  });

  describe('cross-tab coordination', () => {
    it('serialises refreshes through the browser-wide lock and shares the result', async () => {
      const browser = createFakeBrowser();
      const thisTab = browser.tab('this');
      configureRefreshCoordinator(thisTab);
      setExpectedSessionUser('user-a');
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
        ok(config, {
          success: true,
          data: { accessToken: 'fresh', session: sessionInfo('user-a') },
        }),
      ) satisfies AxiosAdapter;

      await refreshAccessToken();

      expect(browser.lockRequests).toEqual(['this']);
      expect(thisTab.published).toEqual([
        {
          type: 'session',
          source: 'refresh',
          accessToken: 'fresh',
          session: sessionInfo('user-a'),
        },
      ]);
    });

    it('uses a token another tab refreshed while this tab waited for the lock', async () => {
      const browser = createFakeBrowser();
      const thisTab = browser.tab('this');
      const otherTab = browser.tab('other');
      configureRefreshCoordinator(thisTab);
      setExpectedSessionUser('user-a');
      setStoredToken('stale');

      let releaseOther!: () => void;
      const otherHoldsLock = otherTab.withRefreshLock(
        () =>
          new Promise<void>((resolve) => {
            releaseOther = () => {
              otherTab.publish({
                type: 'session',
                source: 'refresh',
                accessToken: 'from-other-tab',
                session: sessionInfo('user-a'),
              });
              resolve();
            };
          }),
      );
      const adapter = vi.fn(async () => {
        throw new Error('This tab must not rotate the cookie again');
      }) satisfies AxiosAdapter;
      apiClient.defaults.adapter = adapter;

      const pending = refreshAccessToken();
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseOther();
      await otherHoldsLock;

      await expect(pending).resolves.toBe('from-other-tab');
      expect(adapter).not.toHaveBeenCalled();
      expect(events).toEqual([{ type: 'session-adopted' }]);
    });

    it('retries a 401 with a token adopted from another tab before refreshing', async () => {
      setStoredToken('old');
      const seen: string[] = [];
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        seen.push(`${config.url} ${String(config.headers.Authorization)}`);
        if (config.url === '/protected' && seen.length === 1) {
          // Another tab's token arrives while this request is in flight.
          setStoredToken('adopted');
          fail(config, 401);
        }
        if (config.url === '/protected') return ok(config, { success: true, data: 'ok' });
        throw new Error(`Unexpected request: ${config.url}`);
      }) satisfies AxiosAdapter;

      await apiClient.get('/protected');
      expect(seen).toEqual(['/protected Bearer old', '/protected Bearer adopted']);
    });

    it('adopts a session broadcast for the same user', () => {
      const browser = createFakeBrowser();
      configureRefreshCoordinator(browser.tab('this'));
      setExpectedSessionUser('user-a');

      browser.tab('other').publish({
        type: 'session',
        source: 'login',
        accessToken: 'shared',
        session: sessionInfo('user-a'),
      });

      expect(getStoredToken()).toBe('shared');
      expect(getSessionTiming()?.userId).toBe('user-a');
      expect(events).toEqual([{ type: 'session-adopted' }]);
    });

    it('detects a different user signing in from another tab and never adopts that token', () => {
      const browser = createFakeBrowser();
      configureRefreshCoordinator(browser.tab('this'));
      setExpectedSessionUser('user-a');
      setStoredToken('user-a-token');

      browser.tab('other').publish({
        type: 'session',
        source: 'login',
        accessToken: 'user-b-token',
        session: sessionInfo('user-b'),
      });

      expect(getStoredToken()).toBe('user-a-token');
      expect(events).toEqual([{ type: 'identity-changed' }]);
    });

    it('ignores broadcasts while signed out', () => {
      const browser = createFakeBrowser();
      configureRefreshCoordinator(browser.tab('this'));

      browser.tab('other').publish({
        type: 'session',
        source: 'login',
        accessToken: 'someone',
        session: sessionInfo('user-b'),
      });

      expect(getStoredToken()).toBeNull();
      expect(events).toEqual([]);
    });

    it('propagates sign-out to other tabs of the same user', async () => {
      const browser = createFakeBrowser();
      const otherTab = browser.tab('other');
      const otherEvents: SessionBroadcast[] = [];
      otherTab.subscribe((message) => otherEvents.push(message));
      configureRefreshCoordinator(browser.tab('this'));
      setExpectedSessionUser('user-a');
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
        ok(config, { success: true, data: {} }),
      ) satisfies AxiosAdapter;

      await logoutSession();
      expect(otherEvents).toEqual([{ type: 'logout', userId: 'user-a' }]);
      expect(getSessionTiming()).toBeNull();

      browser.tab('other').publish({ type: 'logout', userId: 'user-a' });
      expect(events).toEqual([{ type: 'remote-logout' }]);
    });

    it('announces a sign-in so other tabs can reconcile', () => {
      const browser = createFakeBrowser();
      const thisTab = browser.tab('this');
      configureRefreshCoordinator(thisTab);

      publishSignedInSession('login-token', sessionInfo('user-a'));

      expect(getStoredToken()).toBe('login-token');
      expect(thisTab.published).toEqual([
        {
          type: 'session',
          source: 'login',
          accessToken: 'login-token',
          session: sessionInfo('user-a'),
        },
      ]);
    });
  });
});
