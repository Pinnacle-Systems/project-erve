import type { RefreshCoordinator, SessionBroadcast } from '@erve/client';
import type { SessionInfo } from '@erve/types';

export function sessionInfo(userId: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  const now = Date.now();
  return {
    userId,
    serverTime: new Date(now).toISOString(),
    accessExpiresAt: new Date(now + 5 * 60_000).toISOString(),
    idleExpiresAt: new Date(now + 20 * 60_000).toISOString(),
    absoluteExpiresAt: new Date(now + 8 * 60 * 60_000).toISOString(),
    idleTimeoutSeconds: 1200,
    ...overrides,
  };
}

/** Tabs of one simulated browser, sharing a refresh lock and a broadcast channel. */
export function createFakeBrowser() {
  const listeners = new Map<string, Set<(message: SessionBroadcast) => void>>();
  let lockTail: Promise<unknown> = Promise.resolve();

  function tab(tabId: string): RefreshCoordinator {
    return {
      withRefreshLock(task) {
        const run = lockTail.then(task, task);
        lockTail = run.catch(() => undefined);
        return run;
      },
      publish(message) {
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

  return { tab };
}
