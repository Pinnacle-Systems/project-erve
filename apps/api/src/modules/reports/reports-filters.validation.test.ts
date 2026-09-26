import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reportFilterFields, reportRecordOriginSchema } from './reports-filters.validation.js';

describe('reportRecordOriginSchema', () => {
  it.each(['LIVE_WORKFLOW', 'HISTORICAL_IMPORT', 'ALL'])('accepts %s', (value) => {
    expect(reportRecordOriginSchema.parse(value)).toBe(value);
  });

  it('rejects an unrecognized origin value', () => {
    expect(() => reportRecordOriginSchema.parse('SOMETHING_ELSE')).toThrow();
  });
});

describe('reportFilterFields', () => {
  const schema = z.object(reportFilterFields);

  it('accepts an empty filter object — every field is optional', () => {
    expect(schema.parse({})).toEqual({});
  });

  it('accepts a fully populated filter object', () => {
    const input = {
      financialYearId: 'fy-1',
      fromDate: '2026-04-01',
      toDate: '2026-09-30',
      seasonId: 'season-1',
      factoryId: 'factory-1',
      distributorId: 'distributor-1',
      styleId: 'style-1',
      purchaseMode: 'SALE_RETURN',
      recordOrigin: 'LIVE_WORKFLOW',
    };
    expect(schema.parse(input)).toEqual(input);
  });

  it('rejects an empty-string field rather than silently treating it as absent', () => {
    expect(() => schema.parse({ factoryId: '' })).toThrow();
  });

  it('rejects an invalid purchaseMode', () => {
    expect(() => schema.parse({ purchaseMode: 'RENTAL' })).toThrow();
  });
});
