import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createReleasedQaStock,
  createTestFactory,
  createTestFinancialYear,
  createTestUser,
  createTestUserAndToken,
  allocateTestDocumentSerial,
  resetDatabase,
} from '../../test/helpers.js';
import * as reportsService from './reports.service.js';

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function actor(roles: CurrentUser['roles']): CurrentUser {
  return { id: createId(), roles, factoryIds: [], distributorIds: [] } as unknown as CurrentUser;
}

// A minimal-but-real Job Order row (own Factory/ProcessFlowVersion/Financial
// Year/serial), for hand-calculated fixture cases that need full control
// over status/recordOrigin/requiredDeliveryDate — mirrors
// createTestJobOrderStub but exposes those fields instead of hard-coding
// them.
async function createMinimalJobOrder(options: {
  factoryId?: string;
  status?: 'DRAFT' | 'SENT_TO_FACTORY' | 'CONFIRMED_BY_FACTORY' | 'IN_PRODUCTION' | 'CANCELLED' | 'PRODUCTION_COMPLETE';
  recordOrigin?: 'LIVE_WORKFLOW' | 'HISTORICAL_IMPORT';
  requiredDeliveryDate?: Date | null;
  orderedQuantity?: number;
  preparedQuantity?: number;
}) {
  const factory = options.factoryId ? { id: options.factoryId } : await createTestFactory();
  const processFlow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `RPT-FLOW-${createId()}`,
      name: 'Reports fixture flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const financialYear = await createTestFinancialYear();
  const jobOrderSerial = await allocateTestDocumentSerial('JOB_ORDER', financialYear.id);
  const createdBy = await createTestUser({
    email: `rpt-jo-${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `RPT-${createId()}`,
      styleName: 'Reports fixture style',
      finalMrp: 100,
      seasonId: (
        await prisma.season.create({
          data: { id: createId(), code: `RPT-S-${createId()}`, name: 'RPT Season', financialYearId: financialYear.id },
        })
      ).id,
    },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `SZ-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const orderedQuantity = options.orderedQuantity ?? 10;
  const preparedQuantity = options.preparedQuantity ?? 0;
  const id = createId();
  await prisma.jobOrder.create({
    data: {
      id,
      jobOrderNumber: `RPT-JO-${id}`,
      factoryId: factory.id,
      processFlowVersionId: processFlow.versions[0]!.id,
      unitPrice: 100,
      status: options.status ?? 'DRAFT',
      recordOrigin: options.recordOrigin ?? 'LIVE_WORKFLOW',
      requiredDeliveryDate: options.requiredDeliveryDate,
      createdBy,
      financialYearId: financialYear.id,
      jobOrderSerial,
      preparedQuantityTotal: preparedQuantity,
      lines: {
        create: {
          id: createId(),
          styleId: style.id,
          orderedQuantityTotal: orderedQuantity,
          preparedQuantityTotal: preparedQuantity,
          status: options.status ?? 'DRAFT',
          sizes: {
            create: [{ id: createId(), sizeId: size.id, orderedQuantity, preparedQuantity }],
          },
        },
      },
    },
  });
  return { id, factoryId: factory.id, styleId: style.id, sizeId: size.id };
}

describe('reports.service RBAC (RPT0/RPT1 6.13)', () => {
  it('denies a non-reporting role entirely', async () => {
    await expect(
      reportsService.getOperationsSummary(actor(['QA_USER']), {}),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      reportsService.getOperationsSummary(actor(['FACTORY_USER']), {}),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('gives ADMIN and SENIOR_MANAGEMENT every section, but omits sections MERCHANDISER has no operational scope over', async () => {
    const admin = await reportsService.getOperationsSummary(actor(['ADMIN']), {});
    expect(admin.sectionsOmitted).toEqual([]);
    expect(admin.qa).toBeDefined();
    expect(admin.packing?.cartonsNeverAudited).toBeDefined();

    const seniorManagement = await reportsService.getOperationsSummary(
      actor(['SENIOR_MANAGEMENT']),
      {},
    );
    expect(seniorManagement.sectionsOmitted).toEqual([]);
    expect(seniorManagement.qa).toBeDefined();

    const merchandiser = await reportsService.getOperationsSummary(actor(['MERCHANDISER']), {});
    expect(merchandiser.sectionsOmitted).toContain('qa');
    expect(merchandiser.qa).toBeUndefined();
    expect(merchandiser.sectionsOmitted).toContain('packing.audit');
    expect(merchandiser.packing?.cartonsNeverAudited).toBeUndefined();
    // MERCHANDISER still has packing-pending scope.
    expect(merchandiser.sectionsOmitted).not.toContain('packing.pending');
    expect(merchandiser.packing?.piecesAwaitingPacking).toBeDefined();
    expect(merchandiser.production).toBeDefined();
  });
});

describe('Open/Delayed Job Orders (RPT1 6.2/6.3) — Record Origin default and split', () => {
  it('defaults to LIVE_WORKFLOW, excluding a HISTORICAL_IMPORT Job Order from open/delayed counts', async () => {
    const factory = await createTestFactory();
    const past = new Date('2020-01-01T00:00:00.000Z');
    await createMinimalJobOrder({
      factoryId: factory.id,
      status: 'IN_PRODUCTION',
      recordOrigin: 'LIVE_WORKFLOW',
      requiredDeliveryDate: past,
    });
    await createMinimalJobOrder({
      factoryId: factory.id,
      status: 'IN_PRODUCTION',
      recordOrigin: 'HISTORICAL_IMPORT',
      requiredDeliveryDate: past,
    });

    const live = await reportsService.getProductionReport(actor(['ADMIN']), { factoryId: factory.id });
    const liveWorkload = live.factoryWorkload.find((w) => w.factory.id === factory.id);
    expect(liveWorkload?.openJobOrders).toBe(1);
    expect(liveWorkload?.delayedJobOrders).toBe(1);

    const all = await reportsService.getProductionReport(actor(['ADMIN']), {
      factoryId: factory.id,
      recordOrigin: 'ALL',
    });
    const allWorkload = all.factoryWorkload.find((w) => w.factory.id === factory.id);
    expect(allWorkload?.openJobOrders).toBe(2);
    expect(allWorkload?.delayedJobOrders).toBe(2);

    // Origin is preserved in the pipeline breakdown, never collapsed away.
    const origins = new Set(all.pipeline.map((bucket) => bucket.recordOrigin));
    expect(origins).toEqual(new Set(['LIVE_WORKFLOW', 'HISTORICAL_IMPORT']));
  });

  it('excludes CANCELLED and PRODUCTION_COMPLETE from open/delayed even when overdue, and null Required Delivery Date is never delayed', async () => {
    const factory = await createTestFactory();
    const past = new Date('2020-01-01T00:00:00.000Z');
    await createMinimalJobOrder({ factoryId: factory.id, status: 'CANCELLED', requiredDeliveryDate: past });
    await createMinimalJobOrder({
      factoryId: factory.id,
      status: 'PRODUCTION_COMPLETE',
      requiredDeliveryDate: past,
    });
    await createMinimalJobOrder({ factoryId: factory.id, status: 'IN_PRODUCTION', requiredDeliveryDate: null });

    const report = await reportsService.getProductionReport(actor(['ADMIN']), { factoryId: factory.id });
    const workload = report.factoryWorkload.find((w) => w.factory.id === factory.id);
    // Only the null-required-delivery-date IN_PRODUCTION row is open; none are delayed.
    expect(workload?.openJobOrders).toBe(1);
    expect(workload?.delayedJobOrders).toBe(0);
  });
});

describe('Production quantity flow (RPT1 6.8) — independent measures, cancelled kept separate', () => {
  it('splits cancelled ordered quantity from the primary ordered measure and never inflates it', async () => {
    const factory = await createTestFactory();
    await createMinimalJobOrder({
      factoryId: factory.id,
      status: 'IN_PRODUCTION',
      orderedQuantity: 100,
      preparedQuantity: 40,
    });
    await createMinimalJobOrder({
      factoryId: factory.id,
      status: 'CANCELLED',
      orderedQuantity: 25,
      preparedQuantity: 0,
    });

    const report = await reportsService.getProductionReport(actor(['ADMIN']), { factoryId: factory.id });
    const flow = report.quantityFlow.find((f) => f.factory.id === factory.id);
    expect(flow?.orderedPieces).toBe(100);
    expect(flow?.cancelledOrderedPieces).toBe(25);
    expect(flow?.preparedPieces).toBe(40);
  });
});

describe('QA-passed available stock (RPT1 6.4) — no join multiplication', () => {
  it('pools two release lines at the same Factory+Style+Size without multiplying, then subtracts a committed allocation', async () => {
    const stockA = await createReleasedQaStock({ quantity: 30 });
    await createReleasedQaStock({
      factoryId: stockA.factoryId,
      styleId: stockA.styleId,
      sizeId: stockA.sizeId,
      quantity: 20,
    });

    const before = await reportsService.getOperationsSummary(actor(['ADMIN']), {
      factoryId: stockA.factoryId,
    });
    // Sum of both releases, not multiplied by anything — a naive join of
    // release lines against allocations (of which there are zero so far)
    // would still equal this, so this alone isn't sufficient; the
    // allocation case below is the real multiplication check.
    expect(before.qa?.availableStockPieces).toBe(50);

    const merchTokenResult = await createTestUserAndToken({
      email: `merch-${createId()}@test.local`,
      password: 'pass',
      roles: ['MERCHANDISER'],
    });
    const created = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${merchTokenResult.token}`)
      .set('Idempotency-Key', createId())
      .send({
        distributors: [
          {
            clientKey: 'dg1',
            distributorId: stockA.distributorId,
            destinations: [
              { clientKey: 'd1', addressLine1: 'Test Street', city: 'Chennai', state: 'TN', country: 'India' },
            ],
          },
        ],
        factoryId: stockA.factoryId,
        soDate: '2026-06-30',
        lines: [{ destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: 12 }],
      })
      .expect(201);
    expect(created.body.data.id).toBeTruthy();

    const after = await reportsService.getOperationsSummary(actor(['ADMIN']), {
      factoryId: stockA.factoryId,
    });
    // 50 released - 12 committed = 38, computed from two independent
    // aggregates (release lines, active allocations) merged in memory —
    // never a single SUM over a join of the two, which would multiply.
    expect(after.qa?.availableStockPieces).toBe(38);
  });
});

describe('Packing Audit carton classification (RPT1 6.5/6.9)', () => {
  async function createDraftDispatchWithCarton(auditVersions: number[]) {
    const factory = await createTestFactory();
    const financialYear = await createTestFinancialYear();
    const preparedBy = await createTestUser({
      email: `packer-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    const distributor = await prisma.distributor.create({
      data: { id: createId(), code: `D-${createId()}`, name: 'Fixture Distributor', gstin: '27AAAAA0000A1Z5', purchaseMode: 'OUTRIGHT' },
    });
    const saleOrder = await prisma.saleOrder.create({
      data: {
        id: createId(),
        saleOrderNumber: `SO-${createId()}`,
        factoryId: factory.id,
        soDate: new Date(),
        createdBy: preparedBy,
        financialYearId: financialYear.id,
        soSerial: await allocateTestDocumentSerial('SALE_ORDER', financialYear.id),
      },
    });
    const saleOrderDistributor = await prisma.saleOrderDistributor.create({
      data: {
        id: createId(),
        saleOrderId: saleOrder.id,
        distributorId: distributor.id,
        purchaseMode: 'OUTRIGHT',
      },
    });
    const destination = await prisma.saleOrderDestination.create({
      data: {
        id: createId(),
        saleOrderId: saleOrder.id,
        saleOrderDistributorId: saleOrderDistributor.id,
        addressLine1: 'Test Street',
        city: 'Chennai',
        state: 'TN',
        country: 'India',
      },
    });
    const dispatch = await prisma.factoryDispatch.create({
      data: {
        id: createId(),
        factoryDispatchNumber: `FD-${createId()}`,
        factoryId: factory.id,
        saleOrderId: saleOrder.id,
        status: 'DRAFT',
        preparedById: preparedBy,
        financialYearId: financialYear.id,
        factoryDispatchSerial: await allocateTestDocumentSerial('FACTORY_DISPATCH', financialYear.id),
      },
    });
    const carton = await prisma.factoryPackingCarton.create({
      data: {
        id: createId(),
        factoryDispatchId: dispatch.id,
        destinationId: destination.id,
        cartonNumber: 'C-1',
        version: auditVersions.length > 0 ? Math.max(...auditVersions, 1) : 1,
        createdById: preparedBy,
      },
    });
    for (const version of auditVersions) {
      await prisma.factoryPackingCartonAudit.create({
        data: { id: createId(), cartonId: carton.id, cartonVersion: version, inspectedById: preparedBy },
      });
    }
    return { factoryId: factory.id };
  }

  it('classifies never-audited, needing-reinspection (stale) and currently-passed cartons distinctly', async () => {
    const neverAudited = await createDraftDispatchWithCarton([]);
    const currentlyPassed = await createDraftDispatchWithCarton([1]);
    // version bumped to 2 after the audit at version 1 — stale.
    const staleFixture = await createDraftDispatchWithCarton([1]);
    await prisma.factoryPackingCarton.updateMany({
      where: { factoryDispatch: { factoryId: staleFixture.factoryId } },
      data: { version: 2 },
    });

    const report = await reportsService.getFulfillmentReport(actor(['ADMIN']), {
      factoryId: neverAudited.factoryId,
    });
    expect(report.packingAudit.neverAudited).toBe(1);
    expect(report.packingAudit.currentlyPassed).toBe(0);

    const passedReport = await reportsService.getFulfillmentReport(actor(['ADMIN']), {
      factoryId: currentlyPassed.factoryId,
    });
    expect(passedReport.packingAudit.currentlyPassed).toBe(1);
    expect(passedReport.packingAudit.neverAudited).toBe(0);

    const staleReport = await reportsService.getFulfillmentReport(actor(['ADMIN']), {
      factoryId: staleFixture.factoryId,
    });
    expect(staleReport.packingAudit.needingReinspection).toBe(1);
    expect(staleReport.packingAudit.currentlyPassed).toBe(0);
  });
});

describe('Delivery source split (RPT1 6.7/6.9) — legacy vs user-confirmed stay distinguishable', () => {
  it('never merges LEGACY_ASSUMED_FULL_RECEIPT into USER_CONFIRMED counts', async () => {
    const distributor = await prisma.distributor.create({
      data: { id: createId(), code: `D-${createId()}`, name: 'Delivery Fixture', gstin: '27AAAAA0000A1Z5', purchaseMode: 'OUTRIGHT' },
    });
    const financialYear = await createTestFinancialYear();
    const actorId = await createTestUser({
      email: `dispatcher-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    async function createDeliveredDispatch(source: 'USER_CONFIRMED' | 'LEGACY_ASSUMED_FULL_RECEIPT') {
      const packingList = await prisma.ervePackingList.create({
        data: {
          id: createId(),
          ervePackingListNumber: `EPL-${createId()}`,
          distributorId: distributor.id,
          status: 'DISPATCHED',
          createdById: actorId,
          financialYearId: financialYear.id,
          ervePackingListSerial: await allocateTestDocumentSerial('ERVE_PACKING_LIST', financialYear.id),
        },
      });
      await prisma.erveDispatch.create({
        data: {
          id: createId(),
          erveDispatchNumber: `ED-${createId()}`,
          ervePackingListId: packingList.id,
          distributorId: distributor.id,
          status: 'DELIVERED',
          dispatchDate: new Date(),
          dispatchedById: actorId,
          deliveredById: source === 'USER_CONFIRMED' ? actorId : null,
          deliveredAt: source === 'USER_CONFIRMED' ? new Date() : null,
          deliveryConfirmationSource: source,
          financialYearId: financialYear.id,
          erveDispatchSerial: await allocateTestDocumentSerial('ERVE_DISPATCH', financialYear.id),
        },
      });
    }
    await createDeliveredDispatch('USER_CONFIRMED');
    await createDeliveredDispatch('LEGACY_ASSUMED_FULL_RECEIPT');
    await createDeliveredDispatch('LEGACY_ASSUMED_FULL_RECEIPT');

    const report = await reportsService.getFulfillmentReport(actor(['ADMIN']), {
      distributorId: distributor.id,
    });
    expect(report.delivery.userConfirmed).toBe(1);
    expect(report.delivery.legacyAssumedFullReceipt).toBe(2);
  });
});

describe('Distributor Returns report (RPT1 6.12) — cancelled-after-approved trap', () => {
  it("does not expose a cancelled return's retained approvedQuantity as currently-approved exposure", async () => {
    const financialYear = await createTestFinancialYear();
    const actorId = await createTestUser({
      email: `returns-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });
    const distributor = await prisma.distributor.create({
      data: { id: createId(), code: `D-${createId()}`, name: 'Return Fixture', gstin: '27AAAAA0000A1Z5', purchaseMode: 'SALE_RETURN' },
    });
    const factory = await createTestFactory();
    const style = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `RET-${createId()}`,
        styleName: 'Return fixture style',
        finalMrp: 100,
        seasonId: (
          await prisma.season.create({
            data: { id: createId(), code: `RET-S-${createId()}`, name: 'Ret Season', financialYearId: financialYear.id },
          })
        ).id,
      },
    });
    const size = await prisma.size.create({
      data: { id: createId(), code: `SZ-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
    });
    const saleOrder = await prisma.saleOrder.create({
      data: {
        id: createId(),
        saleOrderNumber: `SO-${createId()}`,
        factoryId: factory.id,
        soDate: new Date(),
        createdBy: actorId,
        financialYearId: financialYear.id,
        soSerial: await allocateTestDocumentSerial('SALE_ORDER', financialYear.id),
      },
    });
    const saleOrderDistributor = await prisma.saleOrderDistributor.create({
      data: {
        id: createId(),
        saleOrderId: saleOrder.id,
        distributorId: distributor.id,
        purchaseMode: 'SALE_RETURN',
      },
    });
    const destination = await prisma.saleOrderDestination.create({
      data: {
        id: createId(),
        saleOrderId: saleOrder.id,
        saleOrderDistributorId: saleOrderDistributor.id,
        addressLine1: 'Test Street',
        city: 'Chennai',
        state: 'TN',
        country: 'India',
      },
    });
    const saleOrderLine = await prisma.saleOrderLine.create({
      data: {
        id: createId(),
        saleOrderId: saleOrder.id,
        destinationId: destination.id,
        styleId: style.id,
        sizeId: size.id,
        quantity: 20,
      },
    });
    const packingList = await prisma.ervePackingList.create({
      data: {
        id: createId(),
        ervePackingListNumber: `EPL-${createId()}`,
        distributorId: distributor.id,
        status: 'DISPATCHED',
        createdById: actorId,
        financialYearId: financialYear.id,
        ervePackingListSerial: await allocateTestDocumentSerial('ERVE_PACKING_LIST', financialYear.id),
      },
    });
    const erveDispatch = await prisma.erveDispatch.create({
      data: {
        id: createId(),
        erveDispatchNumber: `ED-${createId()}`,
        ervePackingListId: packingList.id,
        distributorId: distributor.id,
        status: 'DELIVERED',
        dispatchDate: new Date(),
        dispatchedById: actorId,
        deliveredById: actorId,
        deliveredAt: new Date(),
        deliveryConfirmationSource: 'USER_CONFIRMED',
        financialYearId: financialYear.id,
        erveDispatchSerial: await allocateTestDocumentSerial('ERVE_DISPATCH', financialYear.id),
      },
    });
    const distributorReturn = await prisma.distributorReturn.create({
      data: {
        id: createId(),
        returnNumber: `DR-${createId()}`,
        distributorId: distributor.id,
        returnDate: new Date(),
        status: 'APPROVED',
        returnReason: 'Fixture',
        submittedById: actorId,
        approvedById: actorId,
        approvedAt: new Date(),
        financialYearId: financialYear.id,
        returnSerial: await allocateTestDocumentSerial('DISTRIBUTOR_RETURN', financialYear.id),
        lines: {
          create: {
            id: createId(),
            erveDispatchId: erveDispatch.id,
            saleOrderLineId: saleOrderLine.id,
            requestedQuantity: 20,
            approvedQuantity: 15,
          },
        },
      },
    });

    const approvedBefore = await reportsService.getDistributorReturnsReport(actor(['ADMIN']), {
      distributorId: distributor.id,
      groupBy: 'status',
    });
    expect(approvedBefore.rows.find((r) => r.status === 'APPROVED')?.approvedActive).toBe(15);

    // The real cancel mutation only flips the parent's status — it never
    // clears the line's approvedQuantity (distributor-return.service.ts).
    await prisma.distributorReturn.update({
      where: { id: distributorReturn.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actorId },
    });

    const afterCancel = await reportsService.getDistributorReturnsReport(actor(['ADMIN']), {
      distributorId: distributor.id,
      groupBy: 'status',
    });
    const cancelledRow = afterCancel.rows.find((row) => row.status === 'CANCELLED');
    expect(cancelledRow?.requested).toBe(20);
    expect(cancelledRow?.approvedActive).toBe(0);
    expect(afterCancel.rows.find((r) => r.status === 'APPROVED')).toBeUndefined();
  });
});
