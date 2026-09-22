// H2A Dev master-data preparation (H2A plan §17). A small, dedicated,
// one-time internal command — not a permanent public API/UI — that
// prepares APPROVED required master data for the historical import using
// the SAME domain/service logic normal application code uses
// (master-data.service.ts's createSeason), rather than ad-hoc SQL.
//
// Scope is deliberately narrow right now: only the two Season masters
// (AW25, SS26) are created here. Style/Size/StyleSize creation is NOT
// performed by this command in H2A — it remains blocked pending an
// explicit business decision on Style.finalMrp (no source MRP exists and
// none may be invented) and the Size-code convention gap (source uses bare
// digit codes "3".."14"; Dev Size masters use "AGE_<n>" codes) — see
// h2a/master-readiness-plan.json.
//
// This command:
//   - positively verifies the Dev target (dev-target-guard.ts), never a
//     Production-exclusion heuristic
//   - shows the planned counts before writing anything
//   - requires an explicit --confirm-dev-master-write flag
//   - is idempotent: an existing AW25/SS26 Season is verified, not
//     duplicated or renamed
//   - never creates Styles, Sizes, StyleSizes, Style<->Factory mappings,
//     historical Job Orders, ImportBatch, or HistoricalDocument rows
//   - never invokes importHistoricalJobOrder
import { prisma } from '../db/prisma.js';
import { requireVerifiedDevDatabaseTarget, formatDevTargetReport, DevTargetGuardError } from '../modules/historical-import/dev-target-guard.js';
import { createSeason, listSeasons } from '../modules/master-data/master-data.service.js';
import type { CurrentUser } from '../auth/current-user.js';

export class MasterPrepError extends Error {}

/** The two Season masters this story needs, and the Financial Year each belongs to — derived from the source documents' own order/shipment dates (AW25: Aug-Sep 2025; SS26: Feb-Mar 2026), both of which fall inside India FY 2025-26 (Apr 2025 - Mar 2026), not invented. */
export const REQUIRED_SEASONS: Array<{ code: string; name: string; financialYearCode: string }> = [
  { code: 'AW25', name: 'Autumn Winter 2025', financialYearCode: '2025-26' },
  { code: 'SS26', name: 'Spring Summer 2026', financialYearCode: '2025-26' },
];

export interface MasterPrepPlanEntry {
  code: string;
  name: string;
  financialYearCode: string;
  action: 'CREATE' | 'VERIFY_EXISTING';
  existingSeasonId: string | null;
}

export async function planSeasons(): Promise<MasterPrepPlanEntry[]> {
  const existing = await listSeasons({});
  return REQUIRED_SEASONS.map((required) => {
    const match = existing.find((s) => s.code === required.code);
    return {
      code: required.code,
      name: required.name,
      financialYearCode: required.financialYearCode,
      action: match ? 'VERIFY_EXISTING' : 'CREATE',
      existingSeasonId: match?.id ?? null,
    };
  });
}

export interface ApplySeasonsResult {
  created: Array<{ code: string; id: string }>;
  verified: Array<{ code: string; id: string }>;
}

export async function applySeasons(actor: CurrentUser): Promise<ApplySeasonsResult> {
  const target = requireVerifiedDevDatabaseTarget({
    actualDatabaseUrl: process.env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL,
  });
  console.log(formatDevTargetReport(target, 'DEV MASTER-DATA PREPARATION'));
  console.log('');

  const plan = await planSeasons();
  console.log('Planned Season master preparation:');
  for (const entry of plan) {
    console.log(`  ${entry.code} (${entry.name}, FY ${entry.financialYearCode}): ${entry.action}${entry.existingSeasonId ? ` [existing id ${entry.existingSeasonId}]` : ''}`);
  }
  console.log('');

  const created: ApplySeasonsResult['created'] = [];
  const verified: ApplySeasonsResult['verified'] = [];

  for (const entry of plan) {
    if (entry.action === 'VERIFY_EXISTING' && entry.existingSeasonId) {
      verified.push({ code: entry.code, id: entry.existingSeasonId });
      continue;
    }
    const financialYear = await prisma.financialYear.findUnique({ where: { code: entry.financialYearCode } });
    if (!financialYear) {
      throw new MasterPrepError(`Financial Year "${entry.financialYearCode}" does not exist in this Dev database — cannot create Season "${entry.code}"`);
    }
    const season = await createSeason(actor, { code: entry.code, name: entry.name, financialYearId: financialYear.id, status: 'ACTIVE' });
    created.push({ code: entry.code, id: season.id });
  }

  return { created, verified };
}

export { DevTargetGuardError };
