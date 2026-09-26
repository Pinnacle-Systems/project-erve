import type { SessionTiming } from './session-timing.js';

/** What the UI should currently show about the session. */
export type SessionPhase =
  | { kind: 'active' }
  /** Idle expiry is near; renewing (Continue Session) pushes it back. `expiresAt` is in local clock ms. */
  | { kind: 'idle-warning'; expiresAt: number }
  /** The absolute lifetime is near; it cannot be extended — only a new sign-in helps. */
  | { kind: 'absolute-warning'; expiresAt: number }
  /** The timing says the session has ended; the server is being asked to confirm. */
  | { kind: 'expired' };

export const SESSION_WARNING_LEAD_MS = 5 * 60 * 1000;
/** Minimum spacing between processed activity events. */
export const ACTIVITY_THROTTLE_MS = 5 * 1000;
/** Upper bound on how often activity-driven renewal slides the idle expiry. */
export const MAX_ACTIVITY_RENEW_INTERVAL_MS = 4 * 60 * 1000;
const MIN_ACTIVITY_RENEW_INTERVAL_MS = 30 * 1000;
/** Renew the access token proactively when it has less than this left and the user is active. */
export const ACCESS_RENEW_LEAD_MS = 60 * 1000;
/** Spacing between renewal attempts, so a failing network cannot cause a refresh storm. */
export const MIN_RENEW_ATTEMPT_GAP_MS = 15 * 1000;
/** Longest a single timer is trusted; timers drift or stall in hidden tabs and across sleep. */
export const MAX_CHECK_DELAY_MS = 30 * 1000;

export interface SessionLifecycleOptions {
  getTiming: () => SessionTiming | null;
  subscribeTiming: (listener: () => void) => () => void;
  /** Performs a (browser-wide coordinated) session refresh. */
  renew: (activity: boolean) => Promise<unknown>;
  onPhaseChange: (phase: SessionPhase) => void;
  /** Whether this tab is currently visible; hidden tabs never generate activity. */
  isVisible: () => boolean;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function samePhase(a: SessionPhase, b: SessionPhase): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === 'active' || a.kind === 'expired' || a.expiresAt === (b as typeof a).expiresAt)
  );
}

export function activityRenewIntervalMs(idleTimeoutMs: number): number {
  return Math.min(
    MAX_ACTIVITY_RENEW_INTERVAL_MS,
    Math.max(MIN_ACTIVITY_RENEW_INTERVAL_MS, Math.floor(idleTimeoutMs / 4)),
  );
}

/** Pure phase calculation from server timing at a given local instant. */
export function computeSessionPhase(
  timing: SessionTiming | null,
  localNow: number,
  warningLeadMs = SESSION_WARNING_LEAD_MS,
): SessionPhase {
  if (!timing) return { kind: 'active' };
  const serverNow = localNow + timing.clockOffsetMs;
  const toLocal = (serverInstant: number) => serverInstant - timing.clockOffsetMs;
  const endsAt = Math.min(timing.idleExpiresAt, timing.absoluteExpiresAt);

  if (serverNow >= endsAt) return { kind: 'expired' };
  if (endsAt - serverNow > warningLeadMs) return { kind: 'active' };
  return timing.absoluteExpiresAt <= timing.idleExpiresAt
    ? { kind: 'absolute-warning', expiresAt: toLocal(timing.absoluteExpiresAt) }
    : { kind: 'idle-warning', expiresAt: toLocal(timing.idleExpiresAt) };
}

/**
 * Drives renewal and expiry UX from real user activity and server timing.
 *
 * - Activity (reported by the platform layer, already limited to visible
 *   tabs) is throttled; at most every few minutes it triggers a refresh
 *   flagged as activity, which is what slides the server's idle expiry.
 *   No activity → no renewal → the server session idles out.
 * - Phases (warning / expired) are always recomputed from wall-clock time
 *   against server instants, never from how long a timer has run, and
 *   re-checked whenever the tab becomes visible, regains focus or network.
 * - At apparent expiry it only *asks* the server (a refresh without
 *   activity). The server's answer decides; there is no separate client-side
 *   security timeout.
 */
export class SessionLifecycle {
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timer: unknown = null;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private phase: SessionPhase = { kind: 'active' };
  private lastActivityAt = Number.NEGATIVE_INFINITY;
  private lastProcessedActivityAt = Number.NEGATIVE_INFINITY;
  private lastRenewAttemptAt = Number.NEGATIVE_INFINITY;
  private renewing: Promise<void> | null = null;
  private probedExpiryFor: number | null = null;

  constructor(private readonly options: SessionLifecycleOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.options.subscribeTiming(() => this.check());
    this.check();
  }

  stop(): void {
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  getPhase(): SessionPhase {
    return this.phase;
  }

  /**
   * True when the user interacted after the server last slid the idle
   * expiry (by any tab). Used as the `activity` flag of every refresh.
   */
  hasPendingActivity(): boolean {
    const timing = this.options.getTiming();
    if (!timing) return this.lastActivityAt > Number.NEGATIVE_INFINITY;
    return this.lastActivityAt > this.lastSlideLocal(timing);
  }

  /** A genuine user interaction happened in this tab. */
  recordActivity(): void {
    if (!this.running || !this.options.isVisible()) return;
    const now = this.now();
    this.lastActivityAt = now;
    if (now - this.lastProcessedActivityAt < ACTIVITY_THROTTLE_MS) return;
    this.lastProcessedActivityAt = now;
    this.maybeRenewForActivity(now);
  }

  /** Explicit "Continue Session": renew now, as activity. Rejects if the server refuses. */
  async continueSession(): Promise<void> {
    this.lastActivityAt = this.now();
    await this.renew(true, { force: true });
  }

  /** Re-evaluates the phase against the wall clock and reschedules. */
  check(): void {
    if (!this.running) return;
    const now = this.now();
    const timing = this.options.getTiming();
    const next = computeSessionPhase(timing, now);
    this.setPhase(next);

    if (next.kind === 'expired' && timing && !this.renewing) {
      // Ask the server immediately the first time this expiry is reached,
      // then at most every MIN_RENEW_ATTEMPT_GAP_MS (e.g. while offline). A
      // 401 raises the normal auth-expired flow; success brings new timing.
      const endsAt = Math.min(timing.idleExpiresAt, timing.absoluteExpiresAt);
      const firstProbe = this.probedExpiryFor !== endsAt;
      this.probedExpiryFor = endsAt;
      void this.renew(false, { force: firstProbe }).catch(() => undefined);
    }

    this.schedule(timing, now);
  }

  private lastSlideLocal(timing: SessionTiming): number {
    return timing.idleExpiresAt - timing.idleTimeoutMs - timing.clockOffsetMs;
  }

  private maybeRenewForActivity(now: number): void {
    const timing = this.options.getTiming();
    if (!timing) {
      // No timing yet (e.g. first load after an upgrade): one renewal fetches it.
      void this.renew(true).catch(() => undefined);
      return;
    }
    const serverNow = now + timing.clockOffsetMs;
    if (serverNow >= Math.min(timing.idleExpiresAt, timing.absoluteExpiresAt)) {
      this.check();
      return;
    }
    const canSlide = timing.idleExpiresAt < timing.absoluteExpiresAt;
    const slideDue =
      canSlide &&
      now - this.lastSlideLocal(timing) >= activityRenewIntervalMs(timing.idleTimeoutMs);
    const accessDue = timing.accessExpiresAt - serverNow <= ACCESS_RENEW_LEAD_MS;
    if (slideDue || accessDue) {
      void this.renew(true).catch(() => undefined);
    }
  }

  private renew(activity: boolean, { force = false } = {}): Promise<void> {
    if (this.renewing) return this.renewing;
    const now = this.now();
    if (!force && now - this.lastRenewAttemptAt < MIN_RENEW_ATTEMPT_GAP_MS) {
      return Promise.resolve();
    }
    this.lastRenewAttemptAt = now;
    this.renewing = this.options
      .renew(activity)
      .then(() => undefined)
      .finally(() => {
        this.renewing = null;
        this.check();
      });
    return this.renewing;
  }

  private setPhase(next: SessionPhase): void {
    if (samePhase(this.phase, next)) return;
    this.phase = next;
    this.options.onPhaseChange(next);
  }

  private schedule(timing: SessionTiming | null, now: number): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.running) return;

    let delay = MAX_CHECK_DELAY_MS;
    if (timing) {
      const endsAtLocal =
        Math.min(timing.idleExpiresAt, timing.absoluteExpiresAt) - timing.clockOffsetMs;
      for (const boundary of [endsAtLocal - SESSION_WARNING_LEAD_MS, endsAtLocal]) {
        if (boundary > now) delay = Math.min(delay, boundary - now);
      }
      if (this.phase.kind === 'expired') delay = Math.min(delay, MIN_RENEW_ATTEMPT_GAP_MS);
    }
    this.timer = this.setTimer(
      () => {
        this.timer = null;
        this.check();
      },
      Math.max(delay, 250),
    );
  }
}
