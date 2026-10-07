import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestFactory,
  createTestFinancialYear,
  createTestUser,
  resetDatabase,
} from '../../test/helpers.js';
import {
  createDistributorToken,
  createRoleToken,
} from './fulfillment-test-helpers.js';
import {
  decodePositionCursor,
  encodePositionCursor,
  getSaleOrReturnGroupedTotals,
  getSaleOrReturnRemainingTotal,
  listSaleOrReturnPositionsPage,
} from './sale-or-return-position-query.service.js';
import { listSaleOrReturnPositions } from './distributor-sales-report.service.js';
import { computeAvailability } from './sale-or-return-quantities.js';

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

let seqCounter = 1;
function nextSeq() {
  return seqCounter++;
}

function makeUser(roles: CurrentUser['roles'], distributorIds: string[] = []): CurrentUser {
  return { id: createId(), roles, factoryIds: [], distributorIds } as unknown as CurrentUser;
}

interface PositionFixtureOptions {
  distributorId?: string;
  purchaseMode?: 'SALE_RETURN' | 'OUTRIGHT';
  cartonQuantities?: number[];
  cartonRetired?: boolean;
  onErvePackingList?: boolean;
  hasErveDispatch?: boolean;
  receivedQuantity?: number;
  salesReports?: number[];
  returns?: Array<{
    status: 'RECEIVED' | 'APPROVED' | 'SUBMITTED' | 'REJECTED' | 'CANCELLED';
    requestedQuantity: number;
    approvedQuantity?: number;
    receivedQuantity?: number;
  }>;
  styleNumber?: string;
  styleName?: string;
  existingStyle?: { id: string; styleNumber: string; styleName: string };
  dispatchDate?: Date;
  sharedContext?: {
    financialYear: { id: string };
    actorId: string;
    factory: { id: string };
    season: { id: string };
    size: { id: string; code: string; label: string };
  };
}

async function createSharedTestContext() {
  const financialYear = await createTestFinancialYear();
  const actorId = await createTestUser({ email: `actor-${nextSeq()}-${createId()}@test.local`, password: 'pass', roles: ['ADMIN'] });
  const factory = await createTestFactory();
  const season = await prisma.season.create({
    data: { id: createId(), code: `S-${nextSeq()}-${createId()}`, name: 'Season', financialYearId: financialYear.id },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `SZ-${nextSeq()}-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
  });
  return { financialYear, actorId, factory, season, size };
}

async function createPositionFixture(options: PositionFixtureOptions = {}) {
  const ctx = options.sharedContext ?? (await createSharedTestContext());
  const { financialYear, actorId, factory, season, size } = ctx;

  let distributorId = options.distributorId;
  let distributorCode = `D-${nextSeq()}-${createId()}`;
  let distributorName = 'Distributor ' + distributorCode;
  if (!distributorId) {
    const d = await prisma.distributor.create({
      data: {
        id: createId(),
        code: distributorCode,
        name: distributorName,
        gstin: '27AAAAA0000A1Z5',
        purchaseMode: options.purchaseMode ?? 'SALE_RETURN',
      },
    });
    distributorId = d.id;
    distributorCode = d.code;
    distributorName = d.name;
  } else {
    const existing = await prisma.distributor.findUniqueOrThrow({ where: { id: distributorId } });
    distributorCode = existing.code;
    distributorName = existing.name;
  }

  const style =
    options.existingStyle ??
    (await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: options.styleNumber ?? `ST-${nextSeq()}-${createId()}`,
        styleName: options.styleName ?? 'Test Style',
        finalMrp: 100,
        seasonId: season.id,
      },
    }));

  const cartonQuantities = options.cartonQuantities ?? [100];
  const totalQuantity = cartonQuantities.reduce((a, b) => a + b, 0);

  const saleOrder = await prisma.saleOrder.create({
    data: {
      id: createId(),
      saleOrderNumber: `SO-${nextSeq()}-${createId()}`,
      factoryId: factory.id,
      soDate: new Date(),
      createdBy: actorId,
      financialYearId: financialYear.id,
      soSerial: nextSeq(),
    },
  });

  const saleOrderDistributor = await prisma.saleOrderDistributor.create({
    data: {
      id: createId(),
      saleOrderId: saleOrder.id,
      distributorId,
      purchaseMode: options.purchaseMode ?? 'SALE_RETURN',
    },
  });

  const destination = await prisma.saleOrderDestination.create({
    data: {
      id: createId(),
      saleOrderId: saleOrder.id,
      saleOrderDistributorId: saleOrderDistributor.id,
      addressLine1: 'Test Destination',
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
      quantity: totalQuantity,
    },
  });

  const factoryDispatch = await prisma.factoryDispatch.create({
    data: {
      id: createId(),
      factoryDispatchNumber: `FD-${nextSeq()}-${createId()}`,
      factoryId: factory.id,
      saleOrderId: saleOrder.id,
      status: 'READY_FOR_ERVE',
      preparedById: actorId,
      financialYearId: financialYear.id,
      factoryDispatchSerial: nextSeq(),
    },
  });

  const onErvePackingList = options.onErvePackingList !== false;
  const hasErveDispatch = options.hasErveDispatch !== false;

  let ervePackingList: { id: string } | null = null;
  let erveDispatch: { id: string; erveDispatchNumber: string; dispatchDate: Date } | null = null;

  if (onErvePackingList) {
    ervePackingList = await prisma.ervePackingList.create({
      data: {
        id: createId(),
        ervePackingListNumber: `EPL-${nextSeq()}-${createId()}`,
        distributorId,
        status: 'DISPATCHED',
        createdById: actorId,
        financialYearId: financialYear.id,
        ervePackingListSerial: nextSeq(),
      },
    });

    if (hasErveDispatch) {
      erveDispatch = await prisma.erveDispatch.create({
        data: {
          id: createId(),
          erveDispatchNumber: `ED-${nextSeq()}-${createId()}`,
          ervePackingListId: ervePackingList.id,
          distributorId,
          status: 'DELIVERED',
          dispatchDate: options.dispatchDate ?? new Date('2026-07-01'),
          dispatchedById: actorId,
          deliveredById: actorId,
          deliveredAt: new Date('2026-07-02'),
          deliveryConfirmationSource: 'USER_CONFIRMED',
          financialYearId: financialYear.id,
          erveDispatchSerial: nextSeq(),
        },
      });
    }
  }

  for (let i = 0; i < cartonQuantities.length; i++) {
    const qty = cartonQuantities[i]!;
    const carton = await prisma.factoryPackingCarton.create({
      data: {
        id: createId(),
        factoryDispatchId: factoryDispatch.id,
        destinationId: destination.id,
        cartonNumber: `C${i + 1}-${nextSeq()}-${createId()}`,
        ervePackingListId: ervePackingList?.id ?? null,
        createdById: actorId,
        retiredAt: options.cartonRetired ? new Date() : null,
      },
    });

    await prisma.factoryPackingCartonLine.create({
      data: {
        id: createId(),
        cartonId: carton.id,
        saleOrderLineId: saleOrderLine.id,
        quantity: qty,
      },
    });
  }

  if (erveDispatch && options.receivedQuantity !== undefined) {
    await prisma.erveDispatchDeliveryLine.create({
      data: {
        id: createId(),
        erveDispatchId: erveDispatch.id,
        saleOrderLineId: saleOrderLine.id,
        receivedQuantity: options.receivedQuantity,
      },
    });
  }

  if (erveDispatch && options.salesReports && options.salesReports.length > 0) {
    for (const soldQty of options.salesReports) {
      await prisma.distributorSalesReport.create({
        data: {
          id: createId(),
          distributorId,
          reportDate: new Date('2026-07-10'),
          submittedById: actorId,
          lines: {
            create: {
              id: createId(),
              erveDispatchId: erveDispatch.id,
              saleOrderLineId: saleOrderLine.id,
              quantitySold: soldQty,
            },
          },
        },
      });
    }
  }

  if (erveDispatch && options.returns && options.returns.length > 0) {
    for (const ret of options.returns) {
      await prisma.distributorReturn.create({
        data: {
          id: createId(),
          returnNumber: `RET-${nextSeq()}-${createId()}`,
          distributorId,
          returnDate: new Date('2026-07-15'),
          status: ret.status,
          returnReason: 'Fixture Return',
          submittedById: actorId,
          approvedById: ret.status === 'APPROVED' || ret.status === 'RECEIVED' ? actorId : null,
          approvedAt: ret.status === 'APPROVED' || ret.status === 'RECEIVED' ? new Date() : null,
          financialYearId: financialYear.id,
          returnSerial: nextSeq(),
          lines: {
            create: {
              id: createId(),
              erveDispatchId: erveDispatch.id,
              saleOrderLineId: saleOrderLine.id,
              requestedQuantity: ret.requestedQuantity,
              approvedQuantity: ret.approvedQuantity ?? 0,
              receivedQuantity: ret.receivedQuantity ?? 0,
            },
          },
        },
      });
    }
  }

  return {
    distributorId,
    distributorCode,
    distributorName,
    style,
    size,
    saleOrder,
    saleOrderDistributor,
    destination,
    saleOrderLine,
    factoryDispatch,
    ervePackingList,
    erveDispatch,
  };
}

describe('PAG-P1-07: Sale-or-Return position query & aggregation correctness', () => {
  it('1. includes SALE_RETURN positions', async () => {
    const f = await createPositionFixture({ purchaseMode: 'SALE_RETURN', receivedQuantity: 100 });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.erveDispatchId).toBe(f.erveDispatch!.id);
    expect(res.items[0]!.saleOrderLineId).toBe(f.saleOrderLine.id);
    expect(res.items[0]!.dispatchedQuantity).toBe(100);
    expect(res.items[0]!.receivedQuantity).toBe(100);
    expect(res.items[0]!.remainingWithDistributor).toBe(100);

    // Also test service facade with ADMIN actor
    const adminRes = await listSaleOrReturnPositions(makeUser(['ADMIN']));
    expect(adminRes.items).toHaveLength(1);
    expect(adminRes.items[0]!.saleOrderLineId).toBe(f.saleOrderLine.id);
  });

  it('2. excludes OUTRIGHT positions', async () => {
    await createPositionFixture({ purchaseMode: 'OUTRIGHT', receivedQuantity: 100 });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(0);
  });

  it('3. filters by distributorId correctly', async () => {
    const shared = await createSharedTestContext();
    const f1 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 50 });
    const f2 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 60 });

    const res1 = await listSaleOrReturnPositionsPage({ distributorId: f1.distributorId, limit: 10 });
    expect(res1.items).toHaveLength(1);
    expect(res1.items[0]!.distributor.id).toBe(f1.distributorId);

    const res2 = await listSaleOrReturnPositionsPage({ distributorId: f2.distributorId, limit: 10 });
    expect(res2.items).toHaveLength(1);
    expect(res2.items[0]!.distributor.id).toBe(f2.distributorId);
  });

  it('4. DISTRIBUTOR actor is strictly scoped and cannot view another distributor', async () => {
    const shared = await createSharedTestContext();
    const f1 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 50 });
    const f2 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 60 });

    const distToken1 = await createDistributorToken(f1.distributorId);

    // Calling service with viewer distributorToken asking for f2.distributorId -> 403 Forbidden
    await request(app)
      .get(`/sale-or-return-positions?distributorId=${f2.distributorId}`)
      .set('Authorization', `Bearer ${distToken1}`)
      .expect(403);

    // Calling service without distributorId -> automatically scoped to f1
    const res = await request(app)
      .get('/sale-or-return-positions')
      .set('Authorization', `Bearer ${distToken1}`)
      .expect(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].distributor.id).toBe(f1.distributorId);
  });

  it('5. privileged roles (ADMIN, MERCHANDISER, SENIOR_MANAGEMENT) retain access to all positions', async () => {
    const shared = await createSharedTestContext();
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 50 });
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 60 });

    for (const role of ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const) {
      const { token } = await createRoleToken(role);
      const res = await request(app)
        .get('/sale-or-return-positions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.items).toHaveLength(2);
    }
  });

  it('6. onlyWithRemaining=true includes only positions with remaining > 0', async () => {
    const shared = await createSharedTestContext();
    // f1 has 100 received and 100 sold -> remaining = 0
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 100, salesReports: [100] });
    // f2 has 100 received and 40 sold -> remaining = 60
    const f2 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 100, salesReports: [40] });

    const res = await listSaleOrReturnPositionsPage({ onlyWithRemaining: true, limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.saleOrderLineId).toBe(f2.saleOrderLine.id);
    expect(res.items[0]!.remainingWithDistributor).toBe(60);
  });

  it('7. onlyWithRemaining=false includes positions even with remaining = 0', async () => {
    const shared = await createSharedTestContext();
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 100, salesReports: [100] });
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 100, salesReports: [40] });

    const res = await listSaleOrReturnPositionsPage({ onlyWithRemaining: false, limit: 10 });
    expect(res.items).toHaveLength(2);

    const { token: adminToken } = await createRoleToken('ADMIN');
    const routeRes = await request(app)
      .get('/sale-or-return-positions?onlyWithRemaining=false')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(routeRes.body.data.items).toHaveLength(2);
  });

  it('8. receivedQuantity reflects delivery confirmation shortage', async () => {
    await createPositionFixture({ cartonQuantities: [100], receivedQuantity: 75 });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.dispatchedQuantity).toBe(100);
    expect(res.items[0]!.receivedQuantity).toBe(75);
    expect(res.items[0]!.remainingWithDistributor).toBe(75);
  });

  it('9. multiple Actual Sales submissions aggregate correctly', async () => {
    await createPositionFixture({ cartonQuantities: [100], receivedQuantity: 100, salesReports: [20, 15, 10] });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.actualSoldQuantity).toBe(45);
    expect(res.items[0]!.remainingWithDistributor).toBe(55);
  });

  it('10. RECEIVED return reduces remainingWithDistributor', async () => {
    await createPositionFixture({
      receivedQuantity: 100,
      salesReports: [25],
      returns: [{ status: 'RECEIVED', requestedQuantity: 30, approvedQuantity: 30, receivedQuantity: 30 }],
    });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items[0]!.returnedQuantity).toBe(30);
    // remaining = received(100) - actualSold(25) - returned(30) = 45
    expect(res.items[0]!.remainingWithDistributor).toBe(45);
  });

  it('11. APPROVED return affects approvedAwaitingReceiptQuantity', async () => {
    await createPositionFixture({
      receivedQuantity: 100,
      salesReports: [20],
      returns: [{ status: 'APPROVED', requestedQuantity: 25, approvedQuantity: 25 }],
    });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items[0]!.approvedAwaitingReceiptQuantity).toBe(25);
    expect(res.items[0]!.remainingWithDistributor).toBe(80);
    // returnableQuantity (availableForNewReturn) = remaining(80) - approved(25) - pending(0) = 55
    expect(res.items[0]!.returnableQuantity).toBe(55);
  });

  it('12. SUBMITTED return affects pendingRequestedQuantity', async () => {
    await createPositionFixture({
      receivedQuantity: 100,
      returns: [{ status: 'SUBMITTED', requestedQuantity: 15 }],
    });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items[0]!.pendingRequestedQuantity).toBe(15);
    expect(res.items[0]!.returnableQuantity).toBe(85);
  });

  it('13. REJECTED return does not consume availability', async () => {
    await createPositionFixture({
      receivedQuantity: 100,
      returns: [{ status: 'REJECTED', requestedQuantity: 30 }],
    });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items[0]!.pendingRequestedQuantity).toBe(0);
    expect(res.items[0]!.approvedAwaitingReceiptQuantity).toBe(0);
    expect(res.items[0]!.returnedQuantity).toBe(0);
    expect(res.items[0]!.remainingWithDistributor).toBe(100);
    expect(res.items[0]!.returnableQuantity).toBe(100);
  });

  it('14. CANCELLED return does not consume availability', async () => {
    await createPositionFixture({
      receivedQuantity: 100,
      returns: [{ status: 'CANCELLED', requestedQuantity: 30, approvedQuantity: 30 }],
    });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items[0]!.pendingRequestedQuantity).toBe(0);
    expect(res.items[0]!.approvedAwaitingReceiptQuantity).toBe(0);
    expect(res.items[0]!.returnedQuantity).toBe(0);
    expect(res.items[0]!.remainingWithDistributor).toBe(100);
    expect(res.items[0]!.returnableQuantity).toBe(100);
  });

  it('15. multiple cartons for the same pair aggregate into one position row', async () => {
    // 2 cartons of 40 and 60 for the same saleOrderLineId
    await createPositionFixture({ cartonQuantities: [40, 60], receivedQuantity: 100 });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.dispatchedQuantity).toBe(100);
  });

  it('16. one dispatch with several lines produces distinct position rows', async () => {
    const shared = await createSharedTestContext();
    const f = await createPositionFixture({ sharedContext: shared, receivedQuantity: 50 });

    // Add a second saleOrderLine to the same dispatch & order
    const style2 = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `ST2-${nextSeq()}-${createId()}`,
        styleName: 'Style 2',
        finalMrp: 120,
        seasonId: shared.season.id,
      },
    });
    const sol2 = await prisma.saleOrderLine.create({
      data: {
        id: createId(),
        saleOrderId: f.saleOrder.id,
        destinationId: f.destination.id,
        styleId: style2.id,
        sizeId: shared.size.id,
        quantity: 50,
      },
    });
    const carton2 = await prisma.factoryPackingCarton.create({
      data: {
        id: createId(),
        factoryDispatchId: f.factoryDispatch.id,
        destinationId: f.destination.id,
        cartonNumber: `C2-${nextSeq()}-${createId()}`,
        ervePackingListId: f.ervePackingList!.id,
        createdById: shared.actorId,
      },
    });
    await prisma.factoryPackingCartonLine.create({
      data: { id: createId(), cartonId: carton2.id, saleOrderLineId: sol2.id, quantity: 50 },
    });
    await prisma.erveDispatchDeliveryLine.create({
      data: { id: createId(), erveDispatchId: f.erveDispatch!.id, saleOrderLineId: sol2.id, receivedQuantity: 50 },
    });

    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.saleOrderLineId).sort()).toEqual([f.saleOrderLine.id, sol2.id].sort());
  });

  it('17. same style/size in several dispatches remains separate positions', async () => {
    const shared = await createSharedTestContext();
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 40 });
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 60 });

    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(2);
    expect(res.items[0]!.erveDispatchId).not.toBe(res.items[1]!.erveDispatchId);
  });

  it('18. retired carton is excluded', async () => {
    await createPositionFixture({ cartonRetired: true, receivedQuantity: 100 });
    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(0);
  });

  it('19. packed but not dispatched cartons are excluded', async () => {
    // Case A: not yet attached to Erve Packing List
    await createPositionFixture({ onErvePackingList: false });
    // Case B: attached to Erve Packing List but no Erve Dispatch created yet
    await createPositionFixture({ onErvePackingList: true, hasErveDispatch: false });

    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    expect(res.items).toHaveLength(0);
  });

  it('20. cursor pagination traverses first, next, and final pages cleanly with correct pageInfo', async () => {
    const shared = await createSharedTestContext();
    for (let i = 0; i < 5; i++) {
      await createPositionFixture({ sharedContext: shared, receivedQuantity: 10 });
    }

    // Page 1 (limit 2)
    const page1 = await listSaleOrReturnPositionsPage({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.pageInfo.limit).toBe(2);
    expect(page1.pageInfo.hasMore).toBe(true);
    expect(page1.pageInfo.nextCursor).toBeTruthy();

    // Page 2 (limit 2)
    const page2 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page1.pageInfo.nextCursor! });
    expect(page2.items).toHaveLength(2);
    expect(page2.pageInfo.limit).toBe(2);
    expect(page2.pageInfo.hasMore).toBe(true);
    expect(page2.pageInfo.nextCursor).toBeTruthy();

    // Page 3 (limit 2)
    const page3 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page2.pageInfo.nextCursor! });
    expect(page3.items).toHaveLength(1);
    expect(page3.pageInfo.limit).toBe(2);
    expect(page3.pageInfo.hasMore).toBe(false);
    expect(page3.pageInfo.nextCursor).toBeNull();
  });

  it('21. cursor pagination produces no duplicates across pages', async () => {
    const shared = await createSharedTestContext();
    for (let i = 0; i < 5; i++) {
      await createPositionFixture({ sharedContext: shared, receivedQuantity: 10 });
    }

    const page1 = await listSaleOrReturnPositionsPage({ limit: 2 });
    const page2 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page1.pageInfo.nextCursor! });
    const page3 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page2.pageInfo.nextCursor! });

    const allItems = [...page1.items, ...page2.items, ...page3.items];
    const uniqueKeys = new Set(allItems.map((i) => `${i.erveDispatchId}:${i.saleOrderLineId}`));
    expect(uniqueKeys.size).toBe(5);
    expect(allItems).toHaveLength(5);
  });

  it('22. cursor pagination produces no missing positions across pages', async () => {
    const shared = await createSharedTestContext();
    const createdKeys = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const f = await createPositionFixture({ sharedContext: shared, receivedQuantity: 10 });
      createdKeys.add(`${f.erveDispatch!.id}:${f.saleOrderLine.id}`);
    }

    const page1 = await listSaleOrReturnPositionsPage({ limit: 2 });
    const page2 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page1.pageInfo.nextCursor! });
    const page3 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page2.pageInfo.nextCursor! });

    const retrievedKeys = new Set([...page1.items, ...page2.items, ...page3.items].map((i) => `${i.erveDispatchId}:${i.saleOrderLineId}`));
    expect(retrievedKeys).toEqual(createdKeys);
  });

  it('23. cursor pagination maintains strictly deterministic tuple ordering', async () => {
    const shared = await createSharedTestContext();
    for (let i = 0; i < 5; i++) {
      await createPositionFixture({ sharedContext: shared, receivedQuantity: 10 });
    }

    const page1 = await listSaleOrReturnPositionsPage({ limit: 2 });
    const page2 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page1.pageInfo.nextCursor! });
    const page3 = await listSaleOrReturnPositionsPage({ limit: 2, cursor: page2.pageInfo.nextCursor! });
    const allItems = [...page1.items, ...page2.items, ...page3.items];

    for (let i = 0; i < allItems.length - 1; i++) {
      const a = allItems[i]!;
      const b = allItems[i + 1]!;
      const cmp = a.erveDispatchId.localeCompare(b.erveDispatchId);
      if (cmp !== 0) {
        expect(cmp).toBeGreaterThan(0);
      } else {
        expect(a.saleOrderLineId.localeCompare(b.saleOrderLineId)).toBeGreaterThan(0);
      }
    }
  });

  it('23b. HTTP endpoint GET /sale-or-return-positions returns standard { items, pageInfo } contract', async () => {
    const shared = await createSharedTestContext();
    for (let i = 0; i < 3; i++) {
      await createPositionFixture({ sharedContext: shared, receivedQuantity: 10 });
    }

    const { token: adminToken } = await createRoleToken('ADMIN');
    const res1 = await request(app)
      .get('/sale-or-return-positions?limit=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res1.body.data.items).toHaveLength(2);
    expect(res1.body.data.pageInfo.limit).toBe(2);
    expect(res1.body.data.pageInfo.hasMore).toBe(true);
    expect(res1.body.data.pageInfo.nextCursor).toBeTruthy();

    const res2 = await request(app)
      .get(`/sale-or-return-positions?limit=2&cursor=${res1.body.data.pageInfo.nextCursor}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res2.body.data.items).toHaveLength(1);
    expect(res2.body.data.pageInfo.hasMore).toBe(false);
    expect(res2.body.data.pageInfo.nextCursor).toBeNull();
  });

  it('24. cursor encoding and malformed cursor rejection', async () => {
    const encoded = encodePositionCursor({ erveDispatchId: 'ed1', saleOrderLineId: 'sol1' });
    expect(decodePositionCursor(encoded)).toEqual({ erveDispatchId: 'ed1', saleOrderLineId: 'sol1' });

    expect(() => decodePositionCursor('not-valid-base64')).toThrow();
    expect(() => decodePositionCursor(Buffer.from('invalid-without-colon').toString('base64url'))).toThrow();

    await expect(listSaleOrReturnPositionsPage({ limit: 10, cursor: 'invalid_cursor' })).rejects.toThrow(
      'Invalid Sale-or-Return position cursor',
    );
  });

  it('25. SQL availability parity with computeAvailability', async () => {
    await createPositionFixture({
      receivedQuantity: 100,
      salesReports: [25, 10],
      returns: [
        { status: 'RECEIVED', requestedQuantity: 15, approvedQuantity: 15, receivedQuantity: 15 },
        { status: 'APPROVED', requestedQuantity: 20, approvedQuantity: 20 },
        { status: 'SUBMITTED', requestedQuantity: 10 },
      ],
    });

    const res = await listSaleOrReturnPositionsPage({ limit: 10 });
    const row = res.items[0]!;

    const canonical = computeAvailability({
      receivedQuantity: row.receivedQuantity,
      actualSoldQuantity: row.actualSoldQuantity,
      returnedQuantity: row.returnedQuantity,
      approvedAwaitingReceiptQuantity: row.approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity: row.pendingRequestedQuantity,
    });

    expect(row.remainingWithDistributor).toBe(canonical.remainingWithDistributor);
    expect(row.returnableQuantity).toBe(canonical.availableForNewReturn);
    expect(row.remainingWithDistributor).toBe(100 - 35 - 15); // 50
    expect(row.returnableQuantity).toBe(50 - 20 - 10); // 20
  });

  it('26. getSaleOrReturnRemainingTotal matches sum of position remaining', async () => {
    const shared = await createSharedTestContext();
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 100, salesReports: [20] }); // remaining = 80
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 60, salesReports: [10] }); // remaining = 50
    await createPositionFixture({ sharedContext: shared, receivedQuantity: 40, salesReports: [40] }); // remaining = 0

    const total = await getSaleOrReturnRemainingTotal({});
    expect(total).toBe(130);

    const positions = await listSaleOrReturnPositionsPage({ limit: 10 });
    const sumPositions = positions.items.reduce((acc, p) => acc + p.remainingWithDistributor, 0);
    expect(total).toBe(sumPositions);
  });

  it('27. getSaleOrReturnGroupedTotals groups by distributor accurately', async () => {
    const shared = await createSharedTestContext();
    const f1 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 100, salesReports: [30] });
    const f2 = await createPositionFixture({ sharedContext: shared, receivedQuantity: 50, salesReports: [10] });

    const grouped = await getSaleOrReturnGroupedTotals({ groupByStyle: false });
    expect(grouped).toHaveLength(2);

    const g1 = grouped.find((g) => g.distributor.id === f1.distributorId)!;
    expect(g1.receivedQuantity).toBe(100);
    expect(g1.actualSoldQuantity).toBe(30);

    const g2 = grouped.find((g) => g.distributor.id === f2.distributorId)!;
    expect(g2.receivedQuantity).toBe(50);
    expect(g2.actualSoldQuantity).toBe(10);
  });

  it('28. getSaleOrReturnGroupedTotals groups by distributor + style accurately', async () => {
    const shared = await createSharedTestContext();
    const d1 = await prisma.distributor.create({
      data: {
        id: createId(),
        code: `D1-${nextSeq()}-${createId()}`,
        name: 'Distributor 1',
        gstin: '27AAAAA0000A1Z5',
        purchaseMode: 'SALE_RETURN',
      },
    });

    const styleA = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `STY-A-${nextSeq()}`,
        styleName: 'Style A',
        finalMrp: 100,
        seasonId: shared.season.id,
      },
    });
    const styleB = await prisma.style.create({
      data: {
        id: createId(),
        styleNumber: `STY-B-${nextSeq()}`,
        styleName: 'Style B',
        finalMrp: 100,
        seasonId: shared.season.id,
      },
    });

    await createPositionFixture({
      sharedContext: shared,
      distributorId: d1.id,
      existingStyle: styleA,
      receivedQuantity: 60,
      salesReports: [10],
    });
    await createPositionFixture({
      sharedContext: shared,
      distributorId: d1.id,
      existingStyle: styleA,
      receivedQuantity: 40,
      salesReports: [20],
    });
    await createPositionFixture({
      sharedContext: shared,
      distributorId: d1.id,
      existingStyle: styleB,
      receivedQuantity: 70,
      salesReports: [15],
    });

    const grouped = await getSaleOrReturnGroupedTotals({ distributorId: d1.id, groupByStyle: true });
    expect(grouped).toHaveLength(2);

    const groupA = grouped.find((g) => g.style?.styleNumber === styleA.styleNumber)!;
    expect(groupA.receivedQuantity).toBe(100);
    expect(groupA.actualSoldQuantity).toBe(30);

    const groupB = grouped.find((g) => g.style?.styleNumber === styleB.styleNumber)!;
    expect(groupB.receivedQuantity).toBe(70);
    expect(groupB.actualSoldQuantity).toBe(15);
  });

  it('29. multi-distributor Dispatch Order lineage does not cross-join or multiply quantities', async () => {
    const shared = await createSharedTestContext();
    const distA = await prisma.distributor.create({
      data: { id: createId(), code: `DA-${nextSeq()}-${createId()}`, name: 'Dist A', gstin: '27AAAAA0000A1Z5', purchaseMode: 'SALE_RETURN' },
    });
    const distB = await prisma.distributor.create({
      data: { id: createId(), code: `DB-${nextSeq()}-${createId()}`, name: 'Dist B', gstin: '27AAAAA0000A1Z5', purchaseMode: 'SALE_RETURN' },
    });

    const style = await prisma.style.create({
      data: { id: createId(), styleNumber: `ST-${nextSeq()}-${createId()}`, styleName: 'Style Multi', finalMrp: 100, seasonId: shared.season.id },
    });

    // 1 SaleOrder with 2 distributors and destinations
    const so = await prisma.saleOrder.create({
      data: {
        id: createId(),
        saleOrderNumber: `SO-MULTI-${nextSeq()}-${createId()}`,
        factoryId: shared.factory.id,
        soDate: new Date(),
        createdBy: shared.actorId,
        financialYearId: shared.financialYear.id,
        soSerial: nextSeq(),
      },
    });

    const soDistA = await prisma.saleOrderDistributor.create({
      data: { id: createId(), saleOrderId: so.id, distributorId: distA.id, purchaseMode: 'SALE_RETURN' },
    });
    const destA = await prisma.saleOrderDestination.create({
      data: { id: createId(), saleOrderId: so.id, saleOrderDistributorId: soDistA.id, addressLine1: 'Addr A', city: 'City', state: 'State', country: 'India' },
    });
    const solA = await prisma.saleOrderLine.create({
      data: { id: createId(), saleOrderId: so.id, destinationId: destA.id, styleId: style.id, sizeId: shared.size.id, quantity: 50 },
    });

    const soDistB = await prisma.saleOrderDistributor.create({
      data: { id: createId(), saleOrderId: so.id, distributorId: distB.id, purchaseMode: 'SALE_RETURN' },
    });
    const destB = await prisma.saleOrderDestination.create({
      data: { id: createId(), saleOrderId: so.id, saleOrderDistributorId: soDistB.id, addressLine1: 'Addr B', city: 'City', state: 'State', country: 'India' },
    });
    const solB = await prisma.saleOrderLine.create({
      data: { id: createId(), saleOrderId: so.id, destinationId: destB.id, styleId: style.id, sizeId: shared.size.id, quantity: 80 },
    });

    const fd = await prisma.factoryDispatch.create({
      data: {
        id: createId(),
        factoryDispatchNumber: `FD-${nextSeq()}-${createId()}`,
        factoryId: shared.factory.id,
        saleOrderId: so.id,
        status: 'READY_FOR_ERVE',
        preparedById: shared.actorId,
        financialYearId: shared.financialYear.id,
        factoryDispatchSerial: nextSeq(),
      },
    });

    // Erve Dispatch A
    const eplA = await prisma.ervePackingList.create({
      data: { id: createId(), ervePackingListNumber: `EPLA-${nextSeq()}-${createId()}`, distributorId: distA.id, status: 'DISPATCHED', createdById: shared.actorId, financialYearId: shared.financialYear.id, ervePackingListSerial: nextSeq() },
    });
    const edA = await prisma.erveDispatch.create({
      data: { id: createId(), erveDispatchNumber: `EDA-${nextSeq()}-${createId()}`, ervePackingListId: eplA.id, distributorId: distA.id, status: 'DELIVERED', dispatchDate: new Date(), dispatchedById: shared.actorId, deliveredById: shared.actorId, financialYearId: shared.financialYear.id, erveDispatchSerial: nextSeq() },
    });
    const cartonA = await prisma.factoryPackingCarton.create({
      data: { id: createId(), factoryDispatchId: fd.id, destinationId: destA.id, cartonNumber: `CA-${nextSeq()}`, ervePackingListId: eplA.id, createdById: shared.actorId },
    });
    await prisma.factoryPackingCartonLine.create({
      data: { id: createId(), cartonId: cartonA.id, saleOrderLineId: solA.id, quantity: 50 },
    });
    await prisma.erveDispatchDeliveryLine.create({
      data: { id: createId(), erveDispatchId: edA.id, saleOrderLineId: solA.id, receivedQuantity: 50 },
    });

    // Erve Dispatch B
    const eplB = await prisma.ervePackingList.create({
      data: { id: createId(), ervePackingListNumber: `EPLB-${nextSeq()}-${createId()}`, distributorId: distB.id, status: 'DISPATCHED', createdById: shared.actorId, financialYearId: shared.financialYear.id, ervePackingListSerial: nextSeq() },
    });
    const edB = await prisma.erveDispatch.create({
      data: { id: createId(), erveDispatchNumber: `EDB-${nextSeq()}-${createId()}`, ervePackingListId: eplB.id, distributorId: distB.id, status: 'DELIVERED', dispatchDate: new Date(), dispatchedById: shared.actorId, deliveredById: shared.actorId, financialYearId: shared.financialYear.id, erveDispatchSerial: nextSeq() },
    });
    const cartonB = await prisma.factoryPackingCarton.create({
      data: { id: createId(), factoryDispatchId: fd.id, destinationId: destB.id, cartonNumber: `CB-${nextSeq()}`, ervePackingListId: eplB.id, createdById: shared.actorId },
    });
    await prisma.factoryPackingCartonLine.create({
      data: { id: createId(), cartonId: cartonB.id, saleOrderLineId: solB.id, quantity: 80 },
    });
    await prisma.erveDispatchDeliveryLine.create({
      data: { id: createId(), erveDispatchId: edB.id, saleOrderLineId: solB.id, receivedQuantity: 80 },
    });

    // Query dist A
    const resA = await listSaleOrReturnPositionsPage({ distributorId: distA.id, limit: 10 });
    expect(resA.items).toHaveLength(1);
    expect(resA.items[0]!.dispatchedQuantity).toBe(50);
    expect(resA.items[0]!.receivedQuantity).toBe(50);

    // Query dist B
    const resB = await listSaleOrReturnPositionsPage({ distributorId: distB.id, limit: 10 });
    expect(resB.items).toHaveLength(1);
    expect(resB.items[0]!.dispatchedQuantity).toBe(80);
    expect(resB.items[0]!.receivedQuantity).toBe(80);
  });

  describe('30. Structural Scalability Test (Section 19)', () => {
    it('demonstrates structural boundedness: bounded page size returned, no full history in Node, constant DB aggregation for totals', async () => {
      const shared = await createSharedTestContext();
      const TOTAL_HISTORICAL_POSITIONS = 8;
      const REQUEST_LIMIT = 2;

      for (let i = 0; i < TOTAL_HISTORICAL_POSITIONS; i++) {
        await createPositionFixture({
          sharedContext: shared,
          receivedQuantity: 100,
          salesReports: [10],
        });
      }

      // 1. Candidate count substantially exceeds requested limit
      // Endpoint returns strictly REQUEST_LIMIT rows
      const firstPage = await listSaleOrReturnPositionsPage({ limit: REQUEST_LIMIT });
      expect(firstPage.items).toHaveLength(REQUEST_LIMIT);
      expect(firstPage.items.length).toBeLessThan(TOTAL_HISTORICAL_POSITIONS);
      expect(firstPage.pageInfo.hasMore).toBe(true);
      expect(firstPage.pageInfo.nextCursor).toBeTruthy();

      // 2. Traversal through keyset cursor yields next bounded chunk
      const secondPage = await listSaleOrReturnPositionsPage({
        limit: REQUEST_LIMIT,
        cursor: firstPage.pageInfo.nextCursor!,
      });
      expect(secondPage.items).toHaveLength(REQUEST_LIMIT);
      expect(secondPage.items[0]!.erveDispatchId).not.toBe(firstPage.items[0]!.erveDispatchId);

      // 3. Management total computes directly in Postgres across all 8 positions
      // without materializing a position array into Node
      const remainingTotal = await getSaleOrReturnRemainingTotal({});
      expect(remainingTotal).toBe(TOTAL_HISTORICAL_POSITIONS * 90);

      // 4. Grouped totals aggregate in Postgres without materializing individual position records
      const grouped = await getSaleOrReturnGroupedTotals({ groupByStyle: false });
      expect(grouped).toHaveLength(TOTAL_HISTORICAL_POSITIONS);
      for (const row of grouped) {
        expect(row.receivedQuantity).toBe(100);
        expect(row.actualSoldQuantity).toBe(10);
      }
    });
  });
});
