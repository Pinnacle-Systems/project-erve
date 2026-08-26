import { prisma as defaultPrisma } from '../db/prisma.js';
import {
  ensureFinancialYearWindow,
  type FinancialYearServiceClient,
} from '../modules/master-data/financial-year.service.js';
import { describeDatabaseTarget } from './describe-database-target.js';

export class FinancialYearBootstrapError extends Error {}

export interface FinancialYearBootstrapOptions {
  nodeEnv: string;
  confirmProduction: boolean;
}

export interface FinancialYearBootstrapResult {
  financialYears: Array<{ code: string; startDate: Date; endDate: Date }>;
}

// Same reasoning as RolesBootstrapPrismaClient — a deliberately narrow
// $transaction-only surface, distinct from the full generated client.
export interface FinancialYearBootstrapPrismaClient {
  $transaction: <T>(fn: (tx: FinancialYearServiceClient) => Promise<T>) => Promise<T>;
}

/**
 * Idempotent, production-safe counterpart to seedFinancialYears() in
 * prisma/seed.ts. Unlike the general dev/test seed (never run against
 * production — see DEPLOYMENT.md), this touches only the financial_years
 * table, so it's safe to run against a real production database on its own.
 *
 * Without this, a freshly deployed production database has an empty
 * financial_years table until the first real Purchase Order or Job Order is
 * created (the only other path that writes a FinancialYear row, via
 * ensureFinancialYear inside their own creation transaction) — until then,
 * GET /financial-years/current 500s and Season creation has no Financial
 * Year to offer or default to.
 */
export async function runFinancialYearBootstrap(
  options: FinancialYearBootstrapOptions,
  deps: { prisma?: FinancialYearBootstrapPrismaClient; databaseUrl: string },
): Promise<FinancialYearBootstrapResult> {
  const client: FinancialYearBootstrapPrismaClient = deps.prisma ?? defaultPrisma;

  if (options.nodeEnv === 'production' && !options.confirmProduction) {
    throw new FinancialYearBootstrapError(
      `Target database: ${describeDatabaseTarget(deps.databaseUrl)}\n` +
        'Production execution requires --confirm-production.',
    );
  }

  const financialYears = await client.$transaction((tx) => ensureFinancialYearWindow(tx, new Date()));

  return {
    financialYears: [...financialYears]
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .map((fy) => ({ code: fy.code, startDate: fy.startDate, endDate: fy.endDate })),
  };
}
