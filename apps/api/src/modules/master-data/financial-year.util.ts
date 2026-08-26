// Pure calculation only — no Prisma, no DB, no HTTP, no side effects. This is
// the single authoritative place the 1-April–31-March fiscal boundary and the
// Asia/Kolkata business timezone are defined; every document/Season resolver
// goes through here so the convention is never duplicated elsewhere.

// Single authority for the business timezone. IST has a fixed UTC+5:30 offset
// with no DST, so relying on Node's IANA tzdata via Intl (below) is exact —
// no library, no hand-maintained offset constant to keep in sync.
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

// 1-based calendar month the fiscal year starts on (4 = April). Explicitly
// 1-based to avoid confusing this with JavaScript's 0-based month numbering.
export const FINANCIAL_YEAR_START_MONTH_1_BASED = 4;

export interface FinancialYearWindow {
  code: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Converts a UTC instant (e.g. a `createdAt` timestamp) to the
 * business-timezone calendar date, represented the same way Prisma
 * represents a `@db.Date` column (UTC midnight of that calendar day) — so
 * downstream code never has to know whether a date came from a `@db.Date`
 * column or a converted timestamp.
 */
export function toBusinessCalendarDate(instant: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00.000Z`);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Pure: given a business calendar date, compute its Financial Year window.
 * No DB access — persisting the corresponding row is `ensureFinancialYear`'s
 * job (financial-year.service.ts), not this function's.
 */
export function computeFinancialYearWindow(businessDate: Date): FinancialYearWindow {
  const year = businessDate.getUTCFullYear();
  const month1Based = businessDate.getUTCMonth() + 1;
  const startYear = month1Based >= FINANCIAL_YEAR_START_MONTH_1_BASED ? year : year - 1;
  const endYear = startYear + 1;
  const code = `${startYear}-${pad2(endYear % 100)}`;
  // Both @db.Date columns — day granularity only. Subtracting a millisecond
  // to get "the day before" would leave endDate at 23:59:59.999Z instead of
  // UTC midnight; that survives a round-trip through Postgres (which
  // truncates DATE columns to just the calendar day) but no longer matches
  // this in-memory value byte-for-byte, breaking ensureFinancialYear's
  // create-or-validate comparison for every FY not yet persisted. Passing
  // day 0 of the following month is UTC-midnight of the last day of this
  // month — no sub-day component to begin with.
  const startDate = new Date(Date.UTC(startYear, FINANCIAL_YEAR_START_MONTH_1_BASED - 1, 1));
  const endDate = new Date(Date.UTC(endYear, FINANCIAL_YEAR_START_MONTH_1_BASED - 1, 0));
  return { code, startDate, endDate };
}

/** "2026-27" -> "26-27", used for both Season display and document numbers. */
export function toCompactFinancialYearCode(code: string): string {
  const [start = '', end = ''] = code.split('-');
  return `${start.slice(-2)}-${end}`;
}

/**
 * Strict `YYYY-MM-DD` parser. `new Date(input)` silently normalizes invalid
 * calendar dates (e.g. a `2027-02-30` string overflows to March) — that's
 * unacceptable for a business-date boundary, so this rejects anything that
 * doesn't round-trip exactly instead of accepting a normalized value.
 */
export function parseStrictCalendarDate(input: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return null;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}
