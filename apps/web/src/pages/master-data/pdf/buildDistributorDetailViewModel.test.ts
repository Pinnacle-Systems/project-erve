import { describe, expect, it } from 'vitest';
import type { Distributor } from '../types.js';
import { buildDistributorDetailViewModel } from './buildDistributorDetailViewModel.js';

function makeDistributor(overrides: Partial<Distributor> = {}): Distributor {
  return {
    id: 'dist-1',
    code: 'DIST-1',
    name: 'Acme Distribution',
    contactName: 'Jane Doe',
    city: 'Mumbai',
    status: 'ACTIVE',
    gstin: '27AAAAA0000A1Z5',
    purchaseMode: 'OUTRIGHT',
    contactEmail: 'jane@acme.test',
    contactPhone: '9999999999',
    addressLine1: '123 Market Street',
    addressLine2: null,
    state: 'Maharashtra',
    country: 'India',
    postalCode: '400001',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDistributorDetailViewModel', () => {
  it('maps identity, GSTIN, and Purchase Mode', () => {
    const vm = buildDistributorDetailViewModel(makeDistributor(), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({ label: 'GSTIN', value: '27AAAAA0000A1Z5' });
    expect(vm.identityItems).toContainEqual({ label: 'Purchase Mode', value: 'Outright' });
  });

  it('renders SALE_RETURN Purchase Mode as "Sale or Return", matching the Detail screen label', () => {
    const vm = buildDistributorDetailViewModel(makeDistributor({ purchaseMode: 'SALE_RETURN' }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({ label: 'Purchase Mode', value: 'Sale or Return' });
  });

  it('maps the address and contact fields, preserving nulls', () => {
    const vm = buildDistributorDetailViewModel(makeDistributor({ addressLine2: null }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({ label: 'Address Line 2', value: null });
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildDistributorDetailViewModel(makeDistributor(), {
      generatedAt: '2026-09-12T00:00:00Z',
      generatedBy: 'Test Admin',
    });
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
