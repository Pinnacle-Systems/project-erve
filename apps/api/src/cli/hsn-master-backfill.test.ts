import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import { createTestSeason, resetDatabase } from '../test/helpers.js';
import {
  executeHsnMasterBackfill,
  loadStyleHsnRows,
  planHsnMasterBackfill,
  type StyleHsnRow,
} from './hsn-master-backfill.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function row(overrides: Partial<StyleHsnRow> & { id?: string; styleNumber?: string }): StyleHsnRow {
  return {
    id: overrides.id ?? createId(),
    styleNumber: overrides.styleNumber ?? 'ST-1',
    hsnCode: overrides.hsnCode ?? null,
    hsnDescription: overrides.hsnDescription ?? null,
  };
}

describe('planHsnMasterBackfill (pure)', () => {
  it('groups Styles by code and picks the single agreed description', () => {
    const plan = planHsnMasterBackfill([
      row({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' }),
      row({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' }),
    ]);
    expect(plan.hsnsToCreate).toEqual([
      expect.objectContaining({ code: '61091000', description: 'Boys / T-Shirt', styleCount: 2, conflictingDescriptions: [] }),
    ]);
    expect(plan.stylesToLink).toBe(2);
  });

  it('leaves description null and reports the conflict when descriptions disagree', () => {
    const plan = planHsnMasterBackfill([
      row({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' }),
      row({ hsnCode: '61091000', hsnDescription: 'Girls / T-Shirt' }),
    ]);
    expect(plan.hsnsToCreate).toHaveLength(1);
    expect(plan.hsnsToCreate[0]).toMatchObject({ code: '61091000', description: null, styleCount: 2 });
    expect(plan.hsnsToCreate[0]!.conflictingDescriptions.sort()).toEqual(['Boys / T-Shirt', 'Girls / T-Shirt']);
  });

  it('skips a blank code without inventing one', () => {
    const plan = planHsnMasterBackfill([row({ hsnCode: null }), row({ hsnCode: '' })]);
    expect(plan.hsnsToCreate).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped.every((s) => s.reason === 'BLANK_CODE')).toBe(true);
  });

  it('skips a code that is not exactly 8 digits', () => {
    const plan = planHsnMasterBackfill([row({ hsnCode: '123' }), row({ hsnCode: 'ABCDEFGH' })]);
    expect(plan.hsnsToCreate).toHaveLength(0);
    expect(plan.skipped.every((s) => s.reason === 'INVALID_CODE_FORMAT')).toBe(true);
  });

  it('treats a null description as not conflicting with a real one', () => {
    const plan = planHsnMasterBackfill([
      row({ hsnCode: '61091000', hsnDescription: null }),
      row({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' }),
    ]);
    expect(plan.hsnsToCreate[0]).toMatchObject({ description: 'Boys / T-Shirt', conflictingDescriptions: [] });
  });
});

describe('executeHsnMasterBackfill (integration)', () => {
  async function seedStyle(overrides: { hsnCode?: string | null; hsnDescription?: string | null }) {
    const season = await createTestSeason();
    return prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `ST-${createId().slice(-8)}`,
        styleName: 'Test Style',
        finalMrp: 500,
        seasonId: season.id,
        hsnCode: overrides.hsnCode ?? null,
        hsnDescription: overrides.hsnDescription ?? null,
      },
    });
  }

  it('creates one Hsn and links every matching Style, leaving an invalid-code Style unlinked', async () => {
    const styleA = await seedStyle({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' });
    const styleB = await seedStyle({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' });
    const styleC = await seedStyle({ hsnCode: null });

    const plan = planHsnMasterBackfill(await loadStyleHsnRows());
    const result = await executeHsnMasterBackfill(plan);

    expect(result).toMatchObject({ hsnsCreated: 1, hsnsAlreadyExisted: 0, stylesLinked: 2 });

    const hsn = await prisma.hsn.findUnique({ where: { code: '61091000' } });
    expect(hsn).toMatchObject({ code: '61091000', description: 'Boys / T-Shirt' });

    const refreshedA = await prisma.style.findUnique({ where: { id: styleA.id } });
    const refreshedB = await prisma.style.findUnique({ where: { id: styleB.id } });
    const refreshedC = await prisma.style.findUnique({ where: { id: styleC.id } });
    expect(refreshedA!.hsnId).toBe(hsn!.id);
    expect(refreshedB!.hsnId).toBe(hsn!.id);
    expect(refreshedC!.hsnId).toBeNull();
  });

  it('is idempotent: a second run against the same data creates nothing new', async () => {
    await seedStyle({ hsnCode: '61091000', hsnDescription: 'Boys / T-Shirt' });

    const firstPlan = planHsnMasterBackfill(await loadStyleHsnRows());
    await executeHsnMasterBackfill(firstPlan);

    // Re-plan: the Style already has hsnId set, so loadStyleHsnRows (which
    // only reads Styles with hsnId: null) returns nothing left to do.
    const secondPlan = planHsnMasterBackfill(await loadStyleHsnRows());
    expect(secondPlan.hsnsToCreate).toHaveLength(0);
    const result = await executeHsnMasterBackfill(secondPlan);
    expect(result).toEqual({ hsnsCreated: 0, hsnsAlreadyExisted: 0, stylesLinked: 0 });

    expect(await prisma.hsn.count()).toBe(1);
  });
});
