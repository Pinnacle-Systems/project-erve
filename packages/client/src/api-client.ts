import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ApiSuccessResponse, RefreshRequest, RefreshResponse, SessionInfo } from '@erve/types';
import { clearStoredToken, getStoredToken, setStoredToken } from './token-storage.js';
import type { RefreshCoordinator, SessionBroadcast } from './session/refresh-coordinator.js';
import { setSessionTiming, toSessionTiming } from './session/session-timing.js';

export const AUTH_EXPIRED_EVENT = 'erve:auth-expired';

/** Bounds how long a hung refresh can hold the browser-wide refresh lock. */
const REFRESH_TIMEOUT_MS = 30_000;

interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _tokenSwapRetry?: boolean;
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

export interface RefreshCredentialProvider {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export class RefreshCredentialError extends Error {
  constructor(
    public readonly reason: 'missing' | 'unreadable',
    options?: ErrorOptions,
  ) {
    super(`Refresh credential is ${reason}`, options);
    this.name = 'RefreshCredentialError';
  }
}

/**
 * The browser's refresh session now belongs to a different user than the
 * one this tab is showing (another tab signed in as someone else). The
 * refreshed access token is discarded, never used for a request.
 */
export class SessionIdentityChangedError extends Error {
  constructor() {
    super('The signed-in user changed in another tab');
    this.name = 'SessionIdentityChangedError';
  }
}

export type SessionEvent =
  /** Another tab (or a refresh) revealed a different signed-in user. */
  | { type: 'identity-changed' }
  /** Another tab of the same user signed out. */
  | { type: 'remote-logout' }
  /** A valid access token for this tab's user arrived from another tab. */
  | { type: 'session-adopted' };

let refreshCredentialProvider: RefreshCredentialProvider | null = null;
let refreshCoordinator: RefreshCoordinator | null = null;
let unsubscribeCoordinator: (() => void) | null = null;
let activitySource: (() => boolean) | null = null;
let expectedUserId: string | null = null;
let tokenGeneration = 0;
const sessionEventListeners = new Set<(event: SessionEvent) => void>();

export function configureRefreshCredentialProvider(
  provider: RefreshCredentialProvider | null,
): void {
  refreshCredentialProvider = provider;
}

function emitSessionEvent(event: SessionEvent): void {
  for (const listener of sessionEventListeners) listener(event);
}

export function subscribeSessionEvents(listener: (event: SessionEvent) => void): () => void {
  sessionEventListeners.add(listener);
  return () => {
    sessionEventListeners.delete(listener);
  };
}

/**
 * The user this tab is signed in as, or null when signed out. Refresh
 * results and cross-tab messages for any other user are treated as an
 * identity change instead of being applied. Mobile never sets it.
 */
export function setExpectedSessionUser(userId: string | null): void {
  expectedUserId = userId;
}

/**
 * Reports whether the user genuinely interacted since the session's idle
 * expiry last slid. Sent as `activity` on every refresh so that only real
 * activity — never a background request — extends the idle session.
 * Unset (mobile), the flag is omitted and the server assumes activity.
 */
export function configureSessionActivitySource(source: (() => boolean) | null): void {
  activitySource = source;
}

function applySessionInfo(accessToken: string, session: SessionInfo | undefined): void {
  setStoredToken(accessToken);
  tokenGeneration += 1;
  if (session) setSessionTiming(toSessionTiming(session));
}

function handleBroadcast(message: SessionBroadcast): void {
  if (!expectedUserId) return;

  if (message.type === 'logout') {
    if (message.userId === null || message.userId === expectedUserId) {
      emitSessionEvent({ type: 'remote-logout' });
    }
    return;
  }

  if (message.session.userId !== expectedUserId) {
    emitSessionEvent({ type: 'identity-changed' });
    return;
  }

  applySessionInfo(message.accessToken, message.session);
  emitSessionEvent({ type: 'session-adopted' });
}

/** Web opts in to browser-wide refresh coordination; mobile leaves it unset. */
export function configureRefreshCoordinator(coordinator: RefreshCoordinator | null): void {
  unsubscribeCoordinator?.();
  refreshCoordinator = coordinator;
  unsubscribeCoordinator = coordinator?.subscribe(handleBroadcast) ?? null;
}

/**
 * Records a successful sign-in (login page or in-place re-authentication)
 * and announces it so other tabs can adopt the session or, if they show a
 * different user, reset safely.
 */
export function publishSignedInSession(accessToken: string, session?: SessionInfo): void {
  applySessionInfo(accessToken, session);
  if (session) {
    refreshCoordinator?.publish({ type: 'session', source: 'login', accessToken, session });
  }
}

function isAuthEndpoint(url?: string): boolean {
  return Boolean(
    url &&
    [
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
      '/auth/mobile/login',
      '/auth/mobile/refresh',
      '/auth/mobile/logout',
    ].some((path) => url.endsWith(path)),
  );
}

function notifyAuthExpired(): void {
  clearStoredToken();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

export interface RefreshAccessTokenOptions {
  /** Overrides the configured activity source for this refresh. */
  activity?: boolean;
}

async function performRefresh(activity: boolean | undefined): Promise<string> {
  let refreshToken: string | null | undefined;
  try {
    refreshToken = await refreshCredentialProvider?.get();
  } catch (cause) {
    await refreshCredentialProvider?.clear().catch(() => undefined);
    throw new RefreshCredentialError('unreadable', { cause });
  }

  if (refreshCredentialProvider && !refreshToken) {
    throw new RefreshCredentialError('missing');
  }

  const activityBody: RefreshRequest | undefined =
    activity === undefined ? undefined : { activity };

  let response;
  try {
    response = await apiClient.post<
      ApiSuccessResponse<RefreshResponse & { refreshToken?: string }>
    >(
      refreshCredentialProvider ? '/auth/mobile/refresh' : '/auth/refresh',
      refreshCredentialProvider ? { refreshToken, ...activityBody } : activityBody,
      { withCredentials: true, timeout: REFRESH_TIMEOUT_MS },
    );
  } catch (error) {
    if (
      refreshCredentialProvider &&
      axios.isAxiosError(error) &&
      error.config?.url?.endsWith('/refresh') &&
      [400, 401, 403].includes(error.response?.status ?? 0)
    ) {
      await refreshCredentialProvider.clear().catch(() => undefined);
    }
    throw error;
  }
  const { accessToken, refreshToken: nextRefreshToken, session } = response.data.data;
  if (refreshCredentialProvider && nextRefreshToken) {
    await refreshCredentialProvider.set(nextRefreshToken);
  }

  if (expectedUserId && session && session.userId !== expectedUserId) {
    // The shared cookie now belongs to someone else: never use this token
    // under the identity this tab is still displaying.
    clearStoredToken();
    emitSessionEvent({ type: 'identity-changed' });
    throw new SessionIdentityChangedError();
  }

  applySessionInfo(accessToken, session);
  if (session) {
    refreshCoordinator?.publish({ type: 'session', source: 'refresh', accessToken, session });
  }
  return accessToken;
}

export async function refreshAccessToken(options: RefreshAccessTokenOptions = {}): Promise<string> {
  const generationAtRequest = tokenGeneration;
  const activity = options.activity ?? activitySource?.();

  refreshPromise ??= (async () => {
    const task = async () => {
      // While this tab waited for the browser-wide lock, another tab may
      // have refreshed and shared its token — use it instead of rotating
      // the cookie a second time.
      const adopted = getStoredToken();
      if (tokenGeneration !== generationAtRequest && adopted) {
        return adopted;
      }
      return performRefresh(activity);
    };
    return refreshCoordinator ? refreshCoordinator.withRefreshLock(task) : task();
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as RetryableAxiosRequestConfig;

    if (originalRequest._retry || isAuthEndpoint(originalRequest.url)) {
      if (!isAuthEndpoint(originalRequest.url) || originalRequest.url?.endsWith('/refresh')) {
        notifyAuthExpired();
      }
      return Promise.reject(error);
    }

    // The request went out with a token that has since been replaced (e.g.
    // adopted from another tab) — retry once with the current one first.
    const currentToken = getStoredToken();
    if (
      !originalRequest._tokenSwapRetry &&
      currentToken &&
      originalRequest.headers.Authorization !== `Bearer ${currentToken}`
    ) {
      originalRequest._tokenSwapRetry = true;
      return apiClient(originalRequest);
    }

    originalRequest._retry = true;

    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      if (
        !(refreshError instanceof SessionIdentityChangedError) &&
        (!axios.isAxiosError(refreshError) || !refreshError.config?.url?.endsWith('/refresh'))
      ) {
        notifyAuthExpired();
      }
      return Promise.reject(refreshError);
    }
  },
);

export async function logoutSession(): Promise<void> {
  const userId = expectedUserId;
  try {
    const refreshToken = await refreshCredentialProvider?.get();
    await apiClient.post(
      refreshCredentialProvider ? '/auth/mobile/logout' : '/auth/logout',
      refreshCredentialProvider ? { refreshToken } : undefined,
      { withCredentials: true },
    );
  } finally {
    await refreshCredentialProvider?.clear();
    setSessionTiming(null);
    refreshCoordinator?.publish({ type: 'logout', userId });
    notifyAuthExpired();
  }
}
