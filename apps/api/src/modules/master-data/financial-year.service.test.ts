import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import { ensureFinancialYear, getCurrentFinancialYear, getFinancialYearById } from './financial-year.service.js';
import { computeFinancialYearWindow, toBusinessCalendarDate } from './financial-year.util.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('ensureFinancialYear', () => {
  it('creates a missing Financial Year', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2031-06-15'));
    expect(fy.code).toBe('2031-32');
    const persisted = await prisma.financialYear.findUnique({ where: { code: '2031-32' } });
    expect(persisted).not.toBeNull();
  });

  it('returns the existing row unchanged on a second call for the same date', async () => {
    const first = await ensureFinancialYear(prisma, new Date('2031-06-15'));
    const second = await ensureFinancialYear(prisma, new Date('2031-09-01')); // same FY, different date
    expect(second.id).toBe(first.id);
    const count = await prisma.financialYear.count({ where: { code: '2031-32' } });
    expect(count).toBe(1);
  });

  it('never silently updates an existing row — a mismatched stored window is a data-integrity error', async () => {
    const window = computeFinancialYearWindow(new Date('2032-06-15'));
    // Simulate a row whose stored boundary has drifted from what the
    // resolver would compute today (e.g. a hypothetical future change to
    // the fiscal convention) — ensureFinancialYear must refuse to
    // reconcile this by overwriting it.
    await prisma.financialYear.create({
      data: {
        id: 'drifted-fy',
        code: window.code,
        startDate: new Date(window.startDate.getTime() + 24 * 60 * 60 * 1000),
        endDate: window.endDate,
      },
    });
    await expect(ensureFinancialYear(prisma, new Date('2032-06-15'))).rejects.toThrow(
      /data integrity mismatch/i,
    );
    const stillDrifted = await prisma.financialYear.findUniqueOrThrow({ where: { id: 'drifted-fy' } });
    expect(stillDrifted.startDate.getTime()).toBe(window.startDate.getTime() + 24 * 60 * 60 * 1000);
  });

  it('converges concurrent callers resolving the same brand-new Financial Year on one row', async () => {
    const date = new Date('2033-05-01');
    const results = await Promise.all([
      ensureFinancialYear(prisma, date),
      ensureFinancialYear(prisma, date),
      ensureFinancialYear(prisma, date),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const count = await prisma.financialYear.count({ where: { code: results[0]!.code } });
    expect(count).toBe(1);
  });
});

describe('getCurrentFinancialYear', () => {
  it('is read-only: it does not create a Financial Year row when one is missing', async () => {
    const window = computeFinancialYearWindow(toBusinessCalendarDate(new Date()));
    await expect(prisma.financialYear.findUniqueOrThrow({ where: { code: window.code } })).rejects.toThrow();

    await expect(getCurrentFinancialYear()).rejects.toThrow();

    // Still missing — the read path above must not have created it.
    await expect(prisma.financialYear.findUniqueOrThrow({ where: { code: window.code } })).rejects.toThrow();
  });

  it('returns the persisted current Financial Year once seeded', async () => {
    const seeded = await ensureFinancialYear(prisma, toBusinessCalendarDate(new Date()));
    const current = await getCurrentFinancialYear();
    expect(current.id).toBe(seeded.id);
  });
});

describe('getFinancialYearById', () => {
  it('throws a not-found error for an unknown id', async () => {
    await expect(getFinancialYearById('does-not-exist')).rejects.toThrow(/not found/i);
  });
});
