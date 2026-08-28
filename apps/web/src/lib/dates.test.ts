import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDateString } from './dates.js';

const originalTZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTZ;
  vi.useRealTimers();
});

describe('getLocalDateString', () => {
  it('reports the local calendar date when the equivalent UTC date is still the previous day', () => {
    // 23:00 UTC on Aug 27 is 13:00 the next day in UTC+14 — a user there is
    // already on Aug 28 while toISOString() would still say Aug 27.
    process.env.TZ = 'Etc/GMT-14';
    const date = new Date('2026-08-27T23:00:00.000Z');
    expect(getLocalDateString(date)).toBe('2026-08-28');
  });

  it('reports the local calendar date when the equivalent UTC date is already the next day', () => {
    // 05:00 UTC on Aug 28 is 17:00 the previous day in UTC-12 — a user there
    // is still on Aug 27 while toISOString() would already say Aug 28.
    process.env.TZ = 'Etc/GMT+12';
    const date = new Date('2026-08-28T05:00:00.000Z');
    expect(getLocalDateString(date)).toBe('2026-08-27');
  });

  it('matches the UTC date under normal, non-boundary conditions', () => {
    process.env.TZ = 'UTC';
    const date = new Date('2026-08-28T12:00:00.000Z');
    expect(getLocalDateString(date)).toBe('2026-08-28');
  });

  it('zero-pads single-digit month and day components', () => {
    process.env.TZ = 'UTC';
    const date = new Date('2026-01-05T12:00:00.000Z');
    expect(getLocalDateString(date)).toBe('2026-01-05');
  });

  it('defaults to the current local date when no argument is given', () => {
    process.env.TZ = 'Etc/GMT-14';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T23:00:00.000Z'));
    expect(getLocalDateString()).toBe('2026-08-28');
  });
});
