import request from 'supertest';
import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import type { Express } from 'express';
import { prisma } from '../../db/prisma.js';
import { createReleasedQaStock, createTestUserAndToken, type ReleasedQaStock } from '../../test/helpers.js';

export async function createRoleToken(role: Role) {
  const { userId, token } = await createTestUserAndToken({
    email: `${role.toLowerCase()}-${createId()}@test.local`,
    password: 'pass',
    roles: [role],
  });
  return { userId, token };
}

export async function createDistributorToken(distributorId: string) {
  const { userId, token } = await createTestUserAndToken({
    email: `dist-${createId()}@test.local`,
    password: 'pass',
    roles: ['DISTRIBUTOR'],
  });
  await prisma.userDistributor.create({ data: { id: createId(), userId, distributorId } });
  return token;
}

/**
 * Confirms full receipt (no shortage) for an Erve Dispatch — the Phase A
 * delivery-confirmation step DistributorSalesReport/DistributorReturn now
 * require before their ceiling checks admit any quantity. Defaults
 * `receivedQuantity` to `packedQuantity` for every line unless overridden.
 */
export async function confirmErveDispatchDelivery(
  app: Express,
  token: string,
  dispatchId: string,
  expectedVersion: number,
  lines: Array<{ saleOrderLineId: string; receivedQuantity: number }>,
  remarks?: string,
) {
  return request(app)
    .patch(`/erve-dispatches/${dispatchId}/delivery`)
    .set('Authorization', `Bearer ${token}`)
    .send({ expectedVersion, lines, remarks })
    .expect(200);
}

/**
 * `extraRoles` supports the UXAUTH-004 mixed-role read-scope matrix (e.g. a
 * FACTORY_USER account that is ALSO MERCHANDISER/ADMIN/SENIOR_MANAGEMENT, or
 * also a non-broad role like DISTRIBUTOR/QA_USER) without touching any
 * existing single-role caller of this helper.
 */
export async function createFactoryUserToken(factoryId: string, extraRoles: Role[] = []) {
  const { userId, token } = await createTestUserAndToken({
    email: `factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER', ...extraRoles],
  });
  await prisma.userFactory.create({ data: { id: createId(), userId, factoryId } });
  return token;
}

/**
 * Dispatch Order Phase 3: creation itself is the sole allocation point —
 * builds a Dispatch Order for `quantity`, sourced entirely from ONE
 * Factory's pooled released stock, as a MERCHANDISER (no distributor
 * submit/review/approve workflow exists any more). `purchaseMode` controls
 * the Distributor's own purchaseMode (Purchase Mode is Distributor-owned —
 * see invoice-handoff.service.ts for why this, not physical StockAllocation
 * source, drives invoice eligibility).
 */
export async function createSingleFactoryApprovedSaleOrder(
  app: Express,
  quantity = 40,
  purchaseMode: 'OUTRIGHT' | 'SALE_RETURN' = 'OUTRIGHT',
) {
  const stock = await createReleasedQaStock({ quantity, purchaseMode });
  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributors: [
        {
          clientKey: 'dg1',
          distributorId: stock.distributorId,
          destinations: [
            { clientKey: 'd1', addressLine1: 'Test Address', city: 'Chennai', state: 'TN', country: 'India' },
          ],
        },
      ],
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity }],
    })
    .expect(201);

  const saleOrder = created.body.data;
  // Correction 8: the API response nests destinations under
  // distributorGroups. A flat `destinations` array is added here purely as
  // a test-fixture convenience shim, so the large existing surface of
  // fulfillment tests built against the old flat shape (saleOrder.destinations[0].id)
  // keeps working without each needing to be individually rewritten.
  saleOrder.destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
  const line = saleOrder.lines[0];
  const allocation = await prisma.stockAllocation.findFirstOrThrow({
    where: { saleOrderLineId: line.id, status: 'ACTIVE' },
  });
  const distributorToken = await createDistributorToken(stock.distributorId);

  return {
    stock,
    distributorToken,
    merchToken,
    saleOrder,
    saleOrderLineId: line.id as string,
    stockAllocationId: allocation.id,
  };
}

/**
 * Provisions (upsert — safe for a style/factory pair used across several
 * fixtures) an ACTIVE StyleFactoryMapping so a Factory Invoice can be
 * generated when the Factory Dispatch finalizes (see
 * factory-invoice.service.ts's generateFactoryInvoiceForFinalizedDispatch —
 * finalization fails atomically without an active rate). Deliberately not
 * folded into createReleasedQaStock, which stays a pure QA-stock fixture —
 * this is called explicitly by packAndFinalize instead. A test exercising
 * the missing-rate path skips packAndFinalize and drives the underlying
 * carton/audit/finalize calls directly without this.
 */
export async function ensureStyleFactoryRate(styleId: string, factoryId: string, exFactoryPrice = 150) {
  return prisma.styleFactoryMapping.upsert({
    where: { styleId_factoryId: { styleId, factoryId } },
    create: { id: createId(), styleId, factoryId, exFactoryPrice, status: 'ACTIVE' },
    update: { exFactoryPrice, status: 'ACTIVE' },
  });
}

/**
 * Carton-first packing (Phase 4): creates one carton covering `quantity`,
 * confirms its Packing Audit as a fresh QA_USER, then finalizes. Shared by
 * every fixture that just needs "a finalized Factory Dispatch exists" as a
 * precondition (Erve consolidation/dispatch/invoice/returns/sales-report
 * tests) without re-deriving the carton-first flow in each file. Provisions
 * an active Style<->Factory rate first (see ensureStyleFactoryRate above) so
 * finalize's automatic Factory Invoice generation always succeeds here.
 */
export async function packAndFinalize(
  app: Express,
  factoryToken: string,
  saleOrderId: string,
  saleOrderLineId: string,
  destinationId: string,
  quantity: number,
  rate = 150,
) {
  const created = await request(app)
    .post(`/sale-orders/${saleOrderId}/packing-list/cartons`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ cartonNumber: 'C1', destinationId, lines: [{ saleOrderLineId, quantity }] })
    .expect(200);
  const factoryDispatchId = created.body.data.factoryDispatch.id as string;
  const cartonId = created.body.data.destinations[0].cartons[0].id as string;
  const factoryId = created.body.data.factory.id as string;
  const packedLine = created.body.data.destinations
    .flatMap((d: { lines: Array<{ saleOrderLineId: string; styleId: string }> }) => d.lines)
    .find((l: { saleOrderLineId: string }) => l.saleOrderLineId === saleOrderLineId) as { styleId: string };
  await ensureStyleFactoryRate(packedLine.styleId, factoryId, rate);

  const { token: qaToken } = await createRoleToken('QA_USER');
  await request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}/audit`)
    .set('Authorization', `Bearer ${qaToken}`)
    .send({})
    .expect(200);

  const finalized = await request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({ expectedVersion: created.body.data.factoryDispatch.version })
    .expect(200);
  return {
    ...(finalized.body.data.factoryDispatch as { id: string; factoryDispatchNumber: string; status: string; version: number }),
    cartonId,
  };
}

/**
 * Phase 6: consolidates one or more already-finalized (READY_FOR_ERVE),
 * audited cartons — see packAndFinalize — into a new Erve Packing List,
 * finalizes it, and records the physical Erve Dispatch, as a MERCHANDISER.
 * Shared by every fixture downstream of "an Erve Dispatch exists"
 * (delivery/Actual-Sales/Returns/sales-report/invoice-handoff tests) so they
 * don't each re-derive the carton-consolidation flow.
 */
export async function consolidateAndDispatch(app: Express, merchToken: string, cartonIds: string[], dispatchDate = '2026-07-01') {
  const created = await request(app)
    .post('/erve-packing-lists')
    .set('Authorization', `Bearer ${merchToken}`)
    .send({ cartonIds })
    .expect(201);
  const ervePackingListId = created.body.data.id as string;

  await request(app)
    .post(`/erve-packing-lists/${ervePackingListId}/finalize`)
    .set('Authorization', `Bearer ${merchToken}`)
    .send({})
    .expect(200);

  const dispatched = await request(app)
    .post('/erve-dispatches')
    .set('Authorization', `Bearer ${merchToken}`)
    .send({ ervePackingListId, dispatchDate })
    .expect(201);

  return dispatched.body.data as {
    id: string;
    erveDispatchNumber: string;
    version: number;
    status: string;
    ervePackingList: { id: string; ervePackingListNumber: string };
  };
}

export interface ApprovedSaleOrderOptions {
  distributorId?: string;
  factoryId?: string;
  quantity?: number;
  purchaseMode?: 'OUTRIGHT' | 'SALE_RETURN';
  destination?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
}

/**
 * Generalized version of createSingleFactoryApprovedSaleOrder (Phase 6) that
 * accepts an explicit distributorId/factoryId/destination so tests can build
 * TWO Dispatch Orders that deliberately share (or deliberately differ on)
 * Distributor/Factory/destination — needed to exercise cross-Dispatch-Order,
 * cross-factory, same-destination and cross-distributor Erve consolidation
 * scenarios (Phase 6 plan §6/§15).
 */
export async function createApprovedSaleOrder(app: Express, options: ApprovedSaleOrderOptions = {}) {
  const quantity = options.quantity ?? 20;
  const stock = await createReleasedQaStock({
    distributorId: options.distributorId,
    factoryId: options.factoryId,
    quantity,
    purchaseMode: options.purchaseMode,
  });
  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const destination = {
    addressLine1: 'Test Address',
    city: 'Chennai',
    state: 'TN',
    country: 'India',
    ...options.destination,
  };
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributors: [{ clientKey: 'dg1', distributorId: stock.distributorId, destinations: [{ clientKey: 'd1', ...destination }] }],
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      lines: [{ destinationClientKey: 'd1', styleId: stock.styleId, sizeId: stock.sizeId, quantity }],
    })
    .expect(201);

  const saleOrder = created.body.data;
  // See the identical shim/comment in createSingleFactoryApprovedSaleOrder above.
  saleOrder.destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
  const line = saleOrder.lines[0];
  const allocation = await prisma.stockAllocation.findFirstOrThrow({
    where: { saleOrderLineId: line.id, status: 'ACTIVE' },
  });
  const distributorToken = await createDistributorToken(stock.distributorId);

  return {
    stock,
    distributorToken,
    merchToken,
    saleOrder,
    saleOrderLineId: line.id as string,
    stockAllocationId: allocation.id,
  };
}

export interface FixtureSaleOrder {
  id: string;
  version: number;
  status: string;
  lines: Array<{ id: string; quantity: number }>;
  destinations: Array<{ id: string }>;
}

export interface TwoBatchSaleOrder {
  saleOrder: FixtureSaleOrder;
  saleOrderLineId: string;
  distributorToken: string;
  merchToken: string;
  factoryId: string;
  batchA: { stock: ReleasedQaStock; stockAllocationId: string; quantity: number };
  batchB: { stock: ReleasedQaStock; stockAllocationId: string; quantity: number };
}

/**
 * One Dispatch Order line whose full quantity is sourced from TWO different
 * Job Orders' QA-released stock at the SAME Factory (a Dispatch Order is
 * always single-factory by construction — see the Phase 3 plan; the old
 * cross-FACTORY sourcing-within-one-order scenario this fixture used to
 * exercise no longer exists). Exercises the deterministic oldest-release-
 * first allocation planner spanning multiple QaReleaseLines.
 */
export async function createTwoBatchApprovedSaleOrder(
  app: Express,
  quantityA: number,
  quantityB: number,
): Promise<TwoBatchSaleOrder> {
  const stockA = await createReleasedQaStock({ quantity: quantityA, releasedAt: new Date('2026-01-01') });
  const stockB = await createReleasedQaStock({
    distributorId: stockA.distributorId,
    styleId: stockA.styleId,
    sizeId: stockA.sizeId,
    factoryId: stockA.factoryId,
    quantity: quantityB,
    releasedAt: new Date('2026-02-01'),
  });

  const { token: merchToken } = await createRoleToken('MERCHANDISER');
  const totalQuantity = quantityA + quantityB;
  const created = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${merchToken}`)
    .set('Idempotency-Key', createId())
    .send({
      distributors: [
        {
          clientKey: 'dg1',
          distributorId: stockA.distributorId,
          destinations: [
            { clientKey: 'd1', addressLine1: 'Test Address', city: 'Chennai', state: 'TN', country: 'India' },
          ],
        },
      ],
      factoryId: stockA.factoryId,
      soDate: '2026-06-30',
      lines: [{ destinationClientKey: 'd1', styleId: stockA.styleId, sizeId: stockA.sizeId, quantity: totalQuantity }],
    })
    .expect(201);

  const saleOrder = created.body.data;
  // See the identical shim/comment in createSingleFactoryApprovedSaleOrder above.
  saleOrder.destinations = saleOrder.distributorGroups.flatMap((g: { destinations: unknown[] }) => g.destinations);
  const line = saleOrder.lines[0];
  const allocations = await prisma.stockAllocation.findMany({
    where: { saleOrderLineId: line.id, status: 'ACTIVE' },
  });
  const allocationA = allocations.find((a) => a.qaReleaseLineId === stockA.qaReleaseLineId)!;
  const allocationB = allocations.find((a) => a.qaReleaseLineId === stockB.qaReleaseLineId)!;
  const distributorToken = await createDistributorToken(stockA.distributorId);

  return {
    saleOrder,
    saleOrderLineId: line.id as string,
    distributorToken,
    merchToken,
    factoryId: stockA.factoryId,
    batchA: { stock: stockA, stockAllocationId: allocationA.id, quantity: quantityA },
    batchB: { stock: stockB, stockAllocationId: allocationB.id, quantity: quantityB },
  };
}
