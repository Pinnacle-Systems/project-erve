import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { createId } from '@erve/shared';
import { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import { createApp } from '../../app.js';
import { currentUserSelect, toCurrentUser } from '../../auth/current-user.js';
import { getReconciliation } from './post-dispatch-reconciliation.service.js';
import * as helpers from './fulfillment-test-helpers.js';

// Measure real SQL emitted by the public service, including relation loads and
// transaction statements, rather than mocking ORM calls or timing execution.
const measured = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  log: [{ emit: 'event', level: 'query' }],
});
const queries: Prisma.QueryEvent[] = [];
measured.$on('query', (event) => queries.push(event));

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await measured.$disconnect();
  await prisma.$disconnect();
});

it('keeps detail SQL count constant from 1 to 100 Style × Size source lines with correctly attributed downstream totals', async () => {
  await resetDatabase();
  const app = createApp();
  const f = await helpers.createSingleFactoryApprovedSaleOrder(app, 100, 'SALE_RETURN');
  const factory = await helpers.createFactoryUserToken(f.stock.factoryId);
  const packed = await helpers.packAndFinalize(
    app,
    factory,
    f.saleOrder.id,
    f.saleOrderLineId,
    f.saleOrder.destinations[0].id,
    100,
  );
  const dispatch = await helpers.consolidateAndDispatch(app, f.merchToken, [packed.cartonId]);
  const record = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  const actor = toCurrentUser(
    await prisma.user.findUniqueOrThrow({
      where: { id: record.dispatchedById },
      select: currentUserSelect,
    }),
  );
  const baseLine = await prisma.saleOrderLine.findUniqueOrThrow({
    where: { id: f.saleOrderLineId },
  });
  await prisma.saleOrderLine.update({ where: { id: baseLine.id }, data: { quantity: 200 } });
  const baseStyle = await prisma.style.findUniqueOrThrow({ where: { id: baseLine.styleId } });
  const baseSize = await prisma.size.findUniqueOrThrow({ where: { id: baseLine.sizeId } });
  const styles = [baseStyle.id, ...Array.from({ length: 19 }, () => createId())];
  const sizes = [baseSize.id, ...Array.from({ length: 4 }, () => createId())];
  await prisma.style.createMany({
    data: styles.slice(1).map((id, i) => ({ ...baseStyle, id, styleNumber: `A5-PERF-${i}` })),
  });
  await prisma.size.createMany({
    data: sizes
      .slice(1)
      .map((id, i) => ({
        ...baseSize,
        id,
        code: `A5-PERF-${i}`,
        label: `Size ${i}`,
        sortOrder: i + 10,
      })),
  });
  const ids = [baseLine.id, ...Array.from({ length: 99 }, () => createId())];
  const reports = [createId(), createId()];
  await prisma.distributorSalesReport.createMany({
    data: reports.map((id) => ({
      id,
      distributorId: record.distributorId,
      reportDate: new Date('2026-08-01'),
      submittedById: actor.id,
    })),
  });
  const statuses = [
    'RECEIVED',
    'RECEIVED',
    'APPROVED',
    'APPROVED',
    'SUBMITTED',
    'SUBMITTED',
    'REJECTED',
    'CANCELLED',
  ] as const;
  const returns = statuses.map(() => createId());
  await prisma.distributorReturn.createMany({
    data: statuses.map((status, i) => ({
      id: returns[i]!,
      returnNumber: `A5-PERF-${i}`,
      distributorId: record.distributorId,
      returnDate: new Date('2026-08-02'),
      status,
      returnReason: 'Performance fixture',
      submittedById: actor.id,
      financialYearId: record.financialYearId,
      returnSerial: i + 1,
    })),
  });

  // A second Dispatch using the same source line must never contribute to this
  // Dispatch's totals. Seed actual history under its own valid Packing List.
  const packingList = await prisma.ervePackingList.findUniqueOrThrow({
    where: { id: record.ervePackingListId },
  });
  const otherList = await prisma.ervePackingList.create({
    data: {
      ...packingList,
      id: createId(),
      ervePackingListNumber: 'A5-PERF-OTHER',
      ervePackingListSerial: packingList.ervePackingListSerial + 1000,
    },
  });
  const other = await prisma.erveDispatch.create({
    data: {
      ...record,
      id: createId(),
      erveDispatchNumber: 'A5-PERF-OTHER',
      ervePackingListId: otherList.id,
      erveDispatchSerial: record.erveDispatchSerial + 1000,
    },
  });
  const carton = await prisma.factoryPackingCarton.findUniqueOrThrow({
    where: { id: packed.cartonId },
  });
  const otherCarton = await prisma.factoryPackingCarton.create({
    data: { ...carton, id: createId(), cartonNumber: 'C2', ervePackingListId: otherList.id },
  });
  await prisma.factoryPackingCartonLine.create({
    data: { id: createId(), cartonId: otherCarton.id, saleOrderLineId: baseLine.id, quantity: 100 },
  });
  await prisma.distributorSalesReportLine.create({
    data: {
      id: createId(),
      distributorSalesReportId: reports[0]!,
      erveDispatchId: other.id,
      saleOrderLineId: baseLine.id,
      quantitySold: 999,
    },
  });
  await prisma.distributorReturnLine.create({
    data: {
      id: createId(),
      distributorReturnId: returns[0]!,
      erveDispatchId: other.id,
      saleOrderLineId: baseLine.id,
      requestedQuantity: 999,
      approvedQuantity: 999,
      receivedQuantity: 999,
    },
  });

  const samples: Array<{ lines: number; queries: number }> = [];
  vi.spyOn(prisma, '$transaction').mockImplementation(measured.$transaction.bind(measured));
  let seeded = 0;
  for (const count of [1, 25, 100]) {
    const indices = Array.from({ length: count - seeded }, (_, i) => seeded + i);
    await prisma.saleOrderLine.createMany({
      data: indices
        .filter((i) => i > 0)
        .map((i) => ({
          ...baseLine,
          id: ids[i]!,
          styleId: styles[Math.floor(i / 5)]!,
          sizeId: sizes[i % 5]!,
        })),
    });
    await prisma.factoryPackingCartonLine.createMany({
      data: indices
        .filter((i) => i > 0)
        .map((i) => ({
          id: createId(),
          cartonId: packed.cartonId,
          saleOrderLineId: ids[i]!,
          quantity: 100,
        })),
    });
    await prisma.erveDispatchDeliveryLine.createMany({
      data: indices
        .filter((i) => i % 5 !== 4)
        .map((i) => ({
          id: createId(),
          erveDispatchId: dispatch.id,
          saleOrderLineId: ids[i]!,
          receivedQuantity: 80,
        })),
    });
    await prisma.distributorSalesReportLine.createMany({
      data: indices
        .filter((i) => i % 5 < 2)
        .flatMap((i) =>
          reports.map((report, n) => ({
            id: createId(),
            distributorSalesReportId: report,
            erveDispatchId: dispatch.id,
            saleOrderLineId: ids[i]!,
            quantitySold: (i % 7) + n + 1,
          })),
        ),
    });
    await prisma.distributorReturnLine.createMany({
      data: indices
        .filter((i) => i % 5 === 0 || i % 5 === 2)
        .flatMap((i) =>
          statuses.map((status, n) => ({
            id: createId(),
            distributorReturnId: returns[n]!,
            erveDispatchId: dispatch.id,
            saleOrderLineId: ids[i]!,
            requestedQuantity: status === 'SUBMITTED' ? (i % 3) + n + 1 : 100,
            approvedQuantity:
              status === 'APPROVED' ? (i % 3) + n + 1 : status === 'RECEIVED' ? 50 : null,
            receivedQuantity: status === 'RECEIVED' ? (i % 3) + n + 1 : null,
          })),
        ),
    });

    queries.length = 0;
    const result = await getReconciliation(actor, dispatch.id);
    samples.push({ lines: count, queries: queries.length });
    expect(result.lines).toHaveLength(count);
    expect(result.summary.dispatchedQuantity).toBe(count * 100);
    for (const line of result.lines) {
      const i = ids.indexOf(line.saleOrderLineId);
      const hasReturns = i % 5 === 0 || i % 5 === 2;
      const sold = i % 5 < 2 ? 2 * (i % 7) + 3 : 0;
      const returned = hasReturns ? 2 * (i % 3) + 3 : 0;
      const approved = hasReturns ? 2 * (i % 3) + 7 : 0;
      const pending = hasReturns ? 2 * (i % 3) + 11 : 0;
      const received = i % 5 === 4 ? 0 : 80;
      expect(line).toMatchObject({
        dispatchedQuantity: 100,
        receivedQuantity: null,
        ledgerQuantity: i % 5 === 4 ? null : 80,
        actualSoldQuantity: sold,
        returnedQuantity: returned,
        approvedAwaitingReceiptQuantity: approved,
        pendingRequestedQuantity: pending,
        availableForActualSale: received - sold - returned - approved,
        availableForNewReturn: received - sold - returned - approved - pending,
      });
    }
    seeded = count;
  }
  console.info('A5 detail SQL counts:', samples);
  expect(samples[1]!.queries).toBe(samples[0]!.queries);
  expect(samples[2]!.queries).toBe(samples[0]!.queries);
}, 60000);
