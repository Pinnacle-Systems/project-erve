import { describe, expect, it } from 'vitest';
import { isValidGstinFormat, normalizeGstin } from '@erve/shared';
import { createDistributorSchema } from '../modules/master-data/master-data.validation.js';
import { createSellerRegistrationSchema } from '../modules/master-data/seller-registration.validation.js';
import { createRetailStoreSchema } from '../modules/master-data/retail-stores.validation.js';
import { createDispatchOrderSchema } from '../modules/sale-orders/sale-orders.validation.js';

describe('shared GSTIN compatibility', () => {
  it('normalizes lowercase and whitespace without checksum or government checks', () => {
    expect(normalizeGstin('  22aaaaa0000a1z5 ')).toBe('22AAAAA0000A1Z5');
    expect(isValidGstinFormat(' 22aaaaa0000a1z5 ')).toBe(true);
    expect(isValidGstinFormat('00AAAAA0000A1ZT')).toBe(true);
  });
  it.each(['', 'PENDING-GSTIN', '22AAAAA0000A0Z5', '22AAAAA0000A1X5', '22 AAAA0000A1Z5'])('rejects malformed %s without changing it', (value) => {
    expect(isValidGstinFormat(value)).toBe(false);
    expect(normalizeGstin(value)).toBe(value);
  });
  it('preserves required distributor and seller semantics', () => {
    expect(createDistributorSchema.safeParse({ name: 'Buyer', purchaseMode: 'OUTRIGHT', gstin: '' }).success).toBe(false);
    expect(createDistributorSchema.parse({ name: 'Buyer', purchaseMode: 'OUTRIGHT', gstin: ' 22aaaaa0000a1z5 ' }).gstin).toBe('22AAAAA0000A1Z5');
    const seller = {
      branchCode: 'HO', legalName: 'Seller', gstin: ' 22aaaaa0000a1z5 ',
      addressLine1: 'Street', city: 'City', state: 'Chhattisgarh', stateCode: '22', postalCode: '492001',
      bankName: 'Bank', bankAccountName: 'Seller', bankAccountNumber: '12345678', bankIfsc: 'HDFC0001234', bankBranchName: 'Branch',
    };
    expect(createSellerRegistrationSchema.parse(seller).gstin).toBe('22AAAAA0000A1Z5');
    expect(createSellerRegistrationSchema.safeParse({ ...seller, gstin: '' }).success).toBe(false);
  });
  it('preserves optional store null, omitted and blank values', () => {
    const base = { distributorId: 'buyer', name: 'Store', addressLine1: 'Street', city: 'City', state: 'State', postalCode: '400001' };
    expect(createRetailStoreSchema.parse({ ...base, gstin: ' ' }).gstin).toBeNull();
    expect(createRetailStoreSchema.parse({ ...base, gstin: null }).gstin).toBeNull();
    expect(createRetailStoreSchema.parse(base).gstin).toBeUndefined();
    expect(createRetailStoreSchema.parse({ ...base, gstin: '22aaaaa0000a1z5' }).gstin).toBe('22AAAAA0000A1Z5');
  });
  it('preserves optional destination normalization and rejects malformed non-empty values', () => {
    const parse = (gstin?: string | null) => createDispatchOrderSchema.parse({
      factoryId: 'factory', soDate: '2026-10-20',
      distributors: [{ clientKey: 'group', distributorId: 'buyer', destinations: [{ clientKey: 'destination', retailStoreId: 'store', addressLine1: 'Street', city: 'City', state: 'State', country: 'India', ...(gstin === undefined ? {} : { gstin }) }] }],
      lines: [{ destinationClientKey: 'destination', styleId: 'style', totalQuantity: 1 }],
    }).distributors[0]!.destinations[0]!.gstin;
    expect(parse()).toBeUndefined();
    expect(parse(null)).toBeNull();
    expect(parse(' ')).toBeNull();
    expect(parse(' 22aaaaa0000a1z5 ')).toBe('22AAAAA0000A1Z5');
    expect(() => parse('PENDING-GSTIN')).toThrow();
  });
});
