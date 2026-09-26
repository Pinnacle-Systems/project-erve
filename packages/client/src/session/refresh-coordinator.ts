import type { SessionInfo } from '@erve/types';

/**
 * Messages exchanged between tabs of the same browser. The access token is
 * shared so that a tab which just renewed spares every other tab its own
 * refresh; BroadcastChannel is same-origin only, the same boundary that
 * already protects the token in sessionStorage.
 */
export type SessionBroadcast =
  | { type: 'session'; source: 'refresh' | 'login'; accessToken: string; session: SessionInfo }
  | { type: 'logout'; userId: string | null };

export interface RefreshCoordinator {
  /** Runs `task` while holding a browser-wide exclusive refresh lock. */
  withRefreshLock<T>(task: () => Promise<T>): Promise<T>;
  publish(message: SessionBroadcast): void;
  subscribe(listener: (message: SessionBroadcast) => void): () => void;
}

export const REFRESH_LOCK_NAME = 'erve:auth-refresh';
export const SESSION_CHANNEL_NAME = 'erve:auth-session';

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  /** Node/test runtimes: don't keep the process alive for this channel. */
  unref?: () => void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface BrowserCoordinationEnvironment {
  locks?: LockManagerLike | null;
  createChannel?: ((name: string) => BroadcastChannelLike) | null;
}

function isSessionBroadcast(value: unknown): value is SessionBroadcast {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'session' || type === 'logout';
}

function defaultEnvironment(): BrowserCoordinationEnvironment {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  const Channel = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastChannelLike })
    .BroadcastChannel;
  return {
    locks: nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null,
    createChannel: typeof Channel === 'function' ? (name) => new Channel(name) : null,
  };
}

/**
 * Browser-wide refresh coordination. The HttpOnly refresh cookie is shared
 * by every tab, so refreshes are serialised across tabs with the Web Locks
 * API and results are announced over BroadcastChannel. Where either API is
 * missing it degrades to in-tab behaviour; the server's idempotent rotation
 * grace (see the API's refreshSession) still keeps a concurrent refresh
 * from revoking the session.
 */
export function createBrowserRefreshCoordinator(
  environment: BrowserCoordinationEnvironment = defaultEnvironment(),
): RefreshCoordinator {
  const channel = environment.createChannel?.(SESSION_CHANNEL_NAME) ?? null;
  channel?.unref?.();
  const locks = environment.locks ?? null;

  return {
    withRefreshLock(task) {
      return locks ? locks.request(REFRESH_LOCK_NAME, task) : task();
    },
    publish(message) {
      try {
        channel?.postMessage(message);
      } catch {
        // A closed channel must never break the refresh that just succeeded.
      }
    },
    subscribe(listener) {
      if (!channel) return () => undefined;
      const handler = (event: { data: unknown }) => {
        if (isSessionBroadcast(event.data)) listener(event.data);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}
