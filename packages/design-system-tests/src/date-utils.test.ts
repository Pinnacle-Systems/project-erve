import { describe, expect, it } from "vitest";
import {
  formatCanonicalDate,
  formatDisplayDate,
  getDaysInMonth,
  isDateOutOfRange,
  isLeapYear,
  isPartialDateInput,
  isValidCalendarDate,
  parseCanonicalDate,
  parseDateInput,
  toCanonicalDateString,
  toSafeLocalDate,
} from "../../primitives/src/lib/date-utils";

describe("date-utils — leap years and calendar math", () => {
  it("determines leap years correctly", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
  });

  it("calculates days in month considering leap years", () => {
    expect(getDaysInMonth(2026, 1)).toBe(31);
    expect(getDaysInMonth(2026, 2)).toBe(28);
    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2026, 3)).toBe(31);
    expect(getDaysInMonth(2026, 4)).toBe(30);
    expect(getDaysInMonth(2026, 5)).toBe(31);
    expect(getDaysInMonth(2026, 6)).toBe(30);
    expect(getDaysInMonth(2026, 7)).toBe(31);
    expect(getDaysInMonth(2026, 8)).toBe(31);
    expect(getDaysInMonth(2026, 9)).toBe(30);
    expect(getDaysInMonth(2026, 10)).toBe(31);
    expect(getDaysInMonth(2026, 11)).toBe(30);
    expect(getDaysInMonth(2026, 12)).toBe(31);
    expect(getDaysInMonth(2026, 13)).toBe(0);
  });

  it("validates actual calendar dates strictly", () => {
    expect(isValidCalendarDate(2026, 4, 1)).toBe(true);
    expect(isValidCalendarDate(2026, 2, 28)).toBe(true);
    expect(isValidCalendarDate(2026, 2, 29)).toBe(false); // 2026 not leap
    expect(isValidCalendarDate(2024, 2, 29)).toBe(true); // 2024 leap
    expect(isValidCalendarDate(2026, 4, 30)).toBe(true);
    expect(isValidCalendarDate(2026, 4, 31)).toBe(false); // April has 30 days
    expect(isValidCalendarDate(2026, 12, 31)).toBe(true);
    expect(isValidCalendarDate(2026, 13, 1)).toBe(false);
    expect(isValidCalendarDate(2026, 0, 15)).toBe(false);
    expect(isValidCalendarDate(2026, 5, 0)).toBe(false);
    expect(isValidCalendarDate(2026, 5, 32)).toBe(false);
    expect(isValidCalendarDate(999, 1, 1)).toBe(false);
  });
});

describe("date-utils — canonical ISO parsing and formatting", () => {
  it("formats canonical date parts to YYYY-MM-DD", () => {
    expect(formatCanonicalDate({ year: 2026, month: 4, day: 1 })).toBe("2026-04-01");
    expect(formatCanonicalDate({ year: 2026, month: 12, day: 31 })).toBe("2026-12-31");
  });

  it("parses valid canonical dates", () => {
    expect(parseCanonicalDate("2026-04-01")).toEqual({ year: 2026, month: 4, day: 1 });
    expect(parseCanonicalDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it("rejects invalid canonical dates", () => {
    expect(parseCanonicalDate("2026-02-29")).toBeUndefined();
    expect(parseCanonicalDate("2026-04-31")).toBeUndefined();
    expect(parseCanonicalDate("invalid")).toBeUndefined();
    expect(parseCanonicalDate("")).toBeUndefined();
    expect(parseCanonicalDate(undefined)).toBeUndefined();
  });
});

describe("date-utils — user input parsing", () => {
  it("parses DD/MM/YYYY and DD-MM-YYYY format", () => {
    expect(parseDateInput("15/09/2026", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateInput("15-09-2026", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateInput("15.09.2026", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateInput("1/4/2026", "dd/mm/yyyy")).toEqual({ year: 2026, month: 4, day: 1 });
    expect(parseDateInput("01/04/2026", "dd/mm/yyyy")).toEqual({ year: 2026, month: 4, day: 1 });
  });

  it("parses ISO YYYY-MM-DD and YYYY/MM/DD format", () => {
    expect(parseDateInput("2026-09-15", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateInput("2026/09/15", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateInput("2026-4-1", "dd/mm/yyyy")).toEqual({ year: 2026, month: 4, day: 1 });
  });

  it("parses 8-digit continuous numbers", () => {
    expect(parseDateInput("15092026", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateInput("20260915", "dd/mm/yyyy")).toEqual({ year: 2026, month: 9, day: 15 });
  });

  it("respects mm/dd/yyyy format when specified", () => {
    expect(parseDateInput("04/15/2026", "mm/dd/yyyy")).toEqual({ year: 2026, month: 4, day: 15 });
    expect(parseDateInput("04-15-2026", "mm/dd/yyyy")).toEqual({ year: 2026, month: 4, day: 15 });
  });

  it("strictly rejects impossible dates without rollover", () => {
    expect(parseDateInput("31/02/2026", "dd/mm/yyyy")).toBeUndefined();
    expect(parseDateInput("29/02/2026", "dd/mm/yyyy")).toBeUndefined();
    expect(parseDateInput("31/04/2026", "dd/mm/yyyy")).toBeUndefined();
    expect(parseDateInput("32/01/2026", "dd/mm/yyyy")).toBeUndefined();
    expect(parseDateInput("00/01/2026", "dd/mm/yyyy")).toBeUndefined();
    expect(parseDateInput("15/13/2026", "dd/mm/yyyy")).toBeUndefined();
  });

  it("detects partial date typing", () => {
    expect(isPartialDateInput("1")).toBe(true);
    expect(isPartialDateInput("15")).toBe(true);
    expect(isPartialDateInput("15/")).toBe(true);
    expect(isPartialDateInput("15/0")).toBe(true);
    expect(isPartialDateInput("15/09")).toBe(true);
    expect(isPartialDateInput("15/09/")).toBe(true);
    expect(isPartialDateInput("15/09/2")).toBe(true);
    expect(isPartialDateInput("15/09/20")).toBe(true);
    expect(isPartialDateInput("2026")).toBe(true);
    expect(isPartialDateInput("2026-")).toBe(true);
    expect(isPartialDateInput("2026-09")).toBe(true);
    expect(isPartialDateInput("not-a-date")).toBe(false);
    expect(isPartialDateInput("abc")).toBe(false);
  });
});

describe("date-utils — display formatting and timezone safety", () => {
  it("formats display dates according to specified format", () => {
    const parts = { year: 2026, month: 9, day: 15 };
    expect(formatDisplayDate(parts, "dd/mm/yyyy")).toBe("15/09/2026");
    expect(formatDisplayDate(parts, "mm/dd/yyyy")).toBe("09/15/2026");
    expect(formatDisplayDate(parts, "yyyy-mm-dd")).toBe("2026-09-15");
  });

  it("converts Date to canonical string using local calendar values", () => {
    const localNoon = toSafeLocalDate(2026, 4, 1);
    expect(toCanonicalDateString(localNoon)).toBe("2026-04-01");
  });

  it("checks min and max bounds lexicographically", () => {
    expect(isDateOutOfRange("2026-03-31", "2026-04-01", undefined)).toBe(true);
    expect(isDateOutOfRange("2026-04-01", "2026-04-01", undefined)).toBe(false);
    expect(isDateOutOfRange("2026-04-02", "2026-04-01", undefined)).toBe(false);
    expect(isDateOutOfRange("2026-05-01", undefined, "2026-04-30")).toBe(true);
    expect(isDateOutOfRange("2026-04-30", undefined, "2026-04-30")).toBe(false);
    expect(isDateOutOfRange("2026-04-15", "2026-04-01", "2026-04-30")).toBe(false);
  });
});
