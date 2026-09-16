import { describe, expect, it } from 'vitest';
import type { ErvePackingListSummary } from '../../types.js';
import { buildErvePackingListListViewModel } from './buildErvePackingListListViewModel.js';

function makePackingList(overrides: Partial<ErvePackingListSummary> = {}): ErvePackingListSummary {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    saleOrder: null,
    destination: {
      label: 'Mumbai Warehouse',
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      addressLine1: '123 Main St',
      addressLine2: null,
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      postalCode: '400001',
    },
    status: 'OPEN',
    createdBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    createdAt: '2026-06-30T00:00:00.000Z',
    cartonCount: 2,
    totalQuantity: 50,
    sourceFactories: [{ id: 'f1', code: 'F1', name: 'Acme Factory' }],
    sourceDispatchOrders: [{ id: 'so1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    ...overrides,
  };
}

describe('buildErvePackingListListViewModel', () => {
  it('maps rows with distributor/destination text, counts, and status label', () => {
    const vm = buildErvePackingListListViewModel([makePackingList()], { generatedAt: '2026-07-01T10:00:00Z', generatedBy: 'Test User' });

    expect(vm.totalCount).toBe(1);
    expect(vm.rows[0]).toEqual({
      id: 'epl-1',
      ervePackingListNumber: 'EIPL/26-27/0001',
      distributorName: 'Acme Distributors',
      destinationDisplay: 'Mumbai, Maharashtra',
      cartonCount: 2,
      totalQuantity: 50,
      sourceFactoryCount: 1,
      sourceDispatchOrderCount: 1,
      statusLabel: 'Open',
      createdAt: '30 Jun 2026',
    });
  });

  it('shows counts (not raw ids) for cross-Factory/cross-Dispatch-Order consolidation', () => {
    const vm = buildErvePackingListListViewModel(
      [
        makePackingList({
          sourceFactories: [
            { id: 'f1', code: 'F1', name: 'Factory One' },
            { id: 'f2', code: 'F2', name: 'Factory Two' },
          ],
          sourceDispatchOrders: [
            { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
            { id: 'so2', saleOrderNumber: 'EISO/26-27/0002' },
          ],
        }),
      ],
      { generatedAt: '2026-07-01T10:00:00Z' },
    );

    expect(vm.rows[0]?.sourceFactoryCount).toBe(2);
    expect(vm.rows[0]?.sourceDispatchOrderCount).toBe(2);
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('"f1"');
    expect(serialized).not.toContain('"so1"');
  });

  it('handles a missing distributor/destination gracefully', () => {
    const vm = buildErvePackingListListViewModel(
      [makePackingList({ distributor: null, destination: { ...makePackingList().destination, city: null, state: null } })],
      { generatedAt: '2026-07-01T10:00:00Z' },
    );

    expect(vm.rows[0]?.distributorName).toBe('');
    expect(vm.rows[0]?.destinationDisplay).toBe('');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const packingList = { ...makePackingList(), internalId: 'secret-internal', rawSnapshotJson: '{}' } as ErvePackingListSummary;
    const vm = buildErvePackingListListViewModel([packingList], { generatedAt: '2026-07-01T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalId');
    expect(serialized).not.toContain('rawSnapshotJson');
  });
});
