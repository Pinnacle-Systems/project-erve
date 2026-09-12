import { describe, expect, it } from 'vitest';
import type { Factory } from '../types.js';
import { buildFactoryListViewModel } from './buildFactoryListViewModel.js';

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
    ...overrides,
  };
}

describe('buildFactoryListViewModel', () => {
  it('maps factories into rows and preserves API row order', () => {
    const factories = [makeFactory({ id: 'a' }), makeFactory({ id: 'b' })];
    const vm = buildFactoryListViewModel(factories, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.totalCount).toBe(2);
  });

  it('carries through null contact fields for the em-dash formatter to handle', () => {
    const vm = buildFactoryListViewModel(
      [makeFactory({ contactName: null, contactEmail: null, contactPhone: null })],
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.rows[0]).toMatchObject({ contactName: null, contactEmail: null, contactPhone: null });
  });

  it('handles an empty factory list', () => {
    const vm = buildFactoryListViewModel([], { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildFactoryListViewModel([], {
      generatedAt: '2026-09-12T00:00:00Z',
      generatedBy: 'Test Admin',
    });
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
