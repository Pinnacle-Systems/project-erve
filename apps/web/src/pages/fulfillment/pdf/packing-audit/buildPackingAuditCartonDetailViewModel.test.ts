import { describe, expect, it } from 'vitest';
import {
  buildPackingAuditCartonDetailViewModel,
  type PackingAuditCartonDetailSource,
} from './buildPackingAuditCartonDetailViewModel.js';

function makeCarton(overrides: Partial<PackingAuditCartonDetailSource> = {}): PackingAuditCartonDetailSource {
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
    lines: [
      { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, currentDestinationId: 'dest-1' },
    ],
    auditHistory: [],
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'f1', code: 'F1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    destination: { id: 'dest-1', label: 'Store 1', city: 'Chennai', state: 'TN', distributor: { id: 'd1', code: 'D1', name: 'Distributor One' } },
    factoryDispatchId: 'fd-1',
    ...overrides,
  };
}

describe('buildPackingAuditCartonDetailViewModel', () => {
  it('maps carton identity including Distributor/Destination context', () => {
    const vm = buildPackingAuditCartonDetailViewModel(makeCarton(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.identityItems).toEqual([
      { label: 'Carton Number', value: 'C1' },
      { label: 'Dispatch Order', value: 'EISO/26-27/0001' },
      { label: 'Factory', value: 'Factory One' },
      { label: 'Distributor', value: 'Distributor One' },
      { label: 'Destination', value: 'Store 1' },
      { label: 'Audit State', value: 'Not Inspected' },
    ]);
  });

  it('falls back to city when the destination has no label', () => {
    const vm = buildPackingAuditCartonDetailViewModel(
      makeCarton({ destination: { id: 'dest-1', label: null, city: 'Chennai', state: 'TN', distributor: { id: 'd1', code: 'D1', name: 'Distributor One' } } }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.identityItems.find((i) => i.label === 'Destination')?.value).toBe('Chennai');
  });

  it('maps carton contents and total quantity', () => {
    const vm = buildPackingAuditCartonDetailViewModel(makeCarton(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.lines).toEqual([{ id: 'line-1', styleDisplay: 'ST-001 — Classic Tee', sizeLabel: 'Medium', quantity: 10 }]);
    expect(vm.totalQuantity).toBe(10);
  });

  it('maps retired and destinationMismatch flags', () => {
    const vm = buildPackingAuditCartonDetailViewModel(makeCarton({ retired: true, destinationMismatch: true }), {
      generatedAt: '2026-09-15T10:00:00Z',
    });
    expect(vm.retired).toBe(true);
    expect(vm.destinationMismatch).toBe(true);
  });

  it('maps a multi-entry audit history preserving version order and remarks', () => {
    const carton = makeCarton({
      auditState: 'NEEDS_REINSPECTION',
      auditHistory: [
        { cartonVersion: 1, inspectedById: 'qa-1', inspectedByName: 'QA One', inspectedAt: '2026-09-01T00:00:00.000Z', remarks: 'looks good' },
        { cartonVersion: 2, inspectedById: 'qa-2', inspectedByName: 'QA Two', inspectedAt: '2026-09-05T00:00:00.000Z', remarks: null },
      ],
    });
    const vm = buildPackingAuditCartonDetailViewModel(carton, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.auditHistory).toHaveLength(2);
    expect(vm.auditHistory[0]).toMatchObject({ cartonVersion: 1, inspectedByName: 'QA One', remarks: 'looks good' });
    expect(vm.auditHistory[1]).toMatchObject({ cartonVersion: 2, inspectedByName: 'QA Two', remarks: null });
  });

  it('never invents a PASS/FAIL audit outcome', () => {
    const vm = buildPackingAuditCartonDetailViewModel(makeCarton(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(JSON.stringify(vm).toLowerCase()).not.toMatch(/\bpass\b|\bfail\b/);
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const carton = { ...makeCarton(), __internalDebugFlag: true, someAuditInternal: 'secret' } as PackingAuditCartonDetailSource;
    const vm = buildPackingAuditCartonDetailViewModel(carton, { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });

  it('never receives or leaks an unsaved "Confirm Inspected" remarks draft — only the persisted auditHistory reaches the view model', () => {
    // buildPackingAuditCartonDetailViewModel's signature takes no "draft remarks" parameter at all;
    // this test locks in that the only remarks text that can ever appear come from auditHistory
    // entries, which are the server-persisted record, not the page's local useState draft.
    const vm = buildPackingAuditCartonDetailViewModel(makeCarton(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.auditHistory).toEqual([]);
  });
});
