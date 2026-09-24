import { describe, expect, it } from 'vitest';
import type { MrpWorkbookRow } from './mrp-workbook.js';
import {
  reconcileExFactory,
  reconcileMrp,
  type RequiredStyleIdentity,
} from './mrp-reconciliation.js';

function wbRow(overrides: Partial<MrpWorkbookRow> = {}): MrpWorkbookRow {
  return {
    excelRow: 2,
    seasonRaw: 'AW-25',
    season: 'AW25',
    description: 'Hot WheelsT-shirt HS-013',
    ipName: 'Hot Wheels',
    category: 'T-shirt HS-',
    licensor: 'Matel',
    factoryRaw: 'Clifton',
    baseCodeRaw: 39042013,
    baseCodeDigits: '39042013',
    mrp: 799,
    exFactoryCost: 166,
    colour: 'HIGH RISK RED',
    issues: [],
    ...overrides,
  };
}

function identity(overrides: Partial<RequiredStyleIdentity> = {}): RequiredStyleIdentity {
  return {
    season: 'AW25',
    lmix: 'LMIX39024013',
    legacyReferenceNumbers: ['EI25022'],
    historicalSupplierRate: 166,
    colour: 'High Risk Red 18-1763 TCX',
    factory: 'Clifton export Pvt Ltd',
    description: "Boy's T-Shirt",
    ...overrides,
  };
}

describe('reconcileMrp', () => {
  it('resolves an AW25 identity via the digit-transposed Base code', () => {
    const { records, extraWorkbookRows } = reconcileMrp([identity()], [wbRow()]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      disposition: 'RESOLVED',
      matchMethod: 'DIGIT_TRANSPOSED',
      workbookRow: 2,
      businessMrp: 799,
      businessExFactoryCost: 166,
      rateAgreement: true,
    });
    expect(extraWorkbookRows).toHaveLength(0);
  });

  it('resolves an SS26 identity via the direct Base code (no transposition)', () => {
    const ss26Identity = identity({ season: 'SS26', lmix: 'LMIX14026003', historicalSupplierRate: 388 });
    const ss26Row = wbRow({ season: 'SS26', baseCodeDigits: '14026003', mrp: 1199, exFactoryCost: 388 });
    const { records } = reconcileMrp([ss26Identity], [ss26Row]);
    expect(records[0]).toMatchObject({ disposition: 'RESOLVED', matchMethod: 'DIRECT' });
  });

  it('is BLOCKED when no workbook row matches by either key', () => {
    const { records } = reconcileMrp([identity()], [wbRow({ baseCodeDigits: '99999999' })]);
    expect(records[0]!.disposition).toBe('BLOCKED');
    expect(records[0]!.reason).toMatch(/No workbook row matches/);
  });

  it('is BLOCKED when the matched row has no valid MRP', () => {
    const { records } = reconcileMrp([identity()], [wbRow({ mrp: null })]);
    expect(records[0]).toMatchObject({ disposition: 'BLOCKED', workbookRow: 2 });
    expect(records[0]!.reason).toMatch(/no valid positive MRP/);
  });

  it('is REVIEW_REQUIRED when two distinct workbook rows match the same identity (conflicting/duplicate)', () => {
    const dup1 = wbRow({ excelRow: 2 });
    const dup2 = wbRow({ excelRow: 9, mrp: 899 });
    const { records } = reconcileMrp([identity()], [dup1, dup2]);
    expect(records[0]!.disposition).toBe('REVIEW_REQUIRED');
    expect(records[0]!.reason).toMatch(/distinct workbook rows/);
  });

  it('is REVIEW_REQUIRED when the matched row exfactory cost disagrees with the historical PO supplier rate', () => {
    const { records } = reconcileMrp([identity({ historicalSupplierRate: 200 })], [wbRow({ exFactoryCost: 166 })]);
    expect(records[0]!.disposition).toBe('REVIEW_REQUIRED');
    expect(records[0]!.reason).toMatch(/disagrees with the historical PO supplier rate/);
  });

  it('does not flag rate disagreement when either rate is unknown', () => {
    const { records } = reconcileMrp([identity({ historicalSupplierRate: null })], [wbRow()]);
    expect(records[0]).toMatchObject({ disposition: 'RESOLVED', rateAgreement: null });
  });

  it('classifies an unconsumed workbook row as an extra row (OUTSIDE_CURRENT_HISTORICAL_JO_SCOPE candidate)', () => {
    const extraRow = wbRow({ excelRow: 74, season: 'SS26', baseCodeDigits: '29526004', description: 'Girls Kangaroo Pocket Tee' });
    const { extraWorkbookRows } = reconcileMrp([identity()], [wbRow(), extraRow]);
    expect(extraWorkbookRows).toEqual([extraRow]);
  });

  it('surfaces the current Dev Style state when a lookup is supplied, without treating it as a blocker', () => {
    const lookup = {
      findBySeasonAndLmix: (season: string, lmix: string) =>
        season === 'AW25' && lmix === 'LMIX39024013' ? { id: 'style-1', finalMrp: null } : null,
    };
    const { records } = reconcileMrp([identity()], [wbRow()], lookup);
    expect(records[0]).toMatchObject({ disposition: 'RESOLVED', currentDevStyleId: 'style-1', currentDevFinalMrp: null });
  });
});

describe('reconcileExFactory', () => {
  it('is NEW_MAPPING_RATE when no current Dev mapping exists yet and the workbook supplies a rate', () => {
    const [result] = reconcileExFactory([
      { season: 'AW25', lmix: 'LMIX39024013', factory: 'Clifton', businessExFactoryCost: 166, historicalSupplierRate: 166, currentDevMappingRate: null },
    ]);
    expect(result!.disposition).toBe('NEW_MAPPING_RATE');
  });

  it('notes (but does not block on) a historical-vs-business rate difference when creating a new mapping', () => {
    const [result] = reconcileExFactory([
      { season: 'AW25', lmix: 'LMIX39024013', factory: 'Clifton', businessExFactoryCost: 170, historicalSupplierRate: 166, currentDevMappingRate: null },
    ]);
    expect(result!.disposition).toBe('NEW_MAPPING_RATE');
    expect(result!.reason).toMatch(/differs from the historical PO supplier rate/);
  });

  it('is MATCH when the business rate agrees with an existing current Dev mapping', () => {
    const [result] = reconcileExFactory([
      { season: 'AW25', lmix: 'LMIX39024013', factory: 'Clifton', businessExFactoryCost: 166, historicalSupplierRate: 166, currentDevMappingRate: 166 },
    ]);
    expect(result!.disposition).toBe('MATCH');
  });

  it('is REVIEW_CONFLICT when the business rate disagrees with an existing current Dev mapping — never silently overwritten', () => {
    const [result] = reconcileExFactory([
      { season: 'AW25', lmix: 'LMIX39024013', factory: 'Clifton', businessExFactoryCost: 170, historicalSupplierRate: 166, currentDevMappingRate: 166 },
    ]);
    expect(result!.disposition).toBe('REVIEW_CONFLICT');
    expect(result!.reason).toMatch(/never silently overwritten/);
  });

  it('is REVIEW_CONFLICT when there is no usable business ex-factory cost', () => {
    const [result] = reconcileExFactory([
      { season: 'AW25', lmix: 'LMIX39024013', factory: 'Clifton', businessExFactoryCost: null, historicalSupplierRate: 166, currentDevMappingRate: null },
    ]);
    expect(result!.disposition).toBe('REVIEW_CONFLICT');
  });
});
