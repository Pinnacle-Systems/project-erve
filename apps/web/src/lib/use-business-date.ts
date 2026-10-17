import { useEffect, useState } from 'react';
import { BUSINESS_TIMEZONE, getBusinessDateString } from './dates.js';

// Milliseconds remaining until the next Asia/Kolkata midnight, computed via
// Intl (not a hard-coded UTC+5:30 offset or browser-local getters) so it
// stays correct regardless of the browser's own timezone.
function msUntilNextBusinessMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  // Some ICU implementations report midnight as hour "24" under hour12:false.
  const elapsedMs = (((get('hour') % 24) * 60 + get('minute')) * 60 + get('second')) * 1000;
  const remaining = 24 * 60 * 60 * 1000 - elapsedMs;
  // A small buffer past the boundary avoids re-firing on the same instant
  // due to clock/formatting rounding.
  return remaining + 500;
}

/**
 * The current ERVE business date (Asia/Kolkata, `YYYY-MM-DD`), kept in sync
 * across the Asia/Kolkata midnight boundary while the component is mounted,
 * and re-checked when the tab regains focus or visibility (a sleeping laptop
 * or background tab can otherwise miss its scheduled timer). One timer per
 * hook instance — no global scheduler, no polling interval.
 */
export function useBusinessDate(): string {
  const [businessDate, setBusinessDate] = useState(() => getBusinessDateString());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    // Re-reads the business date AND reschedules the midnight timer against
    // the current clock. Rescheduling (not just re-reading) matters here: a
    // laptop sleep/wake or a system clock change leaves the previously
    // scheduled timeout computed against stale "now", so every recheck path
    // — the timer firing, a focus event, or a visibility change — goes
    // through this one resync so the schedule never drifts from reality.
    function resync() {
      setBusinessDate(getBusinessDateString());
      scheduleNext();
    }

    function scheduleNext() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(resync, msUntilNextBusinessMidnight(new Date()));
    }
    scheduleNext();

    function handleVisibility() {
      if (document.visibilityState === 'visible') resync();
    }
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return businessDate;
}
