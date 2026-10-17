/**
 * Returns the given moment's calendar date in the browser's local timezone,
 * as `YYYY-MM-DD`.
 *
 * Deliberately reads local date components (`getFullYear`/`getMonth`/`getDate`)
 * rather than `toISOString().slice(0, 10)`, which reports the UTC calendar date —
 * for users east of UTC that can be a day ahead of the local date, and during
 * early local hours it can even land on the *previous* local day.
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Single authority for ERVE's business timezone on the web, mirroring
// apps/api/src/modules/master-data/financial-year.util.ts's BUSINESS_TIMEZONE
// — IST has a fixed UTC+5:30 offset with no DST, so Intl's IANA tzdata gives
// an exact answer with no hand-maintained offset constant.
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns the given instant's calendar date in ERVE's authoritative
 * Asia/Kolkata business timezone, as `YYYY-MM-DD` — independent of the
 * browser's own timezone. Use this (not `getLocalDateString`) wherever a
 * decision depends on ERVE's business date, e.g. which GST Rule Set version
 * is effective today.
 */
export function getBusinessDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
