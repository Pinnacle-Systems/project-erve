import { describe, expect, it } from 'vitest';
import { createRetailStoreSchema, updateRetailStoreSchema } from './retail-stores.validation.js';

describe('Retail Store partial update validation', () => {
  it('does not reset status or country when updating another field', () => {
    expect(updateRetailStoreSchema.parse({ name: 'Renamed Store' })).toEqual({ name: 'Renamed Store' });
    expect(updateRetailStoreSchema.parse({ status: 'INACTIVE' })).toEqual({ status: 'INACTIVE' });
  });
  it('defaults country and status only on creation', () => {
    expect(createRetailStoreSchema.parse({ distributorId: 'd1', code: 'S1', name: 'Store', addressLine1: '12 Road', city: 'Chennai', state: 'TN', postalCode: '600001' })).toMatchObject({ country: 'India', status: 'ACTIVE' });
  });
  it('rejects ownership changes and empty updates', () => {
    expect(updateRetailStoreSchema.safeParse({ distributorId: 'd2' }).success).toBe(false);
    expect(updateRetailStoreSchema.safeParse({}).success).toBe(false);
  });
});
