// H2A continuation — Dev master-data write step for the 91 required Style
// identities, unblocked now that the business has supplied
// Style.finalMrp/ex-factory cost (MRP & Ex factory cost.xlsx). Mirrors
// historical-import-master-prep.ts's discipline: reuses the SAME
// domain/service logic normal application code uses (createStyle,
// addStyleSize, addStyleFactory in master-data.service.ts), never raw SQL;
// positively verifies the Dev target; shows the planned counts before
// writing anything; requires an explicit --confirm-dev-master-write flag;
// is idempotent (an existing Style/StyleSize/StyleFactoryMapping is
// verified, never duplicated or silently overwritten).
//
// Allowed writes ONLY: Style, StyleSize, StyleFactoryMapping. This file
// never creates a historical Job Order, ImportBatch, HistoricalDocument, or
// any transaction/queue row (H2A plan §9) — it has no dependency at all on
// historical-import.service.ts's importHistoricalJobOrder.
import { readFile } from 'node:fs/promises';
import { prisma } from '../db/prisma.js';
import { requireVerifiedDevDatabaseTarget, formatDevTargetReport, DevTargetGuardError } from '../modules/historical-import/dev-target-guard.js';
import { createStyle, updateStyle, addStyleSize, addStyleFactory } from '../modules/master-data/master-data.service.js';
import { parseFactoryMappingArtifact, type FactoryMappingRow } from '../modules/historical-import/factory-mapping.js';
import { parseSizeMappingArtifact, resolveApprovedSizeMapping, type SizeMappingRow } from '../modules/historical-import/size-mapping.js';
import { reconcileMrp, type RequiredStyleIdentity } from '../modules/historical-import/mrp-reconciliation.js';
import { buildMrpWorkbookManifest, buildEffectiveSourceRecords, buildRequiredIdentities } from './historical-import-mrp-audit.js';
import { normalizeMrpCategory, type MrpWorkbookRow } from '../modules/historical-import/mrp-workbook.js';
import type { ParsedPurchaseOrderRecord } from '../modules/historical-import/po-pdf-parser.types.js';
import type { CurrentUser } from '../auth/current-user.js';
import { requireDocumentarySections } from '../modules/historical-import/documentary-sections.js';
import { resolveHsnSourceDescription, type HsnDescriptionResolution } from '../modules/historical-import/hsn-description.js';

export class StylePrepError extends Error {}

export type MasterAction = 'CREATE' | 'VERIFY_EXISTING' | 'SKIPPED' | 'BLOCKED';

export interface SizePlanEntry {
  sourceSizeCode: string;
  targetSizeCode: string | null;
  targetSizeId: string | null;
  action: MasterAction;
  reason: string | null;
}

export interface FactoryPlanEntry {
  factorySourceName: string | null;
  factoryId: string | null;
  exFactoryPrice: number | null;
  action: MasterAction;
  reason: string | null;
}

export interface StylePlanEntry {
  season: string;
  lmix: string;
  legacyReferenceNumbers: string[];
  action: MasterAction;
  reason: string | null;
  existingStyleId: string | null;
  seasonId: string | null;
  styleNumber: string;
  styleName: string | null;
  description: string | null;
  colour: string | null;
  hsnCode: string | null;
  /** Source-provided HS label (Policy C, hsn-description.ts) — null for code-only and review-required sources. */
  hsnDescription: string | null;
  /** Full Policy C evidence for the audit report; null only when no effective source record exists. */
  hsnDescriptionSource: HsnDescriptionResolution | null;
  /** Source-document identity (never the printed legacy reference — see hsn-refresh.ts). */
  sourceChecksumSha256: string | null;
  sourceFileName: string | null;
  ipName: string | null;
  licensor: string | null;
  /** Raw MRP workbook Category cell, unaltered (audit evidence). */
  categoryRaw: string | null;
  /** categoryRaw with a single trailing separator hyphen stripped — see normalizeMrpCategory. This is the value written to Style.categoryDescription. */
  categoryNormalized: string | null;
  categoryNormalizationApplied: boolean;
  finalMrp: number | null;
  sizes: SizePlanEntry[];
  factory: FactoryPlanEntry | null;
}

export interface StylePrepOptions {
  workbookPath: string;
  stagingFilePath: string;
  sourceOverridesFilePath?: string;
  factoryMappingFilePath?: string;
  sizeMappingFilePath?: string;
  /**
   * Optional hsnCode override, keyed by sourceChecksumSha256 (NOT
   * legacyReferenceNumber — see hsn-refresh.ts for why: one source PDF's
   * raw printed order number is a known typo of another's), re-derived
   * directly from the source PDFs with the current extractHsnCode
   * implementation. staging.json is an immutable H2B.1 artifact and is
   * never rewritten in place, so a parser fix only reaches an
   * already-staged identity through this override — a fresh future import
   * needs no override at all, since re-running historical-import:prepare
   * regenerates staging.json with the fixed parser directly.
   */
  hsnRefreshBySourceChecksum?: Map<string, string | null>;
}

async function loadIdentitiesAndWorkbook(options: StylePrepOptions) {
  const { rows } = await buildMrpWorkbookManifest(options.workbookPath);
  const effectiveRecords = await buildEffectiveSourceRecords(options.stagingFilePath, options.sourceOverridesFilePath);
  // A clean future import must not consume the old, incomplete H1 text.
  // H2B.1 emits a new reconciled staging artifact; the original stays intact.
  for (const record of effectiveRecords) {
    const sections = requireDocumentarySections(record.documentarySections);
    if (record.description.value !== sections.styleDescription && record.description.provenance !== 'OVERRIDE') {
      throw new StylePrepError('Staged description differs from its documentary extraction');
    }
  }
  const identities = buildRequiredIdentities(effectiveRecords);
  return { rows, effectiveRecords, identities };
}

function findEffectiveRecordForIdentity(
  effectiveRecords: ParsedPurchaseOrderRecord[],
  identity: RequiredStyleIdentity,
): ParsedPurchaseOrderRecord | null {
  return (
    effectiveRecords.find(
      (r) => r.documentSeason.value === identity.season && r.licenseStyleLmix.value === identity.lmix,
    ) ?? null
  );
}

function findWorkbookRow(rows: MrpWorkbookRow[], excelRow: number | null): MrpWorkbookRow | null {
  if (excelRow === null) return null;
  return rows.find((r) => r.excelRow === excelRow) ?? null;
}

/** Source-derived Style fields shared by the Dev planner and the H3A DB-free bundle builder — one definition, never two. */
function deriveStyleSourceFields(
  mrpRecord: { season: string; lmix: string },
  identity: RequiredStyleIdentity,
  effectiveRecords: ParsedPurchaseOrderRecord[],
  rows: MrpWorkbookRow[],
  workbookRowNumber: number | null,
  options: StylePrepOptions,
) {
  // SYSTEM-GENERATED, not a source-document value — see planStyles.
  const styleNumber = `${mrpRecord.season}-${mrpRecord.lmix.replace(/^LMIX/i, '')}`;
  const effectiveRecord = findEffectiveRecordForIdentity(effectiveRecords, identity);
  const workbookRow = findWorkbookRow(rows, workbookRowNumber);
  const category = normalizeMrpCategory(workbookRow?.category ?? null);
  const refreshedHsn = effectiveRecord ? options.hsnRefreshBySourceChecksum?.get(effectiveRecord.sourceChecksumSha256) : undefined;
  const hsnCode = refreshedHsn !== undefined ? refreshedHsn : (effectiveRecord?.hsnCode.value ?? null);
  const hsnDescriptionSource = effectiveRecord
    ? resolveHsnSourceDescription({
        specificationText: effectiveRecord.documentarySections?.specificationText,
        tableDescription: effectiveRecord.documentarySections?.tableDescription,
        tableStyleName: effectiveRecord.documentarySections?.tableStyleName,
        expectedHsnCode: hsnCode,
      })
    : null;
  return {
    styleNumber,
    effectiveRecord,
    workbookRow,
    category,
    hsnFields: {
      hsnCode,
      hsnDescription: hsnDescriptionSource?.proposedHsnDescription ?? null,
      hsnDescriptionSource,
      sourceChecksumSha256: effectiveRecord?.sourceChecksumSha256 ?? null,
      sourceFileName: effectiveRecord?.sourceFileName ?? null,
    },
  };
}

/** H3A: environment-independent Style master spec — business keys and approved values only, no database ids. */
export interface StyleSourceSpec {
  season: string;
  lmix: string;
  legacyReferenceNumbers: string[];
  styleNumber: string;
  styleName: string;
  description: string | null;
  colour: string | null;
  hsnCode: string | null;
  hsnDescription: string | null;
  hsnDescriptionClassification: string | null;
  hsnCodeSourceSuspect: boolean;
  categoryRaw: string | null;
  categoryDescription: string | null;
  categoryNormalizationApplied: boolean;
  ipName: string | null;
  licensor: string | null;
  finalMrp: number;
  exFactoryPrice: number;
  /** Raw factory name as printed in the source PO (resolved through the approved factory mapping later). */
  sourceFactoryName: string;
  /** Raw size codes as printed in the source PO, in source order. */
  sourceSizeCodes: string[];
  sourceChecksumSha256: string;
  sourceFileName: string;
}

/**
 * H3A: the DB-free half of planStyles. Every one of the required identities
 * must be MRP-RESOLVED with a style name, a factory, sizes and an
 * ex-factory cost, or this throws — a bundle is never built from a
 * partially-resolved source set.
 */
export async function buildStyleSourceSpecs(options: StylePrepOptions): Promise<StyleSourceSpec[]> {
  const { rows, effectiveRecords, identities } = await loadIdentitiesAndWorkbook(options);
  const { records: mrpRecords } = reconcileMrp(identities, rows);
  const specs: StyleSourceSpec[] = [];
  for (const mrpRecord of mrpRecords) {
    const identity = identities.find((i) => i.season === mrpRecord.season && i.lmix === mrpRecord.lmix)!;
    const label = `${mrpRecord.season} ${mrpRecord.lmix}`;
    if (mrpRecord.disposition !== 'RESOLVED' || mrpRecord.businessMrp === null || mrpRecord.businessExFactoryCost === null) {
      throw new StylePrepError(`${label}: MRP/ex-factory not RESOLVED (${mrpRecord.reason ?? mrpRecord.disposition})`);
    }
    const { styleNumber, effectiveRecord, workbookRow, category, hsnFields } = deriveStyleSourceFields(
      mrpRecord, identity, effectiveRecords, rows, mrpRecord.workbookRow, options,
    );
    if (!effectiveRecord || !effectiveRecord.styleName.value || !identity.factory || effectiveRecord.sizeQuantities.length === 0) {
      throw new StylePrepError(`${label}: effective source record is missing styleName, factory or sizes`);
    }
    specs.push({
      season: mrpRecord.season,
      lmix: mrpRecord.lmix,
      legacyReferenceNumbers: mrpRecord.legacyReferenceNumbers,
      styleNumber,
      styleName: effectiveRecord.styleName.value,
      description: effectiveRecord.description.value ?? null,
      colour: (workbookRow?.colour ?? effectiveRecord.colour.value ?? null)?.trim().toUpperCase() ?? null,
      hsnCode: hsnFields.hsnCode,
      hsnDescription: hsnFields.hsnDescription,
      hsnDescriptionClassification: hsnFields.hsnDescriptionSource?.classification ?? null,
      hsnCodeSourceSuspect: hsnFields.hsnDescriptionSource?.hsnCodeSourceSuspect ?? false,
      categoryRaw: category.categoryRaw,
      categoryDescription: category.categoryNormalized,
      categoryNormalizationApplied: category.normalizationApplied,
      ipName: workbookRow?.ipName?.trim().toUpperCase() ?? null,
      licensor: workbookRow?.licensor?.trim().toUpperCase() ?? null,
      finalMrp: mrpRecord.businessMrp,
      exFactoryPrice: mrpRecord.businessExFactoryCost,
      sourceFactoryName: identity.factory,
      sourceSizeCodes: effectiveRecord.sizeQuantities.map((sq) => sq.sizeCode),
      sourceChecksumSha256: effectiveRecord.sourceChecksumSha256,
      sourceFileName: effectiveRecord.sourceFileName,
    });
  }
  return specs;
}

export async function planStyles(options: StylePrepOptions): Promise<StylePlanEntry[]> {
  const { rows, effectiveRecords, identities } = await loadIdentitiesAndWorkbook(options);

  const [seasons, existingStyles, existingSizes, existingFactories, existingMappings, existingStyleSizes] = await Promise.all([
    prisma.season.findMany({ select: { id: true, code: true } }),
    prisma.style.findMany({ select: { id: true, lmixNumber: true, seasonId: true, finalMrp: true } }),
    prisma.size.findMany({ select: { id: true, code: true, status: true } }),
    prisma.factory.findMany({ select: { id: true, name: true, status: true } }),
    prisma.styleFactoryMapping.findMany({ select: { styleId: true, factoryId: true, exFactoryPrice: true } }),
    prisma.styleSize.findMany({ select: { styleId: true, sizeId: true } }),
  ]);
  const seasonIdByCode = new Map(seasons.map((s) => [s.code, s.id] as const));
  const styleLookup = {
    findBySeasonAndLmix(season: string, lmix: string) {
      const seasonId = seasonIdByCode.get(season);
      if (!seasonId) return null;
      const match = existingStyles.find((s) => s.seasonId === seasonId && s.lmixNumber === lmix);
      return match ? { id: match.id, finalMrp: match.finalMrp === null ? null : Number(match.finalMrp) } : null;
    },
  };

  let factoryMappings: FactoryMappingRow[] | undefined;
  if (options.factoryMappingFilePath) {
    factoryMappings = parseFactoryMappingArtifact(JSON.parse(await readFile(options.factoryMappingFilePath, 'utf8')));
  }
  let sizeMappings: SizeMappingRow[] | undefined;
  if (options.sizeMappingFilePath) {
    sizeMappings = parseSizeMappingArtifact(JSON.parse(await readFile(options.sizeMappingFilePath, 'utf8')));
  }

  const { records: mrpRecords } = reconcileMrp(identities, rows, styleLookup);

  const plan: StylePlanEntry[] = [];
  for (const mrpRecord of mrpRecords) {
    const identity = identities.find((i) => i.season === mrpRecord.season && i.lmix === mrpRecord.lmix)!;
    const seasonId = seasonIdByCode.get(mrpRecord.season) ?? null;
    // SYSTEM-GENERATED, not a source-document value: no authoritative
    // historical Style Number exists; Season + LMIX remain the source-backed
    // identity. Style.styleNumber is globally unique (not scoped by Season), unlike
    // the Season+LMIX identity key. Three pre-existing DEFAULT-season
    // sample/verification Styles already occupy the bare LMIX digits for
    // LMIX39026006/25426015/25426009 (discovered when createStyle first
    // rejected one of these 91 as a duplicate styleNumber) — a bare-digit
    // styleNumber is therefore not safe for ANY of the 91 new Styles, not
    // just the 3 that collide today. Prefixing with the Season code
    // guarantees global uniqueness by construction and stays fully
    // traceable to the approved Season+LMIX identity (no invented data).
    const { styleNumber, effectiveRecord, workbookRow, category, hsnFields } = deriveStyleSourceFields(
      mrpRecord, identity, effectiveRecords, rows, mrpRecord.workbookRow, options,
    );

    if (mrpRecord.disposition !== 'RESOLVED') {
      plan.push({
        season: mrpRecord.season,
        lmix: mrpRecord.lmix,
        legacyReferenceNumbers: mrpRecord.legacyReferenceNumbers,
        action: 'BLOCKED',
        reason: mrpRecord.reason ?? 'MRP not RESOLVED',
        existingStyleId: mrpRecord.currentDevStyleId,
        seasonId,
        styleNumber,
        styleName: effectiveRecord?.styleName.value ?? null,
        description: effectiveRecord?.description.value ?? null,
        colour: workbookRow?.colour ?? effectiveRecord?.colour.value ?? null,
        ...hsnFields,
        ipName: workbookRow?.ipName ?? null,
        licensor: workbookRow?.licensor ?? null,
        categoryRaw: category.categoryRaw,
        categoryNormalized: category.categoryNormalized,
        categoryNormalizationApplied: category.normalizationApplied,
        finalMrp: null,
        sizes: [],
        factory: null,
      });
      continue;
    }

    if (!seasonId) {
      plan.push({
        season: mrpRecord.season,
        lmix: mrpRecord.lmix,
        legacyReferenceNumbers: mrpRecord.legacyReferenceNumbers,
        action: 'BLOCKED',
        reason: `Season "${mrpRecord.season}" does not exist in this Dev database — run historical-import:master-prep first`,
        existingStyleId: null,
        seasonId: null,
        styleNumber,
        styleName: effectiveRecord?.styleName.value ?? null,
        description: effectiveRecord?.description.value ?? null,
        colour: workbookRow?.colour ?? null,
        ...hsnFields,
        ipName: workbookRow?.ipName ?? null,
        licensor: workbookRow?.licensor ?? null,
        categoryRaw: category.categoryRaw,
        categoryNormalized: category.categoryNormalized,
        categoryNormalizationApplied: category.normalizationApplied,
        finalMrp: mrpRecord.businessMrp,
        sizes: [],
        factory: null,
      });
      continue;
    }

    const sizes: SizePlanEntry[] = (effectiveRecord?.sizeQuantities ?? []).map((sq) => {
      let targetSize = existingSizes.find((s) => s.code === sq.sizeCode && s.status === 'ACTIVE');
      let targetSizeCode: string | null = targetSize?.code ?? null;
      if (!targetSize && sizeMappings) {
        const mapped = resolveApprovedSizeMapping(sizeMappings, sq.sizeCode);
        if (mapped) {
          targetSize = existingSizes.find((s) => s.code === mapped && s.status === 'ACTIVE');
          targetSizeCode = targetSize?.code ?? mapped;
        }
      }
      if (!targetSize) {
        return { sourceSizeCode: sq.sizeCode, targetSizeCode, targetSizeId: null, action: 'BLOCKED', reason: `No current ACTIVE Size resolves for source code "${sq.sizeCode}"` };
      }
      const alreadyMapped = mrpRecord.currentDevStyleId
        ? existingStyleSizes.some((ss) => ss.styleId === mrpRecord.currentDevStyleId && ss.sizeId === targetSize!.id)
        : false;
      return { sourceSizeCode: sq.sizeCode, targetSizeCode, targetSizeId: targetSize.id, action: alreadyMapped ? 'VERIFY_EXISTING' : 'CREATE', reason: null };
    });

    let factory: FactoryPlanEntry | null = null;
    if (identity.factory) {
      const normalized = identity.factory.trim().toLowerCase();
      let targetFactory = existingFactories.find((f) => f.name.trim().toLowerCase() === normalized && f.status === 'ACTIVE');
      if (!targetFactory && factoryMappings) {
        const mappedName = factoryMappings.find((m) => m.sourceFactoryName.trim().toLowerCase() === normalized && m.status === 'APPROVED')?.targetFactoryName;
        if (mappedName) targetFactory = existingFactories.find((f) => f.name.trim().toLowerCase() === mappedName.trim().toLowerCase() && f.status === 'ACTIVE');
      }
      if (!targetFactory) {
        factory = { factorySourceName: identity.factory, factoryId: null, exFactoryPrice: null, action: 'BLOCKED', reason: `Factory "${identity.factory}" does not resolve to a current ACTIVE Dev Factory` };
      } else {
        const existingMapping = mrpRecord.currentDevStyleId
          ? existingMappings.find((m) => m.styleId === mrpRecord.currentDevStyleId && m.factoryId === targetFactory!.id)
          : undefined;
        if (existingMapping) {
          const existingRate = Number(existingMapping.exFactoryPrice);
          if (mrpRecord.businessExFactoryCost !== null && existingRate !== mrpRecord.businessExFactoryCost) {
            factory = { factorySourceName: identity.factory, factoryId: targetFactory.id, exFactoryPrice: mrpRecord.businessExFactoryCost, action: 'SKIPPED', reason: `Existing current Dev mapping rate (${existingRate}) differs from the business workbook rate (${mrpRecord.businessExFactoryCost}) — never silently overwritten` };
          } else {
            factory = { factorySourceName: identity.factory, factoryId: targetFactory.id, exFactoryPrice: existingRate, action: 'VERIFY_EXISTING', reason: null };
          }
        } else if (mrpRecord.businessExFactoryCost !== null) {
          factory = { factorySourceName: identity.factory, factoryId: targetFactory.id, exFactoryPrice: mrpRecord.businessExFactoryCost, action: 'CREATE', reason: null };
        } else {
          factory = { factorySourceName: identity.factory, factoryId: targetFactory.id, exFactoryPrice: null, action: 'SKIPPED', reason: 'No usable business ex-factory cost' };
        }
      }
    }

    plan.push({
      season: mrpRecord.season,
      lmix: mrpRecord.lmix,
      legacyReferenceNumbers: mrpRecord.legacyReferenceNumbers,
      action: mrpRecord.currentDevStyleId ? 'VERIFY_EXISTING' : 'CREATE',
      reason: null,
      existingStyleId: mrpRecord.currentDevStyleId,
      seasonId,
      styleNumber,
      styleName: effectiveRecord?.styleName.value ?? null,
      description: effectiveRecord?.description.value ?? null,
      colour: (workbookRow?.colour ?? effectiveRecord?.colour.value ?? null)?.trim().toUpperCase() ?? null,
      ...hsnFields,
      ipName: workbookRow?.ipName?.trim().toUpperCase() ?? null,
      licensor: workbookRow?.licensor?.trim().toUpperCase() ?? null,
      categoryRaw: category.categoryRaw,
      categoryNormalized: category.categoryNormalized,
      categoryNormalizationApplied: category.normalizationApplied,
      finalMrp: mrpRecord.businessMrp,
      sizes,
      factory,
    });
  }

  return plan;
}

export type FieldReconciliationOutcome = 'SET' | 'ALREADY_SET' | 'NO_SOURCE_VALUE' | 'REVIEW_REQUIRED_CONFLICT';

export interface StyleFieldReconciliationDetail {
  season: string;
  legacyReference: string | null;
  lmix: string;
  styleId: string;
  styleNumber: string;
  categoryRaw: string | null;
  categoryNormalized: string | null;
  categoryNormalizationApplied: boolean;
  previousCategoryDescription: string | null;
  proposedCategoryDescription: string | null;
  categoryOutcome: FieldReconciliationOutcome;
  pdfHsnSourceValue: string | null;
  previousHsnCode: string | null;
  parsedHsnCode: string | null;
  hsnChanged: boolean;
  hsnOutcome: FieldReconciliationOutcome;
  sourceChecksumSha256: string | null;
  sourceFileName: string | null;
  previousHsnDescription: string | null;
  proposedHsnDescription: string | null;
  hsnDescriptionOutcome: FieldReconciliationOutcome;
  hsnDescriptionSource: HsnDescriptionResolution | null;
}

export interface ApplyStylesResult {
  stylesCreated: string[];
  stylesVerified: string[];
  stylesBlocked: Array<{ season: string; lmix: string; reason: string | null }>;
  styleSizesCreated: number;
  styleSizesVerified: number;
  styleFactoryMappingsCreated: number;
  styleFactoryMappingsVerified: number;
  styleFactoryMappingsSkipped: number;
  /** Per-Style categoryDescription/hsnCode/hsnDescription reconciliation outcome — CREATE entries are always SET (or NO_SOURCE_VALUE); VERIFY_EXISTING entries only ever set a currently-null field, never overwrite a populated one. */
  fieldReconciliation: StyleFieldReconciliationDetail[];
}

/**
 * Unlike categoryDescription/hsnCode (report-and-continue), an existing
 * non-null hsnDescription that differs from the source label is a hard stop:
 * applyStyles throws before its first write, so nothing is half-applied.
 */
function findHsnDescriptionConflicts(
  plan: StylePlanEntry[],
  existingHsnDescriptionById: Map<string, string | null>,
): Array<{ styleNumber: string; existing: string; proposed: string }> {
  const conflicts: Array<{ styleNumber: string; existing: string; proposed: string }> = [];
  for (const entry of plan) {
    if (entry.action !== 'VERIFY_EXISTING' || !entry.existingStyleId) continue;
    const existing = existingHsnDescriptionById.get(entry.existingStyleId) ?? null;
    if (resolveFieldReconciliation(existing, entry.hsnDescription) === 'REVIEW_REQUIRED_CONFLICT') {
      conflicts.push({ styleNumber: entry.styleNumber, existing: existing!, proposed: entry.hsnDescription! });
    }
  }
  return conflicts;
}

/** Never overwrites an existing non-null value that disagrees with the proposed one — that is always REVIEW_REQUIRED_CONFLICT, reported but not applied. */
function resolveFieldReconciliation(previous: string | null, proposed: string | null): FieldReconciliationOutcome {
  if (proposed === null) return 'NO_SOURCE_VALUE';
  if (previous === null) return 'SET';
  if (previous === proposed) return 'ALREADY_SET';
  return 'REVIEW_REQUIRED_CONFLICT';
}

export async function applyStyles(actor: CurrentUser, plan: StylePlanEntry[]): Promise<ApplyStylesResult> {
  const result: ApplyStylesResult = {
    stylesCreated: [],
    stylesVerified: [],
    stylesBlocked: [],
    styleSizesCreated: 0,
    styleSizesVerified: 0,
    styleFactoryMappingsCreated: 0,
    styleFactoryMappingsVerified: 0,
    styleFactoryMappingsSkipped: 0,
    fieldReconciliation: [],
  };

  const existingStyleIds = plan
    .map((e) => e.existingStyleId)
    .filter((id): id is string => id !== null);
  const existingFieldRows = existingStyleIds.length
    ? await prisma.style.findMany({
        where: { id: { in: existingStyleIds } },
        select: { id: true, categoryDescription: true, hsnCode: true, hsnDescription: true },
      })
    : [];
  const existingFieldsById = new Map(existingFieldRows.map((r) => [r.id, r] as const));
  const hsnDescriptionConflicts = findHsnDescriptionConflicts(plan, new Map(existingFieldRows.map((r) => [r.id, r.hsnDescription] as const)));
  if (hsnDescriptionConflicts.length) {
    throw new StylePrepError(
      `REVIEW_REQUIRED: ${hsnDescriptionConflicts.length} Style(s) already hold a different hsnDescription — nothing was written: ` +
        hsnDescriptionConflicts.map((c) => `${c.styleNumber} existing="${c.existing}" proposed="${c.proposed}"`).join('; '),
    );
  }

  for (const entry of plan) {
    if (entry.action === 'BLOCKED') {
      result.stylesBlocked.push({ season: entry.season, lmix: entry.lmix, reason: entry.reason });
      continue;
    }

    let styleId: string;
    if (entry.action === 'VERIFY_EXISTING' && entry.existingStyleId) {
      styleId = entry.existingStyleId;
      result.stylesVerified.push(styleId);

      const existingFields = existingFieldsById.get(styleId) ?? { categoryDescription: null, hsnCode: null, hsnDescription: null };
      const categoryOutcome = resolveFieldReconciliation(existingFields.categoryDescription, entry.categoryNormalized);
      const hsnOutcome = resolveFieldReconciliation(existingFields.hsnCode, entry.hsnCode);
      const patch: Record<string, unknown> = {};
      if (categoryOutcome === 'SET') patch.categoryDescription = entry.categoryNormalized;
      if (hsnOutcome === 'SET') patch.hsnCode = entry.hsnCode;
      const hsnDescriptionOutcome = resolveFieldReconciliation(existingFields.hsnDescription, entry.hsnDescription);
      if (hsnDescriptionOutcome === 'SET') patch.hsnDescription = entry.hsnDescription;
      if (Object.keys(patch).length > 0) {
        await updateStyle(actor, styleId, patch);
      }
      result.fieldReconciliation.push({
        season: entry.season,
        legacyReference: entry.legacyReferenceNumbers[0] ?? null,
        lmix: entry.lmix,
        styleId,
        styleNumber: entry.styleNumber,
        categoryRaw: entry.categoryRaw,
        categoryNormalized: entry.categoryNormalized,
        categoryNormalizationApplied: entry.categoryNormalizationApplied,
        previousCategoryDescription: existingFields.categoryDescription,
        proposedCategoryDescription: entry.categoryNormalized,
        categoryOutcome,
        pdfHsnSourceValue: entry.hsnCode,
        previousHsnCode: existingFields.hsnCode,
        parsedHsnCode: entry.hsnCode,
        hsnChanged: hsnOutcome === 'SET',
        hsnOutcome,
        sourceChecksumSha256: entry.sourceChecksumSha256,
        sourceFileName: entry.sourceFileName,
        previousHsnDescription: existingFields.hsnDescription,
        proposedHsnDescription: entry.hsnDescription,
        hsnDescriptionOutcome,
        hsnDescriptionSource: entry.hsnDescriptionSource,
      });
    } else {
      if (!entry.styleName || !entry.finalMrp || !entry.seasonId) {
        result.stylesBlocked.push({ season: entry.season, lmix: entry.lmix, reason: 'Missing required field (styleName/finalMrp/seasonId) — not created' });
        continue;
      }
      const created = await createStyle(actor, {
        styleNumber: entry.styleNumber,
        styleName: entry.styleName,
        description: entry.description ?? undefined,
        colour: entry.colour ?? undefined,
        lmixNumber: entry.lmix,
        hsnCode: entry.hsnCode ?? undefined,
        hsnDescription: entry.hsnDescription ?? undefined,
        categoryDescription: entry.categoryNormalized ?? undefined,
        ipName: entry.ipName ?? undefined,
        licensor: entry.licensor ?? undefined,
        finalMrp: entry.finalMrp,
        seasonId: entry.seasonId,
        status: 'ACTIVE',
      });
      styleId = created.id;
      result.stylesCreated.push(styleId);
      result.fieldReconciliation.push({
        season: entry.season,
        legacyReference: entry.legacyReferenceNumbers[0] ?? null,
        lmix: entry.lmix,
        styleId,
        styleNumber: entry.styleNumber,
        categoryRaw: entry.categoryRaw,
        categoryNormalized: entry.categoryNormalized,
        categoryNormalizationApplied: entry.categoryNormalizationApplied,
        previousCategoryDescription: null,
        proposedCategoryDescription: entry.categoryNormalized,
        categoryOutcome: entry.categoryNormalized === null ? 'NO_SOURCE_VALUE' : 'SET',
        pdfHsnSourceValue: entry.hsnCode,
        previousHsnCode: null,
        parsedHsnCode: entry.hsnCode,
        hsnChanged: entry.hsnCode !== null,
        hsnOutcome: entry.hsnCode === null ? 'NO_SOURCE_VALUE' : 'SET',
        sourceChecksumSha256: entry.sourceChecksumSha256,
        sourceFileName: entry.sourceFileName,
        previousHsnDescription: null,
        proposedHsnDescription: entry.hsnDescription,
        hsnDescriptionOutcome: entry.hsnDescription === null ? 'NO_SOURCE_VALUE' : 'SET',
        hsnDescriptionSource: entry.hsnDescriptionSource,
      });
    }

    for (const size of entry.sizes) {
      if (size.action === 'BLOCKED' || !size.targetSizeId) continue;
      const alreadyPresent = await prisma.styleSize.findFirst({ where: { styleId, sizeId: size.targetSizeId } });
      if (alreadyPresent) {
        result.styleSizesVerified++;
        continue;
      }
      await addStyleSize(actor, styleId, { sizeId: size.targetSizeId });
      result.styleSizesCreated++;
    }

    if (entry.factory && entry.factory.factoryId) {
      if (entry.factory.action === 'CREATE' && entry.factory.exFactoryPrice !== null) {
        const alreadyPresent = await prisma.styleFactoryMapping.findFirst({ where: { styleId, factoryId: entry.factory.factoryId } });
        if (alreadyPresent) {
          result.styleFactoryMappingsVerified++;
        } else {
          await addStyleFactory(actor, styleId, { factoryId: entry.factory.factoryId, exFactoryPrice: entry.factory.exFactoryPrice });
          result.styleFactoryMappingsCreated++;
        }
      } else if (entry.factory.action === 'VERIFY_EXISTING') {
        result.styleFactoryMappingsVerified++;
      } else {
        result.styleFactoryMappingsSkipped++;
      }
    }
  }

  return result;
}

export { DevTargetGuardError };
export function verifyDevTarget() {
  return requireVerifiedDevDatabaseTarget({
    actualDatabaseUrl: process.env.DATABASE_URL,
    expectedDevDatabaseUrl: process.env.HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL,
  });
}
export { formatDevTargetReport };
