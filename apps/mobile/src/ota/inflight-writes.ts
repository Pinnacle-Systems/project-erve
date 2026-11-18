/**
 * Tracks API writes (POST/PUT/PATCH/DELETE) that are on the wire right now.
 *
 * The mutation cache only knows about calls made through `useMutation`. Some
 * operational calls — QA evidence photo upload, quality attachment
 * upload/removal — call the API client directly, so a route change (or any
 * future refactor that moves them off a protected route) would leave an upload
 * invisible to the update guards while a WebView reload would abort it. Hooking
 * the HTTP client itself covers every current and future write, whatever
 * component issued it.
 *
 * What is counted is each actual HTTP ATTEMPT, at the adapter, released in a
 * `finally`. It deliberately does not follow a request through the shared
 * client's 401 -> refresh -> retry handling: that path can reject the original
 * request with a different error object (the refresh's) that carries a different
 * config, so any scheme that releases "the original request's token" from the
 * error that comes back can leak (reproduced on a device: a refresh aborted by
 * its 30 s timeout left the update banner held on the login screen for 10
 * minutes). An attempt-level counter cannot leak that way.
 *
 * Two things cover the gaps a counter alone would leave:
 *  - the refresh request is itself a tracked write, so the whole refresh holds;
 *  - after the last attempt settles the guard stays up for a short settle window
 *    (the credential store write and the retry dispatch happen between the
 *    refresh response and the retry request).
 * An attempt that never settles (a socket that died silently; the client has no
 * request timeout) is dropped after 10 minutes so it cannot hold updates until
 * the app is restarted.
 */
import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

const READ_METHODS = new Set(['get', 'head', 'options']);
const TRACKED = Symbol('ota-tracked-adapter');

/** Slow field networks upload photos slowly; beyond this an attempt is considered dead. */
export const WRITE_TOKEN_MAX_AGE_MS = 10 * 60 * 1000;
/** Bridges "refresh finished" -> "retry dispatched" (credential store write, microtasks). */
export const WRITE_SETTLE_GRACE_MS = 3_000;

type TrackedAdapter = AxiosAdapter & { [TRACKED]?: true };

export class InFlightWriteTracker {
  private readonly active = new Map<number, number>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private lastSettledAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxAgeMs: number = WRITE_TOKEN_MAX_AGE_MS,
    private readonly settleGraceMs: number = WRITE_SETTLE_GRACE_MS,
  ) {}

  begin(): number {
    this.sequence += 1;
    this.active.set(this.sequence, this.now());
    this.emit();
    return this.sequence;
  }

  end(attempt: number): void {
    if (!this.active.delete(attempt)) return;
    this.lastSettledAt = this.now();
    this.emit();
    // Observers must hear about the end of the settle window too, or a banner
    // would keep saying "finish your task" until something else changes.
    const timer = setTimeout(() => this.emit(), this.settleGraceMs + 50);
    (timer as { unref?: () => void }).unref?.();
  }

  /** Attempts genuinely on the wire (stale ones are dropped). */
  count(): number {
    const cutoff = this.now() - this.maxAgeMs;
    for (const [attempt, startedAt] of this.active) {
      if (startedAt < cutoff) this.active.delete(attempt);
    }
    return this.active.size;
  }

  blockingReason(): string | null {
    if (this.count() > 0) return 'A save or upload is still in progress';
    if (this.now() - this.lastSettledAt < this.settleGraceMs)
      return 'A save has only just finished';
    return null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Starts counting writes made through `client`. Returns an uninstall function. */
  install(client: AxiosInstance): () => void {
    const id = client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      if (READ_METHODS.has((config.method ?? 'get').toLowerCase())) return config;
      const current = (config.adapter ?? axios.defaults.adapter) as TrackedAdapter;
      // The shared client re-issues a 401'd config through itself, and that config
      // already carries our wrapper: do not wrap twice.
      if (typeof current === 'function' && current[TRACKED]) return config;
      const inner = axios.getAdapter(current);
      const wrapped: TrackedAdapter = async (adapterConfig): Promise<AxiosResponse> => {
        const attempt = this.begin();
        try {
          return await inner(adapterConfig);
        } finally {
          this.end(attempt);
        }
      };
      wrapped[TRACKED] = true;
      config.adapter = wrapped;
      return config;
    });
    return () => client.interceptors.request.eject(id);
  }
}

/** Process-wide instance, installed on the shared API client by ota-runtime. */
export const inFlightWrites = new InFlightWriteTracker();
