import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import { computeFinancialYearWindow, toBusinessCalendarDate } from '../modules/master-data/financial-year.util.js';
import { runFinancialYearBootstrap, FinancialYearBootstrapError } from './financial-year-bootstrap.js';

const DB_URL = 'postgresql://erve_app:super-secret-pw@10.0.0.5:5432/erve_production?schema=public';

function currentFinancialYearCode(): string {
  return computeFinancialYearWindow(toBusinessCalendarDate(new Date())).code;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('runFinancialYearBootstrap', () => {
  it('ensures a 9-year rolling window (3 back, current, 5 forward) including the current Financial Year', async () => {
    const result = await runFinancialYearBootstrap(
      { nodeEnv: 'test', confirmProduction: false },
      { databaseUrl: DB_URL },
    );

    expect(result.financialYears).toHaveLength(9);
    expect(result.financialYears.map((fy) => fy.code)).toContain(currentFinancialYearCode());

    const rows = await prisma.financialYear.findMany();
    expect(rows).toHaveLength(9);
  });

  it('running again changes nothing — no duplicates, same ids, same boundaries', async () => {
    await runFinancialYearBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });
    const before = await prisma.financialYear.findMany({ orderBy: { startDate: 'asc' } });

    await runFinancialYearBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });
    const after = await prisma.financialYear.findMany({ orderBy: { startDate: 'asc' } });

    expect(after).toHaveLength(before.length);
    expect(after.map((fy) => fy.id)).toEqual(before.map((fy) => fy.id));
    expect(after.map((fy) => fy.startDate.getTime())).toEqual(before.map((fy) => fy.startDate.getTime()));
    expect(after.map((fy) => fy.endDate.getTime())).toEqual(before.map((fy) => fy.endDate.getTime()));
  });

  it('never creates a User, Season, or any other table row', async () => {
    await runFinancialYearBootstrap({ nodeEnv: 'test', confirmProduction: false }, { databaseUrl: DB_URL });

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.season.count()).resolves.toBe(0);
  });

  it('requires --confirm-production in production and never touches the database first', async () => {
    const before = await prisma.financialYear.count();

    await expect(
      runFinancialYearBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL }),
    ).rejects.toThrow(FinancialYearBootstrapError);

    await expect(prisma.financialYear.count()).resolves.toBe(before);
  });

  it('the production guard names the DB target but never a credential', async () => {
    await expect(
      runFinancialYearBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('erve_production on 10.0.0.5:5432'),
    });

    try {
      await runFinancialYearBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL });
      expect.unreachable('expected the production guard to reject');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret-pw');
      expect(message).not.toContain('erve_app');
    }
  });

  it('succeeds in production once --confirm-production is supplied', async () => {
    const result = await runFinancialYearBootstrap(
      { nodeEnv: 'production', confirmProduction: true },
      { databaseUrl: DB_URL },
    );
    expect(result.financialYears).toHaveLength(9);
  });
});
