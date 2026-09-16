import { describe, expect, it } from 'vitest';
import type { FactoryDispatchSummary, FactoryPackingQueueLine } from '../../types.js';
import { buildFactoryPackingQueueListViewModel } from './buildFactoryPackingQueueListViewModel.js';

function makeAwaitingLine(overrides: Partial<FactoryPackingQueueLine> = {}): FactoryPackingQueueLine {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Distributor One' },
    saleOrderLineId: 'line-1',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeId: 'size-1',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    allocatedQuantity: 40,
    packedQuantity: 10,
    remainingQuantity: 30,
    ...overrides,
  };
}

function makeDispatch(overrides: Partial<FactoryDispatchSummary> = {}): FactoryDispatchSummary {
  return {
    id: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'f1', code: 'F1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [{ id: 'd1', code: 'D1', name: 'Distributor One' }] },
    status: 'DRAFT',
    version: 1,
    preparedAt: '2026-09-01T00:00:00.000Z',
    finalizedAt: null,
    consolidated: false,
    ...overrides,
  };
}

describe('buildFactoryPackingQueueListViewModel', () => {
  it('produces empty sections with zero counts for no data', () => {
    const vm = buildFactoryPackingQueueListViewModel([], [], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.awaitingPackingCount).toBe(0);
    expect(vm.factoryDispatchCount).toBe(0);
  });

  it('maps an Awaiting Packing row with Style/Size/quantities', () => {
    const vm = buildFactoryPackingQueueListViewModel([makeAwaitingLine()], [], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.awaitingPacking[0]).toEqual({
      id: 'line-1',
      saleOrderNumber: 'EISO/26-27/0001',
      distributorName: 'Distributor One',
      styleDisplay: 'ST-001 — Classic Tee',
      sizeLabel: 'Medium',
      allocatedQuantity: 40,
      packedQuantity: 10,
      remainingQuantity: 30,
    });
  });

  it('maps a Factory Dispatch row with joined Distributor names and status label', () => {
    const dispatch = makeDispatch({
      saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [{ id: 'd1', code: 'D1', name: 'Acme' }, { id: 'd2', code: 'D2', name: 'Beta' }] },
    });
    const vm = buildFactoryPackingQueueListViewModel([], [dispatch], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.factoryDispatches[0]).toMatchObject({
      factoryDispatchNumber: 'EIFD/26-27/0001',
      distributorsDisplay: 'Acme, Beta',
      statusLabel: 'Draft',
      consolidated: '—',
    });
  });

  it('labels READY_FOR_ERVE as "Ready for Erve" and consolidated as "Yes"', () => {
    const vm = buildFactoryPackingQueueListViewModel([], [makeDispatch({ status: 'READY_FOR_ERVE', consolidated: true })], {
      generatedAt: '2026-09-15T10:00:00Z',
    });
    expect(vm.factoryDispatches[0]).toMatchObject({ statusLabel: 'Ready for Erve', consolidated: 'Yes' });
  });

  it('preserves row order for both sections (server order), not re-sorted', () => {
    const a = makeAwaitingLine({ saleOrderLineId: 'line-1' });
    const b = makeAwaitingLine({ saleOrderLineId: 'line-2' });
    const vm = buildFactoryPackingQueueListViewModel([a, b], [], { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.awaitingPacking.map((r) => r.id)).toEqual(['line-1', 'line-2']);
  });

  it('does not leak unrelated/internal properties into either printable row', () => {
    const line = { ...makeAwaitingLine(), __internalDebugFlag: true } as FactoryPackingQueueLine;
    const dispatch = { ...makeDispatch(), someAuditInternal: 'secret' } as FactoryDispatchSummary;
    const vm = buildFactoryPackingQueueListViewModel([line], [dispatch], { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
