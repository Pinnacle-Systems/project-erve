import { describe, expect, it } from 'vitest';
import {
  computeFinancialYearWindow,
  parseStrictCalendarDate,
  toBusinessCalendarDate,
  toCompactFinancialYearCode,
} from './financial-year.util.js';

describe('computeFinancialYearWindow', () => {
  it('resolves 31-Mar-2027 to FY 2026-27', () => {
    const window = computeFinancialYearWindow(new Date('2027-03-31T00:00:00.000Z'));
    expect(window.code).toBe('2026-27');
    expect(window.startDate.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(window.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('resolves 01-Apr-2027 to FY 2027-28', () => {
    const window = computeFinancialYearWindow(new Date('2027-04-01T00:00:00.000Z'));
    expect(window.code).toBe('2027-28');
    expect(window.startDate.toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(window.endDate.toISOString().slice(0, 10)).toBe('2028-03-31');
  });

  it('handles the leap-year Feb 29 boundary without shifting FY', () => {
    // FY 2027-28 ends 31-Mar-2028; 2028 is a leap year, so Feb 29 2028 falls
    // inside it, not outside.
    const window = computeFinancialYearWindow(new Date('2028-02-29T00:00:00.000Z'));
    expect(window.code).toBe('2027-28');
  });

  it('resolves the current date deterministically without throwing', () => {
    expect(() => computeFinancialYearWindow(new Date())).not.toThrow();
  });
});

describe('toCompactFinancialYearCode', () => {
  it('compacts "2026-27" to "26-27"', () => {
    expect(toCompactFinancialYearCode('2026-27')).toBe('26-27');
  });
});

describe('toBusinessCalendarDate', () => {
  it('resolves a UTC instant just after IST midnight to the next business day', () => {
    // 01-Apr-2027 00:15 IST == 31-Mar-2027 18:45 UTC. A naive UTC read would
    // misclassify this as still 31-Mar; the business-timezone conversion
    // must not.
    const instant = new Date('2027-03-31T18:45:00.000Z');
    const businessDate = toBusinessCalendarDate(instant);
    expect(businessDate.toISOString().slice(0, 10)).toBe('2027-04-01');
  });

  it('composed with computeFinancialYearWindow resolves the IST boundary to the new FY', () => {
    const instant = new Date('2027-03-31T18:45:00.000Z'); // 01-Apr-2027 00:15 IST
    const window = computeFinancialYearWindow(toBusinessCalendarDate(instant));
    expect(window.code).toBe('2027-28');
  });

  it('leaves a UTC instant still before IST midnight in the prior FY', () => {
    // 31-Mar-2027 23:59 IST == 31-Mar-2027 18:29 UTC — still 31-Mar in IST.
    const instant = new Date('2027-03-31T18:29:00.000Z');
    const window = computeFinancialYearWindow(toBusinessCalendarDate(instant));
    expect(window.code).toBe('2026-27');
  });
});

describe('parseStrictCalendarDate', () => {
  it.each(['2027-02-28', '2028-02-29', '2027-04-01'])('accepts %s', (input) => {
    expect(parseStrictCalendarDate(input)).not.toBeNull();
  });

  it.each(['2027-02-29', '2027-02-31', '2027-13-01', '27-04-01', 'foo'])('rejects %s', (input) => {
    expect(parseStrictCalendarDate(input)).toBeNull();
  });
});
