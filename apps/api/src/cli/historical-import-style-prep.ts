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
import { createStyle, addStyleSize, addStyleFactory } from '../modules/master-data/master-data.service.js';
import { parseFactoryMappingArtifact, type FactoryMappingRow } from '../modules/historical-import/factory-mapping.js';
import { parseSizeMappingArtifact, resolveApprovedSizeMapping, type SizeMappingRow } from '../modules/historical-import/size-mapping.js';
import { reconcileMrp, type RequiredStyleIdentity } from '../modules/historical-import/mrp-reconciliation.js';
import { buildMrpWorkbookManifest, buildEffectiveSourceRecords, buildRequiredIdentities } from './historical-import-mrp-audit.js';
import type { MrpWorkbookRow } from '../modules/historical-import/mrp-workbook.js';
import type { ParsedPurchaseOrderRecord } from '../modules/historical-import/po-pdf-parser.types.js';
import type { CurrentUser } from '../auth/current-user.js';

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
  ipName: string | null;
  licensor: string | null;
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
}

async function loadIdentitiesAndWorkbook(options: StylePrepOptions) {
  const { rows } = await buildMrpWorkbookManifest(options.workbookPath);
  const effectiveRecords = await buildEffectiveSourceRecords(options.stagingFilePath, options.sourceOverridesFilePath);
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
    // Style.styleNumber is globally unique (not scoped by Season), unlike
    // the Season+LMIX identity key. Three pre-existing DEFAULT-season
    // sample/verification Styles already occupy the bare LMIX digits for
    // LMIX39026006/25426015/25426009 (discovered when createStyle first
    // rejected one of these 91 as a duplicate styleNumber) — a bare-digit
    // styleNumber is therefore not safe for ANY of the 91 new Styles, not
    // just the 3 that collide today. Prefixing with the Season code
    // guarantees global uniqueness by construction and stays fully
    // traceable to the approved Season+LMIX identity (no invented data).
    const styleNumber = `${mrpRecord.season}-${mrpRecord.lmix.replace(/^LMIX/i, '')}`;
    const effectiveRecord = findEffectiveRecordForIdentity(effectiveRecords, identity);
    const workbookRow = findWorkbookRow(rows, mrpRecord.workbookRow);

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
        hsnCode: effectiveRecord?.hsnCode.value ?? null,
        ipName: workbookRow?.ipName ?? null,
        licensor: workbookRow?.licensor ?? null,
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
        hsnCode: effectiveRecord?.hsnCode.value ?? null,
        ipName: workbookRow?.ipName ?? null,
        licensor: workbookRow?.licensor ?? null,
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
      hsnCode: effectiveRecord?.hsnCode.value ?? null,
      ipName: workbookRow?.ipName?.trim().toUpperCase() ?? null,
      licensor: workbookRow?.licensor?.trim().toUpperCase() ?? null,
      finalMrp: mrpRecord.businessMrp,
      sizes,
      factory,
    });
  }

  return plan;
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
  };

  for (const entry of plan) {
    if (entry.action === 'BLOCKED') {
      result.stylesBlocked.push({ season: entry.season, lmix: entry.lmix, reason: entry.reason });
      continue;
    }

    let styleId: string;
    if (entry.action === 'VERIFY_EXISTING' && entry.existingStyleId) {
      styleId = entry.existingStyleId;
      result.stylesVerified.push(styleId);
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
        ipName: entry.ipName ?? undefined,
        licensor: entry.licensor ?? undefined,
        finalMrp: entry.finalMrp,
        seasonId: entry.seasonId,
        status: 'ACTIVE',
      });
      styleId = created.id;
      result.stylesCreated.push(styleId);
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
