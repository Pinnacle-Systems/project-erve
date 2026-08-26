import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { computeFinancialYearWindow, toBusinessCalendarDate } from './financial-year.util.js';

type Tx = Prisma.TransactionClient;
// Exported so the production financial-year-bootstrap CLI (and anything
// else outside this module that needs to call ensureFinancialYear/
// ensureFinancialYearWindow) can type its own `$transaction` callback
// without reaching into this module's private types.
export type FinancialYearServiceClient = Tx | typeof prisma;
type Client = FinancialYearServiceClient;

/**
 * Create-or-VALIDATE, never create-or-update. A FinancialYear's window is
 * historically stable — silently overwriting startDate/endDate on an
 * existing row (e.g. because the resolver logic changes later) would be a
 * correctness bug, not a convenience. This is the ONLY function in the
 * codebase allowed to create a FinancialYear row; call it from PO/JO
 * creation inside their own transaction, or from seeding.
 *
 * A naive INSERT -> catch unique-violation -> SELECT inside an existing
 * transaction is unsafe: a failed statement poisons the rest of a Postgres
 * transaction ("current transaction is aborted"), so the fallback SELECT
 * would itself fail. `ON CONFLICT (code) DO NOTHING` never raises, so this
 * is safe even when called concurrently for a brand-new code.
 */
export async function ensureFinancialYear(client: Client, businessDate: Date) {
  const window = computeFinancialYearWindow(businessDate);
  await client.$executeRaw`
    INSERT INTO financial_years (id, code, start_date, end_date, created_at, updated_at)
    VALUES (${createId()}, ${window.code}, ${window.startDate}, ${window.endDate}, now(), now())
    ON CONFLICT (code) DO NOTHING
  `;
  const existing = await client.financialYear.findUniqueOrThrow({ where: { code: window.code } });
  if (
    existing.startDate.getTime() !== window.startDate.getTime() ||
    existing.endDate.getTime() !== window.endDate.getTime()
  ) {
    throw HttpError.financialYearIntegrityMismatch(window.code, existing, window);
  }
  return existing;
}

// Shared by the dev/test seed script (prisma/seed.ts) and the production
// financial-year-bootstrap CLI, so the two can never drift onto different
// windows. A rolling window (not just the current year) matters because
// Purchase Order / Job Order creation dates and Season planning both
// routinely reference adjacent Financial Years (a document dated just
// after the FY boundary, a Season being set up ahead of the year it
// belongs to) — restricting this to only "today's" year would just move
// the FINANCIAL_YEAR_NOT_SEEDED failure to those cases instead of
// eliminating it.
export async function ensureFinancialYearWindow(
  client: Client,
  referenceDate: Date,
  { yearsBack = 3, yearsForward = 5 }: { yearsBack?: number; yearsForward?: number } = {},
) {
  const businessDate = toBusinessCalendarDate(referenceDate);
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  const financialYears = [];
  for (let offset = -yearsBack; offset <= yearsForward; offset += 1) {
    financialYears.push(await ensureFinancialYear(client, new Date(Date.UTC(year + offset, month, 1))));
  }
  return financialYears;
}

export async function getFinancialYearById(id: string) {
  const financialYear = await prisma.financialYear.findUnique({ where: { id } });
  if (!financialYear) throw HttpError.notFound('Financial Year not found');
  return financialYear;
}

export async function listFinancialYears() {
  return prisma.financialYear.findMany({ orderBy: { startDate: 'desc' } });
}

/**
 * Read-only. Computes today's Financial Year window and looks up the
 * persisted row — it never calls `ensureFinancialYear` itself (a GET path
 * must not create data). `seedFinancialYears()` is what guarantees the
 * current year is always already seeded; a missing row here means seeding
 * didn't run, which is an initialization problem to surface, not paper over.
 */
export async function getCurrentFinancialYear() {
  const window = computeFinancialYearWindow(toBusinessCalendarDate(new Date()));
  const financialYear = await prisma.financialYear.findUnique({ where: { code: window.code } });
  if (!financialYear) throw HttpError.financialYearNotSeeded(window.code);
  return financialYear;
}
