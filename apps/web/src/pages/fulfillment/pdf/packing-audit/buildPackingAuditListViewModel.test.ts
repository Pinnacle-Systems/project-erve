import { describe, expect, it } from 'vitest';
import type { PackingAuditQueueItem } from '../../types.js';
import { buildPackingAuditListViewModel } from './buildPackingAuditListViewModel.js';

function makeItem(overrides: Partial<PackingAuditQueueItem> = {}): PackingAuditQueueItem {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    weight: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'NOT_INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [],
    auditHistory: [],
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'f1', code: 'F1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    destination: { id: 'dest-1', label: 'Store 1', city: 'Chennai', state: 'TN', distributor: { id: 'd1', code: 'D1', name: 'Distributor One' } },
    ...overrides,
  };
}

describe('buildPackingAuditListViewModel', () => {
  it('produces a "Packing Audit Queue" title (not "all audits") and zero rows for an empty queue', () => {
    const vm = buildPackingAuditListViewModel([], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.title).toBe('PACKING AUDIT QUEUE');
    expect(vm.subtitle.toLowerCase()).not.toContain('all packing audits');
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('maps Dispatch Order, Factory, Carton #, quantity and audit state for a single row', () => {
    const vm = buildPackingAuditListViewModel([makeItem()], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows[0]).toEqual({
      id: 'carton-1',
      saleOrderNumber: 'EISO/26-27/0001',
      factoryName: 'Factory One',
      cartonNumber: 'C1',
      totalQuantity: 10,
      auditStateLabel: 'Not Inspected',
    });
  });

  it('labels every derived audit state correctly and never invents PASS/FAIL', () => {
    const vm = buildPackingAuditListViewModel(
      [makeItem({ id: 'c1', auditState: 'INSPECTED' }), makeItem({ id: 'c2', auditState: 'NEEDS_REINSPECTION' })],
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.rows.map((r) => r.auditStateLabel)).toEqual(['Inspected', 'Needs Reinspection']);
    expect(JSON.stringify(vm).toLowerCase()).not.toMatch(/\bpass\b|\bfail\b/);
  });

  it('preserves row order as given (server order), not re-sorted', () => {
    const a = makeItem({ id: 'c1' });
    const b = makeItem({ id: 'c2' });
    const vm = buildPackingAuditListViewModel([a, b], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('does not leak unrelated/internal properties into the printable row', () => {
    const item = { ...makeItem(), __internalDebugFlag: true, someAuditInternal: 'secret' } as PackingAuditQueueItem;
    const vm = buildPackingAuditListViewModel([item], { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm.rows[0]);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
