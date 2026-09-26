import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_THROTTLE_MS,
  computeSessionPhase,
  MAX_ACTIVITY_RENEW_INTERVAL_MS,
  SESSION_WARNING_LEAD_MS,
  SessionLifecycle,
  type SessionPhase,
} from './session-lifecycle.js';
import type { SessionTiming } from './session-timing.js';

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-09-26T10:00:00.000Z');

/** Timing as the server would return it at `at` for a session last active at `at`. */
function timingAt(
  at: number,
  { idleMinutes = 20, absoluteAt = T0 + 8 * 60 * MINUTE, clockOffsetMs = 0 } = {},
): SessionTiming {
  const idleExpiresAt = Math.min(at + idleMinutes * MINUTE, absoluteAt);
  return {
    userId: 'user-a',
    accessExpiresAt: at + 5 * MINUTE,
    idleExpiresAt,
    absoluteExpiresAt: absoluteAt,
    idleTimeoutMs: idleMinutes * MINUTE,
    clockOffsetMs,
  };
}

function setup(
  initial: SessionTiming | null,
  options: { idleMinutes?: number; absoluteAt?: number } = {},
) {
  let timing = initial;
  const timingListeners = new Set<() => void>();
  let visible = true;
  const phases: SessionPhase[] = [];
  // Simulated server: a renewal with activity slides idle expiry from "now".
  const renew = vi.fn(async (activity: boolean) => {
    const now = Date.now();
    if (!timing) {
      timing = timingAt(now, options);
    } else if (activity) {
      timing = { ...timingAt(now, options), absoluteExpiresAt: timing.absoluteExpiresAt };
      timing.idleExpiresAt = Math.min(timing.idleExpiresAt, timing.absoluteExpiresAt);
    } else {
      timing = { ...timing, accessExpiresAt: now + 5 * MINUTE };
    }
    for (const listener of timingListeners) listener();
  });
  const lifecycle = new SessionLifecycle({
    getTiming: () => timing,
    subscribeTiming: (listener) => {
      timingListeners.add(listener);
      return () => timingListeners.delete(listener);
    },
    renew,
    onPhaseChange: (phase) => phases.push(phase),
    isVisible: () => visible,
  });
  return {
    lifecycle,
    renew,
    phases,
    getTiming: () => timing,
    setTiming: (next: SessionTiming) => {
      timing = next;
      for (const listener of timingListeners) listener();
    },
    setVisible: (next: boolean) => {
      visible = next;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeSessionPhase', () => {
  const timing = timingAt(T0);

  it('is active until five minutes before idle expiry', () => {
    expect(computeSessionPhase(timing, T0 + 14 * MINUTE)).toEqual({ kind: 'active' });
    expect(computeSessionPhase(timing, T0 + 15 * MINUTE)).toEqual({
      kind: 'idle-warning',
      expiresAt: T0 + 20 * MINUTE,
    });
    expect(computeSessionPhase(timing, T0 + 20 * MINUTE)).toEqual({ kind: 'expired' });
  });

  it('distinguishes an approaching absolute expiry from idle expiry', () => {
    const capped = timingAt(T0, { absoluteAt: T0 + 10 * MINUTE });
    expect(computeSessionPhase(capped, T0 + 6 * MINUTE)).toEqual({
      kind: 'absolute-warning',
      expiresAt: T0 + 10 * MINUTE,
    });
  });

  it('corrects for a skewed local clock using the server offset', () => {
    // Local clock is 3 minutes behind the server.
    const skewed = timingAt(T0, { clockOffsetMs: 3 * MINUTE });
    expect(computeSessionPhase(skewed, T0 + 12 * MINUTE)).toEqual({
      kind: 'idle-warning',
      expiresAt: T0 + 17 * MINUTE,
    });
  });
});

describe('SessionLifecycle — activity', () => {
  it('recognises real activity and renews with the activity flag once renewal is due', async () => {
    const { lifecycle, renew } = setup(timingAt(T0));
    lifecycle.start();

    vi.setSystemTime(T0 + MAX_ACTIVITY_RENEW_INTERVAL_MS - 1000);
    lifecycle.recordActivity();
    expect(renew).not.toHaveBeenCalled();

    vi.setSystemTime(T0 + MAX_ACTIVITY_RENEW_INTERVAL_MS + 10_000);
    lifecycle.recordActivity();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(true);
    lifecycle.stop();
  });

  it('throttles bursts of activity to a bounded number of renewals', async () => {
    const { lifecycle, renew } = setup(timingAt(T0));
    lifecycle.start();

    // An hour of continuous typing, an event every 100ms.
    for (let elapsed = 0; elapsed < 60 * MINUTE; elapsed += 100) {
      vi.setSystemTime(T0 + elapsed);
      lifecycle.recordActivity();
      if (elapsed % ACTIVITY_THROTTLE_MS === 0) await vi.advanceTimersByTimeAsync(0);
    }

    // One renewal per renew interval (≈4 min) — about 15, never per keystroke.
    expect(renew.mock.calls.length).toBeGreaterThanOrEqual(12);
    expect(renew.mock.calls.length).toBeLessThanOrEqual(16);
    lifecycle.stop();
  });

  it('keeps an active user signed in across the idle timeout', async () => {
    const { lifecycle, getTiming, phases } = setup(timingAt(T0));
    lifecycle.start();

    for (let minute = 1; minute <= 90; minute += 1) {
      vi.setSystemTime(T0 + minute * MINUTE);
      lifecycle.recordActivity();
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(getTiming()!.idleExpiresAt).toBeGreaterThan(Date.now() + 15 * MINUTE);
    expect(phases.some((phase) => phase.kind !== 'active')).toBe(false);
    lifecycle.stop();
  });

  it('ignores activity while the tab is hidden and never renews from timers alone', async () => {
    const { lifecycle, renew, setVisible } = setup(timingAt(T0));
    lifecycle.start();
    setVisible(false);

    vi.setSystemTime(T0 + 10 * MINUTE);
    lifecycle.recordActivity();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);

    expect(renew).not.toHaveBeenCalled();
    expect(lifecycle.hasPendingActivity()).toBe(false);
    lifecycle.stop();
  });

  it('reports pending activity only for interaction after the last server slide', async () => {
    const { lifecycle, setTiming } = setup(timingAt(T0));
    lifecycle.start();
    expect(lifecycle.hasPendingActivity()).toBe(false);

    vi.setSystemTime(T0 + 30_000);
    lifecycle.recordActivity();
    expect(lifecycle.hasPendingActivity()).toBe(true);

    // Another tab renewed with activity afterwards: this tab's activity is covered.
    setTiming(timingAt(T0 + 60_000));
    expect(lifecycle.hasPendingActivity()).toBe(false);
    lifecycle.stop();
  });

  it('lets an inactive user expire: only a quiet probe is sent at expiry', async () => {
    const { lifecycle, renew, phases } = setup(timingAt(T0));
    lifecycle.start();

    await vi.advanceTimersByTimeAsync(20 * MINUTE + 1000);

    expect(phases.map((phase) => phase.kind)).toEqual(['idle-warning', 'expired']);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledWith(false);
    lifecycle.stop();
  });
});

describe('SessionLifecycle — warnings and Continue Session', () => {
  it('shows the idle warning five minutes before idle expiry', async () => {
    const { lifecycle, phases } = setup(timingAt(T0));
    lifecycle.start();

    await vi.advanceTimersByTimeAsync(15 * MINUTE - SESSION_WARNING_LEAD_MS / 5 - 1);
    expect(phases).toEqual([]);

    await vi.advanceTimersByTimeAsync(SESSION_WARNING_LEAD_MS / 5 + 1);
    expect(phases).toEqual([{ kind: 'idle-warning', expiresAt: T0 + 20 * MINUTE }]);
    lifecycle.stop();
  });

  it('Continue Session renews and returns to active', async () => {
    const { lifecycle, renew, phases } = setup(timingAt(T0));
    lifecycle.start();
    await vi.advanceTimersByTimeAsync(16 * MINUTE);
    expect(lifecycle.getPhase().kind).toBe('idle-warning');

    await lifecycle.continueSession();

    expect(renew).toHaveBeenCalledWith(true);
    expect(lifecycle.getPhase()).toEqual({ kind: 'active' });
    expect(phases.at(-1)).toEqual({ kind: 'active' });
    lifecycle.stop();
  });

  it('Continue Session cannot extend past the absolute expiry', async () => {
    const absoluteAt = T0 + 20 * MINUTE;
    const { lifecycle, getTiming } = setup(timingAt(T0, { idleMinutes: 10, absoluteAt }), {
      idleMinutes: 10,
      absoluteAt,
    });
    lifecycle.start();
    await vi.advanceTimersByTimeAsync(6 * MINUTE);
    expect(lifecycle.getPhase().kind).toBe('idle-warning');

    vi.setSystemTime(T0 + 16 * MINUTE);
    await lifecycle.continueSession();

    expect(getTiming()!.idleExpiresAt).toBe(absoluteAt);
    expect(lifecycle.getPhase()).toEqual({ kind: 'absolute-warning', expiresAt: absoluteAt });
    lifecycle.stop();
  });

  it('follows timing renewed by another tab (warning closes everywhere)', async () => {
    const { lifecycle, setTiming } = setup(timingAt(T0));
    lifecycle.start();
    await vi.advanceTimersByTimeAsync(16 * MINUTE);
    expect(lifecycle.getPhase().kind).toBe('idle-warning');

    setTiming(timingAt(Date.now()));
    expect(lifecycle.getPhase()).toEqual({ kind: 'active' });
    lifecycle.stop();
  });
});

describe('SessionLifecycle — sleep and resume', () => {
  it('re-evaluates from the wall clock when timers did not run (device slept)', async () => {
    const { lifecycle, renew, phases } = setup(timingAt(T0));
    lifecycle.start();

    // No timers fire while asleep; the clock jumps 3 hours.
    vi.setSystemTime(T0 + 3 * 60 * MINUTE);
    lifecycle.check();
    await vi.advanceTimersByTimeAsync(0);

    expect(phases).toEqual([{ kind: 'expired' }]);
    expect(renew).toHaveBeenCalledWith(false);
    lifecycle.stop();
  });

  it('shows the warning immediately on resume when inside the warning window', () => {
    const { lifecycle, phases } = setup(timingAt(T0));
    lifecycle.start();

    vi.setSystemTime(T0 + 17 * MINUTE);
    lifecycle.check();

    expect(phases).toEqual([{ kind: 'idle-warning', expiresAt: T0 + 20 * MINUTE }]);
    lifecycle.stop();
  });

  it('retries the expiry probe after a network failure without a storm', async () => {
    const { lifecycle, renew } = setup(timingAt(T0));
    renew.mockRejectedValue(new Error('offline'));
    lifecycle.start();

    vi.setSystemTime(T0 + 21 * MINUTE);
    lifecycle.check();
    await vi.advanceTimersByTimeAsync(60 * 1000);

    // First probe immediately, then roughly every 15s.
    expect(renew.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(renew.mock.calls.length).toBeLessThanOrEqual(6);
    lifecycle.stop();
  });

  it('fetches timing on the first activity when none is known yet', async () => {
    const { lifecycle, renew, getTiming } = setup(null);
    lifecycle.start();
    lifecycle.recordActivity();
    await vi.advanceTimersByTimeAsync(0);

    expect(renew).toHaveBeenCalledWith(true);
    expect(getTiming()).not.toBeNull();
    lifecycle.stop();
  });
});
