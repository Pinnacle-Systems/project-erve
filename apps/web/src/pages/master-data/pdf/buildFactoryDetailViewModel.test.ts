import { describe, expect, it } from 'vitest';
import type { Factory } from '../types.js';
import { buildFactoryDetailViewModel } from './buildFactoryDetailViewModel.js';

function makeFactory(overrides: Partial<Factory> = {}): Factory {
  return {
    id: 'factory-1',
    code: 'FAC-1',
    name: 'Acme Factory',
    contactName: 'Jane Doe',
    contactEmail: 'jane@acme.test',
    contactPhone: '9999999999',
    city: 'Mumbai',
    status: 'ACTIVE',
    addressLine1: '123 Industrial Rd',
    addressLine2: null,
    state: 'Maharashtra',
    country: 'India',
    postalCode: '400001',
    ...overrides,
  };
}

describe('buildFactoryDetailViewModel', () => {
  it('maps the identity and address fields', () => {
    const vm = buildFactoryDetailViewModel(makeFactory(), { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.identityItems).toEqual([
      { label: 'Code', value: 'FAC-1' },
      { label: 'Name', value: 'Acme Factory' },
      { label: 'Status', value: 'ACTIVE' },
      { label: 'Contact Name', value: 'Jane Doe' },
      { label: 'Contact Email', value: 'jane@acme.test' },
      { label: 'Contact Phone', value: '9999999999' },
      { label: 'Address Line 1', value: '123 Industrial Rd' },
      { label: 'Address Line 2', value: null },
      { label: 'City', value: 'Mumbai' },
      { label: 'State', value: 'Maharashtra' },
      { label: 'Country', value: 'India' },
      { label: 'Postal Code', value: '400001' },
    ]);
  });

  it('maps the usage counts when present', () => {
    const vm = buildFactoryDetailViewModel(
      makeFactory({ usage: { styleMappings: 3, jobOrders: 4, mappedUsers: 1 } }),
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.usageItems).toEqual([
      { label: 'Style mappings', value: 3 },
      { label: 'Job orders', value: 4 },
      { label: 'Mapped users', value: 1 },
    ]);
  });

  it('defaults usage counts to zero when the record has no usage field', () => {
    const vm = buildFactoryDetailViewModel(makeFactory({ usage: undefined }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.usageItems).toEqual([
      { label: 'Style mappings', value: 0 },
      { label: 'Job orders', value: 0 },
      { label: 'Mapped users', value: 0 },
    ]);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildFactoryDetailViewModel(makeFactory(), {
      generatedAt: '2026-09-12T00:00:00Z',
      generatedBy: 'Test Admin',
    });
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
