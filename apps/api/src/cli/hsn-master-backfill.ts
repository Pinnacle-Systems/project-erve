// One-time backfill establishing the new Hsn master (INV-002) from the
// free-text Style.hsnCode/hsnDescription fields that have always been the
// only HSN data in this codebase (master-data.validation.ts hsnCodeSchema:
// exactly 8 numeric digits). Dry-run first: the plan below is a pure read.
//
// Never invents anything: a Style whose hsnCode is blank or not exactly 8
// digits cannot be linked and is reported, not guessed. A code used with
// more than one distinct, non-blank description across Styles is still
// created (the CODE is an established identity even when its description
// is inconsistent) but with description left null and the conflicting
// descriptions reported for business/data cleanup — no description is
// invented or arbitrarily chosen.
import { prisma } from '../db/prisma.js';
import { createId } from '@erve/shared';

const VALID_HSN_CODE = /^\d{8}$/;

export interface StyleHsnRow {
  id: string;
  styleNumber: string;
  hsnCode: string | null;
  hsnDescription: string | null;
}

export type SkipReason = 'BLANK_CODE' | 'INVALID_CODE_FORMAT';

export interface SkippedStyle {
  styleId: string;
  styleNumber: string;
  hsnCode: string | null;
  reason: SkipReason;
}

export interface PlannedHsn {
  code: string;
  description: string | null;
  styleCount: number;
  styleIds: string[];
  /** Non-empty only when more than one distinct non-blank description was found for this code. */
  conflictingDescriptions: string[];
}

export interface BackfillPlan {
  totalStyles: number;
  alreadyLinked: number;
  hsnsToCreate: PlannedHsn[];
  stylesToLink: number;
  skipped: SkippedStyle[];
}

export function planHsnMasterBackfill(rows: StyleHsnRow[]): BackfillPlan {
  const plan: BackfillPlan = {
    totalStyles: rows.length,
    alreadyLinked: 0,
    hsnsToCreate: [],
    stylesToLink: 0,
    skipped: [],
  };

  const byCode = new Map<string, { styleIds: string[]; descriptions: Set<string> }>();

  for (const row of rows) {
    const code = row.hsnCode?.trim() ?? '';
    if (!code) {
      plan.skipped.push({ styleId: row.id, styleNumber: row.styleNumber, hsnCode: row.hsnCode, reason: 'BLANK_CODE' });
      continue;
    }
    if (!VALID_HSN_CODE.test(code)) {
      plan.skipped.push({ styleId: row.id, styleNumber: row.styleNumber, hsnCode: row.hsnCode, reason: 'INVALID_CODE_FORMAT' });
      continue;
    }
    const entry = byCode.get(code) ?? { styleIds: [], descriptions: new Set<string>() };
    entry.styleIds.push(row.id);
    const description = row.hsnDescription?.trim();
    if (description) entry.descriptions.add(description);
    byCode.set(code, entry);
  }

  for (const [code, entry] of [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const descriptions = [...entry.descriptions];
    plan.hsnsToCreate.push({
      code,
      description: descriptions.length === 1 ? descriptions[0]! : null,
      styleCount: entry.styleIds.length,
      styleIds: entry.styleIds,
      conflictingDescriptions: descriptions.length > 1 ? descriptions : [],
    });
    plan.stylesToLink += entry.styleIds.length;
  }

  return plan;
}

export async function loadStyleHsnRows(): Promise<StyleHsnRow[]> {
  const rows = await prisma.style.findMany({
    where: { hsnId: null },
    select: { id: true, styleNumber: true, hsnCode: true, hsnDescription: true },
    orderBy: { id: 'asc' },
  });
  return rows;
}

export function summarizePlan(plan: BackfillPlan) {
  return {
    totalStyles: plan.totalStyles,
    hsnsToCreate: plan.hsnsToCreate.length,
    hsnsWithConflictingDescriptions: plan.hsnsToCreate.filter((hsn) => hsn.conflictingDescriptions.length > 0).length,
    stylesToLink: plan.stylesToLink,
    stylesSkippedBlankCode: plan.skipped.filter((s) => s.reason === 'BLANK_CODE').length,
    stylesSkippedInvalidFormat: plan.skipped.filter((s) => s.reason === 'INVALID_CODE_FORMAT').length,
  };
}

export interface ExecuteResult {
  hsnsCreated: number;
  hsnsAlreadyExisted: number;
  stylesLinked: number;
}

/**
 * Writes the plan's HSNs and links the Styles that reference them, in one
 * HSN-at-a-time transaction. Each HSN is created idempotently (upsert by
 * code) and each Style link is guarded by `hsnId IS NULL`, so a row already
 * resolved by someone else since planning is left alone.
 */
export async function executeHsnMasterBackfill(plan: BackfillPlan): Promise<ExecuteResult> {
  let hsnsCreated = 0;
  let hsnsAlreadyExisted = 0;
  let stylesLinked = 0;

  for (const planned of plan.hsnsToCreate) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.hsn.findUnique({ where: { code: planned.code } });
      const hsn =
        existing ??
        (await tx.hsn.create({
          data: { id: createId(), code: planned.code, description: planned.description, status: 'ACTIVE' },
        }));
      if (existing) hsnsAlreadyExisted += 1;
      else hsnsCreated += 1;

      const result = await tx.style.updateMany({
        where: { id: { in: planned.styleIds }, hsnId: null },
        data: { hsnId: hsn.id },
      });
      stylesLinked += result.count;
    });
  }

  return { hsnsCreated, hsnsAlreadyExisted, stylesLinked };
}
