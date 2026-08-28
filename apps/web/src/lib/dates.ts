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
