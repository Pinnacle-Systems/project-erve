import { describe, expect, it } from 'vitest';
import { canViewErveFactoryProvenance, ERVE_PACKING_LIST_PROVENANCE_ROLES } from '@erve/shared';
import type { Role } from '@erve/types';
import { toPackingListDetail, toPackingListSummary } from './erve-dispatch.service.js';

// DEMO-020 — distributor/supplier confidentiality.
//
// ERVE_PACKING_LIST_VIEW_ROLES (the route/middleware gate on GET
// /erve-packing-lists) already excludes DISTRIBUTOR and ACCOUNTANT today, so
// an HTTP-level test can only prove "403 Forbidden" for those roles — it can
// never reach the DTO-building code to prove the DTO itself redacts factory/
// supplier provenance. These tests call the exported pure mappers directly,
// independent of the route gate, so they fail if someone later re-adds
// `factory`/`factoryDispatchId`/`factoryDispatchNumber`/`sourceFactories` to
// the output unconditionally (e.g. by inlining the carton/record fields
// instead of going through the includeProvenance branch) — regardless of
// whether ERVE_PACKING_LIST_VIEW_ROLES is ever widened to admit a role that
// isn't authorized to see provenance.

type PackingListRecordArg = Parameters<typeof toPackingListDetail>[0];

function buildFixtureRecord(): PackingListRecordArg {
  const factory = { id: 'fac-1', code: 'FAC1', name: 'Confidential Factory Pvt Ltd' };
  const saleOrder = { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' };
  const style = { id: 'style-1', styleNumber: 'ST-100', styleName: 'Classic Shirt' };
  const size = { id: 'size-1', code: 'M', label: 'Medium' };

  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    saleOrder,
    status: 'OPEN',
    createdBy: { id: 'user-1', name: 'Merch User', email: 'merch@test.local' },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    finalizedBy: null,
    finalizedAt: null,
    destinationLabel: 'Warehouse A',
    destinationContactName: 'Contact Name',
    destinationContactEmail: 'contact@test.local',
    destinationContactPhone: '9999999999',
    destinationAddressLine1: 'Address Line 1',
    destinationAddressLine2: null,
    destinationCity: 'Chennai',
    destinationState: 'TN',
    destinationCountry: 'India',
    destinationPostalCode: '600001',
    dispatch: null,
    cartons: [
      {
        id: 'carton-1',
        cartonNumber: 'C1',
        packageDetails: null,
        weight: null,
        factoryDispatch: {
          id: 'fd-1',
          factoryDispatchNumber: 'EIFD/26-27/0001',
          factory,
          saleOrder,
        },
        lines: [
          {
            saleOrderLineId: 'sol-1',
            quantity: 5,
            saleOrderLine: { style, size },
          },
        ],
      },
    ],
  } as unknown as PackingListRecordArg;
}

describe('DEMO-020 — Erve Packing List factory/supplier provenance redaction', () => {
  it('canViewErveFactoryProvenance excludes DISTRIBUTOR and ACCOUNTANT', () => {
    expect(canViewErveFactoryProvenance({ roles: ['DISTRIBUTOR'] })).toBe(false);
    expect(canViewErveFactoryProvenance({ roles: ['ACCOUNTANT'] })).toBe(false);
  });

  it.each(ERVE_PACKING_LIST_PROVENANCE_ROLES)('canViewErveFactoryProvenance admits %s', (role: Role) => {
    expect(canViewErveFactoryProvenance({ roles: [role] })).toBe(true);
  });

  it('toPackingListDetail omits sourceFactories and every carton.factory*/factoryDispatch* field when includeProvenance is false', () => {
    const detail = toPackingListDetail(buildFixtureRecord(), false);

    expect(detail).not.toHaveProperty('sourceFactories');
    expect(detail.cartons).toHaveLength(1);
    expect(detail.cartons[0]).not.toHaveProperty('factory');
    expect(detail.cartons[0]).not.toHaveProperty('factoryDispatchId');
    expect(detail.cartons[0]).not.toHaveProperty('factoryDispatchNumber');

    // Non-confidential, ordinary operational fields must still be present —
    // this is a confidentiality boundary, not a wholesale data strip.
    expect(detail.ervePackingListNumber).toBe('EIPL/26-27/0001');
    expect(detail.distributor?.name).toBe('Distributor One');
    expect(detail.cartonCount).toBe(1);
    expect(detail.totalQuantity).toBe(5);
    expect(detail.cartons[0]?.cartonNumber).toBe('C1');
    expect(detail.cartons[0]?.saleOrder.saleOrderNumber).toBe('EISO/26-27/0001');
    expect(detail.sourceDispatchOrders).toEqual([{ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' }]);
    expect(detail.styleSizeSummary).toEqual([{ styleNumber: 'ST-100', styleName: 'Classic Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 5 }]);
  });

  it('toPackingListSummary omits sourceFactories when includeProvenance is false', () => {
    const summary = toPackingListSummary(buildFixtureRecord(), false);
    expect(summary).not.toHaveProperty('sourceFactories');
    expect(summary.sourceDispatchOrders).toEqual([{ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' }]);
  });

  it('toPackingListDetail/toPackingListSummary still return full provenance when includeProvenance is true (ADMIN/MERCHANDISER/SENIOR_MANAGEMENT must not regress)', () => {
    const record = buildFixtureRecord();

    const detail = toPackingListDetail(record, true);
    expect(detail.sourceFactories).toEqual([{ id: 'fac-1', code: 'FAC1', name: 'Confidential Factory Pvt Ltd' }]);
    expect(detail.cartons[0]?.factory).toEqual({ id: 'fac-1', code: 'FAC1', name: 'Confidential Factory Pvt Ltd' });
    expect(detail.cartons[0]?.factoryDispatchId).toBe('fd-1');
    expect(detail.cartons[0]?.factoryDispatchNumber).toBe('EIFD/26-27/0001');

    const summary = toPackingListSummary(record, true);
    expect(summary.sourceFactories).toEqual([{ id: 'fac-1', code: 'FAC1', name: 'Confidential Factory Pvt Ltd' }]);
  });
});
