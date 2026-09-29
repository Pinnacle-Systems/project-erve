export type DateDisplayFormat = "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd" | "short";

export interface CalendarDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Determines whether a year is a leap year according to the Gregorian calendar.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the maximum number of days in the specified month (1-12) of a year.
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Validates whether year, month (1-12), and day represent an actual calendar date.
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }
  return day <= getDaysInMonth(year, month);
}

/**
 * Formats calendar parts as canonical ISO `YYYY-MM-DD`.
 */
export function formatCanonicalDate(parts: CalendarDateParts): string {
  const y = String(parts.year).padStart(4, "0");
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Strictly parses a canonical `YYYY-MM-DD` string into calendar date parts.
 * Rejects invalid dates (e.g. 2026-02-31).
 */
export function parseCanonicalDate(value: string | undefined | null): CalendarDateParts | undefined {
  if (!value || typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) return undefined;
  return { year, month, day };
}

/**
 * Strictly and deterministically parses user-typed text into calendar date parts.
 * Supported formats:
 * - ISO: YYYY-MM-DD, YYYY/MM/DD
 * - Separated: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (or MM/DD/YYYY if format is mm/dd/yyyy)
 * - Compact digits: DDMMYYYY or YYYYMMDD (8 digits)
 * Never relies on `new Date(userString)` or browser-specific loose parsing.
 */
export function parseDateInput(
  rawInput: string,
  displayFormat: DateDisplayFormat = "dd/mm/yyyy",
): CalendarDateParts | undefined {
  const trimmed = rawInput.trim();
  if (!trimmed) return undefined;

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD (supports 1 or 2 digit month/day)
  const isoMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidCalendarDate(year, month, day)) {
      return { year, month, day };
    }
    return undefined;
  }

  // 2. Separated format: DD/MM/YYYY or MM/DD/YYYY with /, -, or .
  const sepMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (sepMatch) {
    const first = Number(sepMatch[1]);
    const second = Number(sepMatch[2]);
    const year = Number(sepMatch[3]);
    const month = displayFormat === "mm/dd/yyyy" ? first : second;
    const day = displayFormat === "mm/dd/yyyy" ? second : first;
    if (isValidCalendarDate(year, month, day)) {
      return { year, month, day };
    }
    return undefined;
  }

  // 3. Compact 8-digit continuous number without separators
  if (/^\d{8}$/.test(trimmed)) {
    // Check if it starts with a 4-digit year (1900-2099)
    const firstFour = Number(trimmed.slice(0, 4));
    if (firstFour >= 1900 && firstFour <= 2099) {
      const year = firstFour;
      const month = Number(trimmed.slice(4, 6));
      const day = Number(trimmed.slice(6, 8));
      if (isValidCalendarDate(year, month, day)) {
        return { year, month, day };
      }
    }

    // Otherwise treat as DDMMYYYY or MMDDYYYY depending on displayFormat
    const lastFour = Number(trimmed.slice(4, 8));
    if (lastFour >= 1000 && lastFour <= 9999) {
      const first = Number(trimmed.slice(0, 2));
      const second = Number(trimmed.slice(2, 4));
      const year = lastFour;
      const month = displayFormat === "mm/dd/yyyy" ? first : second;
      const day = displayFormat === "mm/dd/yyyy" ? second : first;
      if (isValidCalendarDate(year, month, day)) {
        return { year, month, day };
      }
    }
  }

  return undefined;
}

/**
 * Checks whether user input is potentially a partial date in progress of being typed.
 */
export function isPartialDateInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  // Partial ISO: "2026", "2026-", "2026-04", "2026-04-"
  if (/^\d{1,4}[/-]?\d{0,2}[/-]?\d{0,2}$/.test(trimmed)) return true;
  // Partial separated: "1", "15", "15/", "15/09", "15/09/", "15/09/2", "15/09/20"
  if (/^\d{1,2}[/.-]?\d{0,2}[/.-]?\d{0,4}$/.test(trimmed)) return true;
  // Partial pure digits
  if (/^\d{1,7}$/.test(trimmed)) return true;
  return false;
}

/**
 * Formats calendar parts or a Date object into user display text.
 */
export function formatDisplayDate(
  partsOrDate: CalendarDateParts | Date | undefined,
  displayFormat: DateDisplayFormat,
): string {
  if (!partsOrDate) return "";
  let parts: CalendarDateParts;
  if (partsOrDate instanceof Date) {
    parts = {
      year: partsOrDate.getFullYear(),
      month: partsOrDate.getMonth() + 1,
      day: partsOrDate.getDate(),
    };
  } else {
    parts = partsOrDate;
  }

  const yyyy = String(parts.year).padStart(4, "0");
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");

  switch (displayFormat) {
    case "dd/mm/yyyy":
      return `${dd}/${mm}/${yyyy}`;
    case "mm/dd/yyyy":
      return `${mm}/${dd}/${yyyy}`;
    case "yyyy-mm-dd":
      return `${yyyy}-${mm}-${dd}`;
    case "short": {
      const localDate = toSafeLocalDate(parts.year, parts.month, parts.day);
      return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(localDate);
    }
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/**
 * Creates a Date at local noon (12:00:00) to ensure safe calendar math
 * that never shifts across midnight due to daylight saving or timezone boundaries.
 */
export function toSafeLocalDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Converts a Date object to canonical `YYYY-MM-DD` using local calendar values.
 * Avoids `toISOString()` which shifts dates across UTC midnight.
 */
export function toCanonicalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return formatCanonicalDate({ year: y, month: m, day: d });
}

/**
 * Performs lexicographical min/max bounds checking on canonical `YYYY-MM-DD` strings.
 */
export function isDateOutOfRange(
  canonicalDate: string | undefined,
  min?: string,
  max?: string,
): boolean {
  if (!canonicalDate) return false;
  if (min && canonicalDate < min) return true;
  if (max && canonicalDate > max) return true;
  return false;
}
