// H2A continuation — MRP / Ex-Factory Reconciliation & Final Master
// Readiness. Structurally read-only (same discipline as historical-import.ts's
// dry run): reads the business MRP workbook from disk, reads Dev master
// data read-only for cross-checks, and writes ONLY diagnostic artifact
// files under .artifacts/historical-import/AW25-SS26/h2a/ — never a Style,
// StyleSize, StyleFactoryMapping, or any transaction row. The real
// workbook itself is never modified and never copied into the artifact
// tree (it stays under the immutable, gitignored source directory);
// only its SHA-256/size/structure and the derived reconciliation are
// recorded.
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { prisma } from '../db/prisma.js';
import { requireVerifiedDevDatabaseTarget, formatDevTargetReport, DevTargetGuardError } from '../modules/historical-import/dev-target-guard.js';
import { parseMrpWorkbookRows, type MrpWorkbookRow } from '../modules/historical-import/mrp-workbook.js';
import {
  reconcileMrp,
  reconcileExFactory,
  type RequiredStyleIdentity,
  type MrpReconciliationRecord,
  type ExFactoryReconciliationRecord,
  type CurrentDevStyleLookup,
} from '../modules/historical-import/mrp-reconciliation.js';
import { parseFactoryMappingArtifact, type FactoryMappingRow } from '../modules/historical-import/factory-mapping.js';
import {
  parseSourceOverridesArtifact,
  resolveApprovedOverridesForRecord,
  applyApprovedOverrides,
  type SourceOverrideEntry,
} from '../modules/historical-import/source-overrides.js';
import { reconcileFactory } from '../modules/historical-import/reconciliation.service.js';
import { stagingToParsedRecord } from './historical-import.js';
import type { SourceStagingRecord } from '../modules/historical-import/staging.service.js';
import type { ParsedPurchaseOrderRecord } from '../modules/historical-import/po-pdf-parser.types.js';

export class MrpAuditError extends Error {}

export interface MrpWorkbookManifest {
  sourceFile: string;
  sha256: string;
  sizeBytes: number;
  sheetNames: string[];
  activeSheetName: string;
  headerRow: unknown[];
  totalDataRows: number;
  generatedAt: string;
  /** The xlsx (SheetJS) library version used to parse this workbook, for reproducibility. */
  parserToolVersion: string;
}

export async function buildMrpWorkbookManifest(workbookPath: string): Promise<{ manifest: MrpWorkbookManifest; rows: MrpWorkbookRow[] }> {
  const buffer = await readFile(workbookPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const stats = await stat(workbookPath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = wb.SheetNames;
  if (sheetNames.length === 0) throw new MrpAuditError(`Workbook "${workbookPath}" has no sheets`);
  const activeSheetName = sheetNames[0]!;
  const sheet = wb.Sheets[activeSheetName]!;
  const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const rows = parseMrpWorkbookRows(sheetRows);
  const manifest: MrpWorkbookManifest = {
    sourceFile: workbookPath,
    sha256,
    sizeBytes: stats.size,
    sheetNames,
    activeSheetName,
    headerRow: sheetRows[0] ?? [],
    totalDataRows: rows.length,
    generatedAt: new Date().toISOString(),
    parserToolVersion: `xlsx@${(XLSX as unknown as { version?: string }).version ?? 'unknown'}`,
  };
  return { manifest, rows };
}

/**
 * Applies APPROVED source-overrides in-memory on top of every staged order
 * (same effective values the H2A dry run itself uses) — never re-derived
 * from the new business workbook, per H2A plan §5/§10 ("Preserve ...
 * source-supported description/classification values"). source-staging.json
 * on disk is never modified.
 */
export async function buildEffectiveSourceRecords(
  stagingFilePath: string,
  sourceOverridesFilePath?: string,
): Promise<ParsedPurchaseOrderRecord[]> {
  const stagingRecords = JSON.parse(await readFile(stagingFilePath, 'utf8')) as SourceStagingRecord[];
  let overrideEntries: SourceOverrideEntry[] = [];
  if (sourceOverridesFilePath) {
    overrideEntries = parseSourceOverridesArtifact(JSON.parse(await readFile(sourceOverridesFilePath, 'utf8')));
  }
  return stagingRecords.map((staging) => {
    const parsed = stagingToParsedRecord(staging);
    const approvedOverrides = resolveApprovedOverridesForRecord(overrideEntries, {
      sourceFileName: staging.sourceFileName,
      sourceChecksumSha256: staging.sourceChecksumSha256,
    });
    return applyApprovedOverrides(parsed, approvedOverrides).record;
  });
}

/**
 * Builds the 91 required Season+LMIX Style identities from the effective
 * (post-approved-override) source records. Every one of the 91 source
 * orders here is 1:1 with a unique effective Season+LMIX (no order shares
 * its Style with another), verified at generation time; if a future source
 * ever violates that, multiple legacyReferenceNumbers are still recorded on
 * the one identity rather than silently deduplicated.
 */
export function buildRequiredIdentities(effectiveRecords: ParsedPurchaseOrderRecord[]): RequiredStyleIdentity[] {
  const identities: RequiredStyleIdentity[] = [];
  for (const record of effectiveRecords) {
    const season = record.documentSeason.value;
    const lmix = record.licenseStyleLmix.value;
    const legacyRef = record.legacyReferenceNumber.value;
    if (!season || !lmix) continue;
    const existing = identities.find((i) => i.season === season && i.lmix === lmix);
    const rateValue = record.unitRate.value ? Number(record.unitRate.value) : null;
    const historicalSupplierRate = rateValue !== null && Number.isFinite(rateValue) ? rateValue : null;
    if (existing) {
      if (legacyRef && !existing.legacyReferenceNumbers.includes(legacyRef)) existing.legacyReferenceNumbers.push(legacyRef);
      continue;
    }
    identities.push({
      season,
      lmix,
      legacyReferenceNumbers: legacyRef ? [legacyRef] : [],
      historicalSupplierRate,
      colour: record.colour.value,
      factory: record.factoryName.value,
      description: [record.styleName.value, record.description.value].filter((v): v is string => Boolean(v)).join(' / '),
    });
  }
  return identities;
}

export async function buildRequiredIdentitiesFromSourceStaging(
  stagingFilePath: string,
  sourceOverridesFilePath?: string,
): Promise<RequiredStyleIdentity[]> {
  const effectiveRecords = await buildEffectiveSourceRecords(stagingFilePath, sourceOverridesFilePath);
  return buildRequiredIdentities(effectiveRecords);
}

function makePrismaStyleLookup(seasonIdByCode: Map<string, string>, styles: Array<{ lmixNumber: string | null; seasonId: string; id: string; finalMrp: unknown }>): CurrentDevStyleLookup {
  return {
    findBySeasonAndLmix(season, lmix) {
      const seasonId = seasonIdByCode.get(season);
      if (!seasonId) return null;
      const match = styles.find((s) => s.seasonId === seasonId && s.lmixNumber === lmix);
      if (!match) return null;
      return { id: match.id, finalMrp: match.finalMrp === null ? null : Number(match.finalMrp) };
    },
  };
}

export interface StyleIdentityVerificationReport {
  generatedAt: string;
  expectedIdentityCount: number;
  matched: number;
  unmatched: number;
  duplicateWorkbookIdentities: Array<{ season: string; baseCodeDigits: string; excelRows: number[] }>;
  conflicting: Array<{ season: string; lmix: string; reason: string }>;
  extraWorkbookRowCount: number;
}

export interface MrpAuditOptions {
  workbookPath: string;
  stagingFilePath: string;
  sourceOverridesFilePath?: string;
  factoryMappingFilePath?: string;
  outputDir: string;
}

export interface MrpAuditResult {
  manifest: MrpWorkbookManifest;
  mrpRecords: MrpReconciliationRecord[];
  exFactoryRecords: ExFactoryReconciliationRecord[];
  extraWorkbookRows: MrpWorkbookRow[];
  identityVerification: StyleIdentityVerificationReport;
  manifestPath: string;
  mrpReconciliationPath: string;
  exFactoryReconciliationPath: string;
  identityVerificationPath: string;
}

function findDuplicateWorkbookIdentities(rows: MrpWorkbookRow[]): Array<{ season: string; baseCodeDigits: string; excelRows: number[] }> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.season || !row.baseCodeDigits) continue;
    const key = `${row.season}::${row.baseCodeDigits}`;
    const existing = byKey.get(key);
    if (existing) existing.push(row.excelRow);
    else byKey.set(key, [row.excelRow]);
  }
  const duplicates: Array<{ season: string; baseCodeDigits: string; excelRows: number[] }> = [];
  for (const [key, excelRows] of byKey) {
    if (excelRows.length > 1) {
      const [season, baseCodeDigits] = key.split('::');
      duplicates.push({ season: season!, baseCodeDigits: baseCodeDigits!, excelRows });
    }
  }
  return duplicates;
}

export async function runMrpAudit(options: MrpAuditOptions): Promise<MrpAuditResult> {
  const target = requireVerifiedDevDatabaseTarget({
    actualDatabaseUrl: process.env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL,
  });
  console.log(formatDevTargetReport(target, 'READ ONLY BUSINESS DATA'));
  console.log('');

  const { manifest, rows } = await buildMrpWorkbookManifest(options.workbookPath);
  const identities = await buildRequiredIdentitiesFromSourceStaging(options.stagingFilePath, options.sourceOverridesFilePath);

  let factoryMappings: FactoryMappingRow[] | undefined;
  if (options.factoryMappingFilePath) {
    factoryMappings = parseFactoryMappingArtifact(JSON.parse(await readFile(options.factoryMappingFilePath, 'utf8')));
  }

  const [seasons, styles] = await Promise.all([
    prisma.season.findMany({ select: { id: true, code: true } }),
    prisma.style.findMany({ select: { id: true, lmixNumber: true, seasonId: true, finalMrp: true } }),
  ]);
  const seasonIdByCode = new Map(seasons.map((s) => [s.code, s.id] as const));
  const styleLookup = makePrismaStyleLookup(seasonIdByCode, styles);

  const { records: mrpRecords, extraWorkbookRows } = reconcileMrp(identities, rows, styleLookup);

  const exFactoryInputs = await Promise.all(
    mrpRecords
      .filter((r) => r.disposition === 'RESOLVED')
      .map(async (r) => {
        const factoryReconciliation = await reconcileFactory(prisma, r.legacyReferenceNumbers.length > 0 ? (identities.find((i) => i.season === r.season && i.lmix === r.lmix)?.factory ?? null) : null, factoryMappings);
        let currentDevMappingRate: number | null = null;
        if (r.currentDevStyleId && factoryReconciliation.factoryId) {
          const mapping = await prisma.styleFactoryMapping.findUnique({
            where: { styleId_factoryId: { styleId: r.currentDevStyleId, factoryId: factoryReconciliation.factoryId } },
          });
          currentDevMappingRate = mapping ? Number(mapping.exFactoryPrice) : null;
        }
        return {
          season: r.season,
          lmix: r.lmix,
          factory: factoryReconciliation.sourceValue,
          businessExFactoryCost: r.businessExFactoryCost,
          historicalSupplierRate: r.historicalSupplierRate,
          currentDevMappingRate,
        };
      }),
  );
  const exFactoryRecords = reconcileExFactory(exFactoryInputs);

  const duplicateWorkbookIdentities = findDuplicateWorkbookIdentities(rows);
  const conflicting = mrpRecords
    .filter((r) => r.disposition === 'REVIEW_REQUIRED')
    .map((r) => ({ season: r.season, lmix: r.lmix, reason: r.reason ?? 'REVIEW_REQUIRED' }));
  const identityVerification: StyleIdentityVerificationReport = {
    generatedAt: new Date().toISOString(),
    expectedIdentityCount: identities.length,
    matched: mrpRecords.filter((r) => r.disposition === 'RESOLVED').length,
    unmatched: mrpRecords.filter((r) => r.disposition === 'BLOCKED').length,
    duplicateWorkbookIdentities,
    conflicting,
    extraWorkbookRowCount: extraWorkbookRows.length,
  };

  const manifestPath = join(options.outputDir, 'mrp-workbook-manifest.json');
  const mrpReconciliationPath = join(options.outputDir, 'mrp-reconciliation.json');
  const exFactoryReconciliationPath = join(options.outputDir, 'ex-factory-reconciliation.json');
  const identityVerificationPath = join(options.outputDir, 'style-identity-verification.json');

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(
    mrpReconciliationPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'H2A continuation — MRP reconciliation of the 91 required Season+LMIX Style identities against the business-supplied MRP & Ex factory cost.xlsx workbook. Identity match is Season+LMIX only (H2A plan §5); the workbook has no explicit LMIX column, so its numeric Base code is matched both directly and via the verified AW25-only digit-transposition (mrp-workbook.ts) — never fuzzy, never by description/colour/rate alone. Rate agreement against the historical PO supplier rate is recorded as a cross-check only.',
        workbookManifest: manifestPath,
        totalRequiredIdentities: identities.length,
        resolved: mrpRecords.filter((r) => r.disposition === 'RESOLVED').length,
        reviewRequired: mrpRecords.filter((r) => r.disposition === 'REVIEW_REQUIRED').length,
        blocked: mrpRecords.filter((r) => r.disposition === 'BLOCKED').length,
        records: mrpRecords,
        extraWorkbookRows,
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    exFactoryReconciliationPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'H2A continuation — Ex-factory cost reconciliation (H2A plan §7). Compares the business workbook rate against the historical PO supplier rate and any existing current Dev Style<->Factory mapping rate. An existing current mapping is never silently overwritten (REVIEW_CONFLICT); a genuinely new mapping with an unambiguous business rate is NEW_MAPPING_RATE.',
        records: exFactoryRecords,
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(identityVerificationPath, JSON.stringify(identityVerification, null, 2), 'utf8');

  return {
    manifest,
    mrpRecords,
    exFactoryRecords,
    extraWorkbookRows,
    identityVerification,
    manifestPath,
    mrpReconciliationPath,
    exFactoryReconciliationPath,
    identityVerificationPath,
  };
}

export { DevTargetGuardError };
