import axios, { AxiosError, type AxiosAdapter, type AxiosInstance } from 'axios';
import { describe, expect, it } from 'vitest';
import {
  InFlightWriteTracker,
  WRITE_SETTLE_GRACE_MS,
  WRITE_TOKEN_MAX_AGE_MS,
} from './inflight-writes.js';
import { UpdateGuardRegistry } from './update-guards.js';

interface Deferred {
  resolve(status?: number): void;
  reject(error?: unknown): void;
}

/** An axios client whose adapter completes only when the test says so. */
function controllableClient() {
  const pending: Deferred[] = [];
  const adapter: AxiosAdapter = (config) =>
    new Promise((resolve, reject) => {
      pending.push({
        resolve: (status = 200) => {
          const response = { data: {}, status, statusText: '', headers: {}, config };
          if (status >= 400) {
            reject(
              new AxiosError(`HTTP ${status}`, 'ERR_BAD_REQUEST', config, undefined, response),
            );
          } else resolve(response);
        },
        reject: (error = new Error('network down')) => reject(error),
      });
    });
  const client: AxiosInstance = axios.create({ adapter, baseURL: 'http://test.invalid' });
  return { client, pending };
}

/** A tracker on a clock the test controls. */
function trackerWithClock() {
  let clock = 1_000_000;
  const tracker = new InFlightWriteTracker(() => clock);
  return {
    tracker,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('InFlightWriteTracker', () => {
  it('counts a write from send until the response and never counts reads', async () => {
    const { client, pending } = controllableClient();
    const { tracker } = trackerWithClock();
    tracker.install(client);

    const read = client.get('/things');
    await flush();
    expect(tracker.count()).toBe(0);
    expect(tracker.blockingReason()).toBeNull();
    pending[0]!.resolve();
    await read;

    const upload = client.post('/qa/inspections/1/evidence', new FormData());
    await flush();
    expect(tracker.count()).toBe(1);
    expect(tracker.blockingReason()).toMatch(/in progress/);
    pending[1]!.resolve();
    await upload;
    expect(tracker.count()).toBe(0);
  });

  it.each(['put', 'patch', 'delete'] as const)('counts %s writes too', async (method) => {
    const { client, pending } = controllableClient();
    const { tracker } = trackerWithClock();
    tracker.install(client);
    const call = client[method]('/x');
    await flush();
    expect(tracker.count()).toBe(1);
    pending[0]!.resolve();
    await call;
    expect(tracker.count()).toBe(0);
  });

  it('releases the write when it fails with an HTTP error or a dropped connection', async () => {
    const { client, pending } = controllableClient();
    const { tracker } = trackerWithClock();
    tracker.install(client);

    const httpFailure = client.post('/a').catch(() => 'failed');
    await flush();
    pending[0]!.resolve(500);
    expect(await httpFailure).toBe('failed');
    expect(tracker.count()).toBe(0);

    const dropped = client.post('/b').catch(() => 'failed');
    await flush();
    expect(tracker.count()).toBe(1);
    pending[1]!.reject(); // a plain Error with no config attached
    expect(await dropped).toBe('failed');
    expect(tracker.count()).toBe(0);
  });

  it('tracks concurrent writes independently', async () => {
    const { client, pending } = controllableClient();
    const { tracker } = trackerWithClock();
    tracker.install(client);
    const first = client.post('/a');
    const second = client.post('/b');
    await flush();
    expect(tracker.count()).toBe(2);
    pending[0]!.resolve();
    await first;
    expect(tracker.count()).toBe(1);
    pending[1]!.resolve();
    await second;
    expect(tracker.count()).toBe(0);
  });

  it('keeps holding across a 401 -> refresh -> retry chain, then lets go', async () => {
    const { client, pending } = controllableClient();
    const { tracker, advance } = trackerWithClock();
    // Registered like @erve/client's refresh handler: BEFORE the tracker, re-issuing error.config.
    client.interceptors.response.use(undefined, async (error: AxiosError) => {
      if (error.response?.status !== 401 || !error.config) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5)); // the token refresh
      return client(error.config);
    });
    tracker.install(client);

    const upload = client.post('/qa/inspections/1/evidence', new FormData());
    await flush();
    pending[0]!.resolve(401);
    await new Promise((resolve) => setTimeout(resolve, 2));
    // no attempt is on the wire, but the chain is not over: the settle window holds
    expect(tracker.count()).toBe(0);
    expect(tracker.blockingReason()).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pending).toHaveLength(2); // the retry reached the wire — wrapped once, not twice
    expect(tracker.count()).toBe(1);
    pending[1]!.resolve(200);
    await upload;
    expect(tracker.count()).toBe(0);
    advance(WRITE_SETTLE_GRACE_MS + 1);
    expect(tracker.blockingReason()).toBeNull();
  });

  it('does not wrap the adapter twice when the client re-issues a config', async () => {
    const { client, pending } = controllableClient();
    const { tracker } = trackerWithClock();
    tracker.install(client);
    client.interceptors.response.use(undefined, (error: AxiosError) =>
      error.response?.status === 401 && error.config && !(error.config as { _r?: boolean })._r
        ? client({ ...error.config, _r: true } as never)
        : Promise.reject(error),
    );
    const call = client.post('/a');
    await flush();
    pending[0]!.resolve(401);
    await flush();
    expect(pending).toHaveLength(2);
    expect(tracker.count()).toBe(1); // exactly one attempt in flight, not two nested ones
    pending[1]!.resolve(200);
    await call;
    expect(tracker.count()).toBe(0);
  });

  it('holds only briefly after the last write settles', async () => {
    const { client, pending } = controllableClient();
    const { tracker, advance } = trackerWithClock();
    tracker.install(client);
    const call = client.post('/a');
    await flush();
    pending[0]!.resolve();
    await call;
    expect(tracker.blockingReason()).toMatch(/only just finished/);
    advance(WRITE_SETTLE_GRACE_MS - 1);
    expect(tracker.blockingReason()).not.toBeNull();
    advance(2);
    expect(tracker.blockingReason()).toBeNull();
  });

  it('notifies observers when a write settles and again when the settle window ends', async () => {
    const { client, pending } = controllableClient();
    const tracker = new InFlightWriteTracker(() => Date.now(), WRITE_TOKEN_MAX_AGE_MS, 30);
    tracker.install(client);
    let notifications = 0;
    tracker.subscribe(() => (notifications += 1));
    const call = client.post('/a');
    await flush();
    pending[0]!.resolve();
    await call;
    const afterSettle = notifications; // began + ended
    expect(afterSettle).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(notifications).toBe(afterSettle + 1);
    expect(tracker.blockingReason()).toBeNull();
  });

  it('drops an attempt that never settles so updates cannot be blocked forever', () => {
    const { tracker, advance } = trackerWithClock();
    tracker.begin();
    expect(tracker.count()).toBe(1);
    advance(WRITE_TOKEN_MAX_AGE_MS - 1);
    expect(tracker.count()).toBe(1);
    advance(2);
    expect(tracker.count()).toBe(0);
    expect(tracker.blockingReason()).toBeNull();
  });

  it('stops counting once uninstalled', async () => {
    const { client, pending } = controllableClient();
    const { tracker } = trackerWithClock();
    const uninstall = tracker.install(client);
    uninstall();
    const call = client.post('/a');
    await flush();
    expect(tracker.count()).toBe(0);
    pending[0]!.resolve();
    await call;
  });

  it('holds the update guard registry while an upload is on the wire, even off a protected route', async () => {
    const { client, pending } = controllableClient();
    const { tracker, advance } = trackerWithClock();
    tracker.install(client);
    const registry = new UpdateGuardRegistry();
    registry.register(() => tracker.blockingReason());

    expect(registry.blockingReason()).toBeNull();
    const upload = client.post('/quality-executions/e1/attachments', new FormData());
    await flush();
    expect(registry.blockingReason()).toMatch(/in progress/);
    pending[0]!.resolve();
    await upload;
    advance(WRITE_SETTLE_GRACE_MS + 1);
    expect(registry.blockingReason()).toBeNull();
  });
});
