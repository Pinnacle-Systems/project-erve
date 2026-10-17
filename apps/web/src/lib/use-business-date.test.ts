/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBusinessDate } from './use-business-date.js';

let container: HTMLDivElement;
let root: Root;
const originalTZ = process.env.TZ;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  process.env.TZ = originalTZ;
});

function Probe({ onValue }: { onValue: (value: string) => void }) {
  const businessDate = useBusinessDate();
  onValue(businessDate);
  return null;
}

function renderProbe(onValue: (value: string) => void) {
  act(() => {
    root.render(createElement(Probe, { onValue }));
  });
}

describe('useBusinessDate', () => {
  it('reports the Asia/Kolkata business date on mount, regardless of browser timezone', () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-08-27T19:00:00.000Z')); // 00:30 IST on Aug 28
    const seen: string[] = [];
    renderProbe((v) => seen.push(v));
    expect(seen.at(-1)).toBe('2026-08-28');
  });

  it('refreshes automatically across the Asia/Kolkata midnight boundary while mounted', async () => {
    vi.setSystemTime(new Date('2026-08-27T18:00:00.000Z')); // 23:30 IST on Aug 27 — 30 min to the boundary
    const seen: string[] = [];
    renderProbe((v) => seen.push(v));
    expect(seen.at(-1)).toBe('2026-08-27');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000); // cross 18:30 UTC
    });

    expect(seen.at(-1)).toBe('2026-08-28');
  });

  it('does not update before the midnight boundary is reached', async () => {
    vi.setSystemTime(new Date('2026-08-27T18:00:00.000Z'));
    const seen: string[] = [];
    renderProbe((v) => seen.push(v));
    const callsBeforeAdvance = seen.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000); // 1 min short of the boundary
    });

    expect(seen.length).toBe(callsBeforeAdvance);
    expect(seen.at(-1)).toBe('2026-08-27');
  });

  it('rechecks on visibility restoration, e.g. after a background tab slept past the boundary', async () => {
    vi.setSystemTime(new Date('2026-08-27T18:00:00.000Z'));
    const seen: string[] = [];
    renderProbe((v) => seen.push(v));
    expect(seen.at(-1)).toBe('2026-08-27');

    // Simulate a backgrounded tab: the clock moves past the boundary without
    // the scheduled timer firing (as if the OS suspended it), then the tab
    // becomes visible again.
    vi.setSystemTime(new Date('2026-08-27T19:00:00.000Z'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(seen.at(-1)).toBe('2026-08-28');
  });

  it('rechecks on window focus', async () => {
    vi.setSystemTime(new Date('2026-08-27T18:00:00.000Z'));
    const seen: string[] = [];
    renderProbe((v) => seen.push(v));

    vi.setSystemTime(new Date('2026-08-27T19:00:00.000Z'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(seen.at(-1)).toBe('2026-08-28');
  });

  it('reschedules its midnight timer on every recheck, not just the displayed date', async () => {
    // Guards against a laptop sleep/wake or clock change leaving a stale
    // timeout scheduled against the old "now": after a focus/visibility
    // recheck, a timer computed from the OLD time must no longer be the one
    // pending — only a freshly scheduled one (from the new time) should fire.
    vi.setSystemTime(new Date('2026-08-27T18:00:00.000Z')); // 23:30 IST Aug 27
    const seen: string[] = [];
    renderProbe((v) => seen.push(v));
    expect(seen.at(-1)).toBe('2026-08-27');

    // Jump far forward (as if the laptop slept) and recheck via focus.
    vi.setSystemTime(new Date('2026-08-27T19:00:00.000Z')); // 00:30 IST Aug 28
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(seen.at(-1)).toBe('2026-08-28');
    const callsAfterFirstRecheck = seen.length;

    // If the original (stale) midnight timer were still the one pending, it
    // was scheduled for ~23h30m after the FIRST system time (i.e. close to
    // now) and would already have fired, or fire very soon with no real
    // relation to the new day. Advancing by just under a full day from the
    // rechecked time must fire nothing extra until the newly scheduled
    // boundary — proving the schedule was rebased off the latest "now".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000); // 23h — short of the next boundary
    });
    expect(seen.length).toBe(callsAfterFirstRecheck);
    expect(seen.at(-1)).toBe('2026-08-28');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000); // cross into Aug 29 IST midnight
    });
    expect(seen.at(-1)).toBe('2026-08-29');
  });

  it('removes its timer and listeners on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const removeWindowSpy = vi.spyOn(window, 'removeEventListener');
    const removeDocSpy = vi.spyOn(document, 'removeEventListener');
    renderProbe(() => {});

    act(() => root.unmount());

    expect(clearSpy).toHaveBeenCalled();
    expect(removeWindowSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(removeDocSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    clearSpy.mockRestore();
    removeWindowSpy.mockRestore();
    removeDocSpy.mockRestore();
  });
});
