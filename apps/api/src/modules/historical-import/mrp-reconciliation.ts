// MRP / Ex-Factory reconciliation (H2A continuation — MRP/Ex-Factory
// Reconciliation & Final Master Readiness). Pure, DB-free: matches the
// already-approved 91 required Season+LMIX Style identities against the
// business MRP workbook's rows.
//
// Identity matching is Season + LMIX ONLY (H2A plan §5). This module never
// uses description similarity, colour, factory, row position, or MRP amount
// as an identity key — those are used only as corroborating cross-checks,
// recorded on the result but never load-bearing for the match itself. A
// workbook row is matched to a required identity by its Base code, tried
// both directly and via the verified AW25-only digit-transposition (see
// mrp-workbook.ts). If a required identity's Season+LMIX resolves to more
// than one distinct workbook row (whether via one key or across both), or
// to none, it is never guessed — REVIEW_REQUIRED / BLOCKED respectively.
import type { MrpWorkbookRow } from './mrp-workbook.js';
import { transposedBaseCodeDigits } from './mrp-workbook.js';

export interface RequiredStyleIdentity {
  season: string;
  lmix: string;
  legacyReferenceNumbers: string[];
  /** The historical PO's own supplier ex-factory rate for this Style, if known — cross-check only, never identity. */
  historicalSupplierRate: number | null;
  colour: string | null;
  factory: string | null;
  description: string | null;
}

export type MrpDisposition = 'RESOLVED' | 'REVIEW_REQUIRED' | 'BLOCKED';

export interface MrpReconciliationRecord {
  season: string;
  lmix: string;
  legacyReferenceNumbers: string[];
  workbookRow: number | null;
  matchMethod: 'DIRECT' | 'DIGIT_TRANSPOSED' | null;
  businessMrp: number | null;
  businessExFactoryCost: number | null;
  historicalSupplierRate: number | null;
  /** True/false when both values are known, null when either is unavailable to compare. */
  rateAgreement: boolean | null;
  currentDevStyleId: string | null;
  currentDevFinalMrp: number | null;
  disposition: MrpDisposition;
  reason: string | null;
}

function normalizeSeason(value: string): string {
  return value.replace(/[-\s]/g, '').toUpperCase();
}

function lmixDigits(lmix: string): string {
  return lmix.replace(/^LMIX/i, '');
}

interface CandidateRow {
  row: MrpWorkbookRow;
  method: 'DIRECT' | 'DIGIT_TRANSPOSED';
}

function buildCandidateIndex(workbookRows: MrpWorkbookRow[]): Map<string, CandidateRow[]> {
  const index = new Map<string, CandidateRow[]>();
  const push = (key: string, candidate: CandidateRow) => {
    const existing = index.get(key);
    if (existing) existing.push(candidate);
    else index.set(key, [candidate]);
  };
  for (const row of workbookRows) {
    if (!row.season || !row.baseCodeDigits) continue;
    push(`${row.season}::${row.baseCodeDigits}`, { row, method: 'DIRECT' });
    const transposed = transposedBaseCodeDigits(row.baseCodeDigits);
    if (transposed) push(`${row.season}::${transposed}`, { row, method: 'DIGIT_TRANSPOSED' });
  }
  return index;
}

export interface CurrentDevStyleLookup {
  findBySeasonAndLmix(season: string, lmix: string): { id: string; finalMrp: number | null } | null;
}

export interface ReconcileMrpResult {
  records: MrpReconciliationRecord[];
  /** Workbook rows never matched to any required identity — candidates for OUTSIDE_CURRENT_HISTORICAL_JO_SCOPE (H2A plan §8). */
  extraWorkbookRows: MrpWorkbookRow[];
}

export function reconcileMrp(
  identities: RequiredStyleIdentity[],
  workbookRows: MrpWorkbookRow[],
  currentDevStyles?: CurrentDevStyleLookup,
): ReconcileMrpResult {
  const index = buildCandidateIndex(workbookRows);
  const consumedExcelRows = new Set<number>();
  const records: MrpReconciliationRecord[] = [];

  for (const identity of identities) {
    const season = normalizeSeason(identity.season);
    const digits = lmixDigits(identity.lmix);
    const candidates = index.get(`${season}::${digits}`) ?? [];
    const distinctRows = new Map<number, CandidateRow>();
    for (const c of candidates) distinctRows.set(c.row.excelRow, c);
    const currentDevStyle = currentDevStyles?.findBySeasonAndLmix(identity.season, identity.lmix) ?? null;

    const base = {
      season: identity.season,
      lmix: identity.lmix,
      legacyReferenceNumbers: identity.legacyReferenceNumbers,
      historicalSupplierRate: identity.historicalSupplierRate,
      currentDevStyleId: currentDevStyle?.id ?? null,
      currentDevFinalMrp: currentDevStyle?.finalMrp ?? null,
    };

    if (distinctRows.size === 0) {
      records.push({
        ...base,
        workbookRow: null,
        matchMethod: null,
        businessMrp: null,
        businessExFactoryCost: null,
        rateAgreement: null,
        disposition: 'BLOCKED',
        reason: 'No workbook row matches this Season + LMIX (checked both the direct Base code and the verified AW25 digit-transposed form)',
      });
      continue;
    }
    if (distinctRows.size > 1) {
      records.push({
        ...base,
        workbookRow: null,
        matchMethod: null,
        businessMrp: null,
        businessExFactoryCost: null,
        rateAgreement: null,
        disposition: 'REVIEW_REQUIRED',
        reason: `${distinctRows.size} distinct workbook rows match this Season + LMIX (rows ${[...distinctRows.keys()].join(', ')}) — ambiguous, not auto-resolved`,
      });
      continue;
    }

    const { row, method } = [...distinctRows.values()][0]!;
    consumedExcelRows.add(row.excelRow);

    if (row.mrp === null) {
      records.push({
        ...base,
        workbookRow: row.excelRow,
        matchMethod: method,
        businessMrp: null,
        businessExFactoryCost: row.exFactoryCost,
        rateAgreement: null,
        disposition: 'BLOCKED',
        reason: `Matched workbook row ${row.excelRow} has no valid positive MRP`,
      });
      continue;
    }

    const rateAgreement =
      identity.historicalSupplierRate !== null && row.exFactoryCost !== null
        ? identity.historicalSupplierRate === row.exFactoryCost
        : null;

    if (rateAgreement === false) {
      records.push({
        ...base,
        workbookRow: row.excelRow,
        matchMethod: method,
        businessMrp: row.mrp,
        businessExFactoryCost: row.exFactoryCost,
        rateAgreement,
        disposition: 'REVIEW_REQUIRED',
        reason: `Workbook ex-factory cost (${row.exFactoryCost}) disagrees with the historical PO supplier rate (${identity.historicalSupplierRate}) for this identity — possible identity mismatch, not auto-resolved`,
      });
      continue;
    }

    records.push({
      ...base,
      workbookRow: row.excelRow,
      matchMethod: method,
      businessMrp: row.mrp,
      businessExFactoryCost: row.exFactoryCost,
      rateAgreement,
      disposition: 'RESOLVED',
      reason: null,
    });
  }

  const extraWorkbookRows = workbookRows.filter((row) => !consumedExcelRows.has(row.excelRow));
  return { records, extraWorkbookRows };
}

export type ExFactoryDisposition = 'MATCH' | 'NEW_MAPPING_RATE' | 'REVIEW_CONFLICT';

export interface ExFactoryReconciliationInput {
  season: string;
  lmix: string;
  factory: string | null;
  businessExFactoryCost: number | null;
  historicalSupplierRate: number | null;
  /** The rate on an existing current Dev StyleFactoryMapping for this Style+Factory, if one already exists. */
  currentDevMappingRate: number | null;
}

export interface ExFactoryReconciliationRecord extends ExFactoryReconciliationInput {
  disposition: ExFactoryDisposition;
  reason: string;
}

/**
 * Compares the business workbook's ex-factory cost against (1) the
 * historical PO's own supplier rate and (2) any existing current Dev
 * Style<->Factory mapping rate for the same Style+Factory (H2A plan §7).
 * The three are explicitly NOT assumed to always agree — a
 * historical-vs-business rate difference is recorded but does not, by
 * itself, block anything; only a conflict against an EXISTING current Dev
 * mapping rate is ever REVIEW_CONFLICT (silently overwriting a live
 * commercial rate is never acceptable), and a genuinely new mapping (no
 * current row yet) with an unambiguous business rate is NEW_MAPPING_RATE.
 */
export function reconcileExFactory(inputs: ExFactoryReconciliationInput[]): ExFactoryReconciliationRecord[] {
  return inputs.map((input) => {
    if (input.businessExFactoryCost === null) {
      return { ...input, disposition: 'REVIEW_CONFLICT', reason: 'No usable business ex-factory cost for this Style+Factory' };
    }
    if (input.currentDevMappingRate !== null) {
      if (input.currentDevMappingRate === input.businessExFactoryCost) {
        return { ...input, disposition: 'MATCH', reason: 'Business workbook rate matches the existing current Dev Style<->Factory mapping rate' };
      }
      return {
        ...input,
        disposition: 'REVIEW_CONFLICT',
        reason: `Existing current Dev mapping rate (${input.currentDevMappingRate}) differs from the business workbook rate (${input.businessExFactoryCost}) — never silently overwritten`,
      };
    }
    const historicalNote =
      input.historicalSupplierRate !== null && input.historicalSupplierRate !== input.businessExFactoryCost
        ? ` (note: differs from the historical PO supplier rate ${input.historicalSupplierRate} — historical evidence is left unaltered)`
        : '';
    return {
      ...input,
      disposition: 'NEW_MAPPING_RATE',
      reason: `No current Dev Style<->Factory mapping exists yet; business workbook supplies an unambiguous rate${historicalNote}`,
    };
  });
}
