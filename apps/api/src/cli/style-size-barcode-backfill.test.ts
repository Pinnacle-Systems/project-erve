import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import { createTestFinancialYear, resetDatabase } from '../test/helpers.js';
import {
  executeBarcodeBackfill,
  loadBackfillRows,
  planBarcodeBackfill,
  summarizePlan,
} from './style-size-barcode-backfill.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let sequence = 0;
async function seed(rows: Array<{
  season: { code: string; serial: number | null };
  lmix: string | null;
  size: { label: string; type?: 'AGE' | 'ALPHA' };
  barcode?: string | null;
}>) {
  const financialYear = await createTestFinancialYear();
  const seasons = new Map<string, string>();
  const sizes = new Map<string, string>();
  const styles = new Map<string, string>();
  for (const row of rows) {
    if (!seasons.has(row.season.code)) {
      const id = createId();
      seasons.set(row.season.code, id);
      await prisma.season.create({
        data: { id, code: row.season.code, name: row.season.code, financialYearId: financialYear.id, barcodeSerial: row.season.serial },
      });
    }
    const sizeKey = `${row.size.type ?? 'AGE'}:${row.size.label}`;
    if (!sizes.has(sizeKey)) {
      const id = createId();
      sizes.set(sizeKey, id);
      await prisma.size.create({
        data: { id, code: `SZ${++sequence}`, label: row.size.label, sizeType: row.size.type ?? 'AGE', sortOrder: sequence },
      });
    }
    const styleKey = `${row.season.code}|${row.lmix}`;
    if (!styles.has(styleKey)) {
      const id = createId();
      styles.set(styleKey, id);
      await prisma.style.create({
        data: { id, styleNumber: `ST${++sequence}`, styleName: 'S', lmixNumber: row.lmix, finalMrp: 1, seasonId: seasons.get(row.season.code)! },
      });
    }
    await prisma.styleSize.create({
      data: { id: createId(), styleId: styles.get(styleKey)!, sizeId: sizes.get(sizeKey)!, barcode: row.barcode ?? null },
    });
  }
}

const snapshot = async () =>
  (await prisma.styleSize.findMany({ select: { id: true, barcode: true }, orderBy: { id: 'asc' } }));

describe('barcode backfill plan', () => {
  it('classifies every blank row and never touches populated ones', async () => {
    await seed([
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '3' } }, // generate
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '10' } }, // generate
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '4' }, barcode: 'HIST-4' }, // populated
      { season: { code: 'NOSER', serial: null }, lmix: 'LMIX1', size: { label: '3' } }, // missing serial
      { season: { code: 'OK', serial: 3 }, lmix: '', size: { label: '3' } }, // invalid LMIX
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX77', size: { label: 'S', type: 'ALPHA' } }, // ambiguous size
    ]);

    const plan = planBarcodeBackfill(await loadBackfillRows());

    expect(summarizePlan(plan)).toEqual({
      totalCandidates: 5,
      wouldGenerate: 2,
      alreadyPopulated: 1,
      duplicateCollision: 0,
      missingSeasonSerial: 1,
      invalidLmix: 1,
      ambiguousSize: 1,
      rejected: 3,
    });
    expect(plan.wouldGenerate.map((row) => row.barcode).sort()).toEqual(['3123410', '312343']);
  });

  it('reports a collision with an existing historical barcode and between two blank rows, writing neither', async () => {
    await seed([
      { season: { code: 'A', serial: 3 }, lmix: 'LMIX1234', size: { label: '3' }, barcode: '312343' }, // already holds the value
      { season: { code: 'B', serial: 31 }, lmix: 'LMIX234', size: { label: '3' } }, // 31+234+3 would collide with it
      // Different splits, same digits: 1+1111+1 and 11+111+1 both read "111111".
      { season: { code: 'C', serial: 1 }, lmix: 'LMIX1111', size: { label: '1' } },
      { season: { code: 'D', serial: 11 }, lmix: 'LMIX111', size: { label: '1' } },
    ]);

    const plan = planBarcodeBackfill(await loadBackfillRows());

    expect(plan.skipped.COLLISION).toHaveLength(3);
    expect(plan.wouldGenerate).toHaveLength(0);
    const result = await executeBarcodeBackfill(plan);
    expect(result.written).toBe(0);
  });

  it('can preview unassigned Seasons with --assume-serial without being able to write them', async () => {
    await seed([{ season: { code: 'NOSER', serial: null }, lmix: 'LMIX1234', size: { label: '3' } }]);

    const preview = planBarcodeBackfill(await loadBackfillRows(), { assumeSerials: new Map([['NOSER', 5]]) });

    expect(summarizePlan(preview).wouldGenerate).toBe(1);
    expect(preview.wouldGenerate[0]!.barcode).toBe('512343');
    expect(summarizePlan(planBarcodeBackfill(await loadBackfillRows())).missingSeasonSerial).toBe(1);
  });
});

describe('barcode backfill execution', () => {
  it('planning (dry run) never mutates data', async () => {
    await seed([
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '3' } },
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '4' }, barcode: 'HIST-4' },
    ]);
    const before = await snapshot();

    planBarcodeBackfill(await loadBackfillRows());

    expect(await snapshot()).toEqual(before);
  });

  it('writes only blank generatable rows and leaves historical values exactly as they were', async () => {
    await seed([
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '3' } },
      { season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '4' }, barcode: 'HIST-4' },
      { season: { code: 'NOSER', serial: null }, lmix: 'LMIX1', size: { label: '3' } },
    ]);

    const result = await executeBarcodeBackfill(planBarcodeBackfill(await loadBackfillRows()), 1);

    expect(result).toEqual({ written: 1, skippedFilled: 0 });
    const barcodes = (await prisma.styleSize.findMany({ select: { barcode: true } })).map((r) => r.barcode);
    expect(barcodes.sort()).toEqual(['312343', 'HIST-4', null].sort());
  });

  it('is idempotent and does not overwrite a row filled between planning and writing', async () => {
    await seed([{ season: { code: 'OK', serial: 3 }, lmix: 'LMIX1234', size: { label: '3' } }]);
    const plan = planBarcodeBackfill(await loadBackfillRows());
    await prisma.styleSize.updateMany({ data: { barcode: 'FILLED-ELSEWHERE' } });

    const raced = await executeBarcodeBackfill(plan);
    const rerun = await executeBarcodeBackfill(planBarcodeBackfill(await loadBackfillRows()));

    expect(raced).toEqual({ written: 0, skippedFilled: 1 });
    expect(rerun.written).toBe(0);
    expect((await prisma.styleSize.findFirstOrThrow()).barcode).toBe('FILLED-ELSEWHERE');
  });
});
