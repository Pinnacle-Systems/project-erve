// Backfill of blank Style+Size barcodes. Dry-run first: the plan below is a
// pure read, and --execute only ever writes the rows the plan marked
// generatable. It NEVER touches a row that already has a barcode (historical
// values are identifiers, not derived data) and never guesses: rows whose
// Season serial / LMIX / size cannot be read unambiguously, or whose
// generated value would collide, are reported and left blank.
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../db/prisma.js';
import { generateStyleSizeBarcode, type BarcodeSourceProblem } from '../modules/master-data/barcode.util.js';

export type BackfillSkipReason = BarcodeSourceProblem | 'COLLISION';

export interface BackfillRow {
  styleSizeId: string;
  styleNumber: string;
  seasonCode: string;
  lmixNumber: string | null;
  sizeLabel: string;
  detail: string;
}

export interface BackfillPlan {
  totalCandidates: number;
  alreadyPopulated: number;
  wouldGenerate: Array<BackfillRow & { barcode: string }>;
  skipped: Record<BackfillSkipReason, BackfillRow[]>;
}

type StyleSizeRow = Prisma.StyleSizeGetPayload<{
  select: {
    id: true;
    barcode: true;
    style: { select: { styleNumber: true; lmixNumber: true; season: { select: { code: true; barcodeSerial: true } } } };
    size: { select: { label: true; sizeType: true } };
  };
}>;

export interface BackfillOptions {
  /** Dry-run only "what if": Season code -> serial for Seasons that have none yet. */
  assumeSerials?: Map<string, number>;
}

/** Pure planning step (no I/O) over every Style+Size row. */
export function planBarcodeBackfill(rows: StyleSizeRow[], options: BackfillOptions = {}): BackfillPlan {
  const taken = new Map<string, string>();
  for (const row of rows) {
    if (row.barcode !== null) taken.set(row.barcode, row.id);
  }

  const plan: BackfillPlan = {
    totalCandidates: 0,
    alreadyPopulated: 0,
    wouldGenerate: [],
    skipped: { MISSING_SEASON_SERIAL: [], INVALID_LMIX: [], AMBIGUOUS_SIZE: [], COLLISION: [] },
  };
  const describe = (row: StyleSizeRow, detail: string): BackfillRow => ({
    styleSizeId: row.id,
    styleNumber: row.style.styleNumber,
    seasonCode: row.style.season.code,
    lmixNumber: row.style.lmixNumber,
    sizeLabel: row.size.label,
    detail,
  });

  const generated: Array<{ row: StyleSizeRow; barcode: string }> = [];
  const countByBarcode = new Map<string, number>();
  for (const row of rows) {
    if (row.barcode !== null) {
      plan.alreadyPopulated++;
      continue;
    }
    plan.totalCandidates++;
    const result = generateStyleSizeBarcode({
      seasonSerial: row.style.season.barcodeSerial ?? options.assumeSerials?.get(row.style.season.code),
      lmixNumber: row.style.lmixNumber,
      sizeLabel: row.size.label,
      sizeType: row.size.sizeType,
    });
    if (!result.ok) {
      plan.skipped[result.problem].push(describe(row, result.message));
      continue;
    }
    generated.push({ row, barcode: result.barcode });
    countByBarcode.set(result.barcode, (countByBarcode.get(result.barcode) ?? 0) + 1);
  }

  // A generated value that equals an existing barcode, or that two blank rows
  // would both claim, is a collision: none of the claimants is written.
  for (const { row, barcode } of generated) {
    if (taken.has(barcode)) {
      plan.skipped.COLLISION.push(describe(row, `barcode ${barcode} is already assigned to another Style + Size`));
    } else if (countByBarcode.get(barcode)! > 1) {
      plan.skipped.COLLISION.push(describe(row, `barcode ${barcode} would be generated for more than one Style + Size`));
    } else {
      plan.wouldGenerate.push({ ...describe(row, 'generated'), barcode });
    }
  }
  return plan;
}

export async function loadBackfillRows(): Promise<StyleSizeRow[]> {
  return prisma.styleSize.findMany({
    select: {
      id: true,
      barcode: true,
      style: { select: { styleNumber: true, lmixNumber: true, season: { select: { code: true, barcodeSerial: true } } } },
      size: { select: { label: true, sizeType: true } },
    },
    orderBy: { id: 'asc' },
  });
}

export function summarizePlan(plan: BackfillPlan) {
  const rejected =
    plan.skipped.MISSING_SEASON_SERIAL.length +
    plan.skipped.INVALID_LMIX.length +
    plan.skipped.AMBIGUOUS_SIZE.length +
    plan.skipped.COLLISION.length;
  return {
    totalCandidates: plan.totalCandidates,
    wouldGenerate: plan.wouldGenerate.length,
    alreadyPopulated: plan.alreadyPopulated,
    duplicateCollision: plan.skipped.COLLISION.length,
    missingSeasonSerial: plan.skipped.MISSING_SEASON_SERIAL.length,
    invalidLmix: plan.skipped.INVALID_LMIX.length,
    ambiguousSize: plan.skipped.AMBIGUOUS_SIZE.length,
    rejected,
  };
}

/**
 * Writes the plan's generatable rows in transaction-safe batches. Each update
 * is guarded by `barcode IS NULL`, so a row filled by anyone since planning
 * is left alone; the unique index still backstops any residual collision.
 */
export async function executeBarcodeBackfill(plan: BackfillPlan, batchSize = 200): Promise<{ written: number; skippedFilled: number }> {
  let written = 0;
  let skippedFilled = 0;
  for (let start = 0; start < plan.wouldGenerate.length; start += batchSize) {
    const batch = plan.wouldGenerate.slice(start, start + batchSize);
    await prisma.$transaction(async (tx) => {
      for (const item of batch) {
        const result = await tx.styleSize.updateMany({
          where: { id: item.styleSizeId, barcode: null },
          data: { barcode: item.barcode },
        });
        written += result.count;
        skippedFilled += 1 - result.count;
      }
    });
  }
  return { written, skippedFilled };
}
