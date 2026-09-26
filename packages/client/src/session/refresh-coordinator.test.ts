import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserRefreshCoordinator,
  REFRESH_LOCK_NAME,
  SESSION_CHANNEL_NAME,
  type SessionBroadcast,
} from './refresh-coordinator.js';

function fakeChannel() {
  const handlers = new Set<(event: { data: unknown }) => void>();
  return {
    postMessage: vi.fn(),
    addEventListener: (_: 'message', handler: (event: { data: unknown }) => void) =>
      handlers.add(handler),
    removeEventListener: (_: 'message', handler: (event: { data: unknown }) => void) =>
      handlers.delete(handler),
    deliver: (data: unknown) => handlers.forEach((handler) => handler({ data })),
  };
}

describe('createBrowserRefreshCoordinator', () => {
  it('runs refreshes under the named browser-wide Web Lock', async () => {
    const request = vi.fn(async (_name: string, task: () => Promise<unknown>) => task());
    const coordinator = createBrowserRefreshCoordinator({ locks: { request } as never });

    await expect(coordinator.withRefreshLock(async () => 'done')).resolves.toBe('done');
    expect(request).toHaveBeenCalledWith(REFRESH_LOCK_NAME, expect.any(Function));
  });

  it('falls back to running directly when Web Locks are unavailable', async () => {
    const coordinator = createBrowserRefreshCoordinator({ locks: null, createChannel: null });
    await expect(coordinator.withRefreshLock(async () => 42)).resolves.toBe(42);
    expect(() => coordinator.publish({ type: 'logout', userId: null })).not.toThrow();
    expect(coordinator.subscribe(() => undefined)).toBeTypeOf('function');
  });

  it('publishes and receives session messages on the shared channel, ignoring junk', () => {
    const channel = fakeChannel();
    const createChannel = vi.fn(() => channel);
    const coordinator = createBrowserRefreshCoordinator({ createChannel });
    const received: SessionBroadcast[] = [];
    const unsubscribe = coordinator.subscribe((message) => received.push(message));

    coordinator.publish({ type: 'logout', userId: 'user-a' });
    channel.deliver({ type: 'logout', userId: 'user-a' });
    channel.deliver({ type: 'something-else' });
    channel.deliver('not an object');
    unsubscribe();
    channel.deliver({ type: 'logout', userId: 'user-b' });

    expect(createChannel).toHaveBeenCalledWith(SESSION_CHANNEL_NAME);
    expect(channel.postMessage).toHaveBeenCalledWith({ type: 'logout', userId: 'user-a' });
    expect(received).toEqual([{ type: 'logout', userId: 'user-a' }]);
  });
});
