import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createReleasedQaStock,
  createTestRetailStore,
  createTestSeason,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { getReferencePooledFactoryInventory } from '../../test/pooled-inventory-reference.js';
import { countFalseHistoryForJobOrders } from '../historical-import/historical-job-order-commit.service.js';
import { getPooledFactoryInventory } from './pooled-inventory.service.js';

const app = createApp();
beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

type Filters = NonNullable<Parameters<typeof getPooledFactoryInventory>[1]>;
function normalized(rows: Awaited<ReturnType<typeof getPooledFactoryInventory>>) {
  return [...rows].sort((a, b) =>
    `${a.factoryId}:${a.styleId}:${a.sizeId}`.localeCompare(
      `${b.factoryId}:${b.styleId}:${b.sizeId}`,
    ),
  );
}

async function allocate(
  stock: Awaited<ReturnType<typeof createReleasedQaStock>>,
  quantity: number,
) {
  const { token } = await createTestUserAndToken({
    email: `${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });
  const retailStore = await createTestRetailStore(stock.distributorId);
  const result = await request(app)
    .post('/sale-orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', createId())
    .send({
      factoryId: stock.factoryId,
      soDate: '2026-06-30',
      distributors: [
        {
          clientKey: 'g',
          distributorId: stock.distributorId,
          destinations: [
            {
              clientKey: 'd',
              retailStoreId: retailStore.id,
              addressLine1: 'Test Street',
              city: 'Chennai',
              state: 'TN',
              country: 'India',
            },
          ],
        },
      ],
      lines: [{ destinationClientKey: 'd', styleId: stock.styleId, totalQuantity: quantity }],
    })
    .expect(201);
  return { order: result.body.data, token };
}

describe('PAG-P1-08 old/new pooled inventory parity', () => {
  it('matches the original implementation for every filter, metadata, mixed allocations and own-order add-back', async () => {
    const a = await createReleasedQaStock({ quantity: 100 });
    const secondRelease = await createReleasedQaStock({
      factoryId: a.factoryId,
      styleId: a.styleId,
      sizeId: a.sizeId,
      quantity: 30,
    });
    const own = await allocate(a, 20);
    await allocate(a, 10);
    const freed = await allocate(a, 5);
    await prisma.stockAllocation.updateMany({
      where: { saleOrderLine: { saleOrderId: freed.order.id } },
      data: { status: 'RELEASED' },
    });
    const historical = await createReleasedQaStock({
      styleId: a.styleId,
      sizeId: a.sizeId,
      quantity: 40,
    });
    await prisma.jobOrder.update({
      where: { id: historical.jobOrderId },
      data: { recordOrigin: 'HISTORICAL_IMPORT' },
    });
    await createReleasedQaStock({ factoryId: a.factoryId, styleId: a.styleId, quantity: 15 });
    const otherStyle = await createReleasedQaStock({ factoryId: a.factoryId, quantity: 7 });
    const style = await prisma.style.findUniqueOrThrow({ where: { id: a.styleId } });
    const otherSeason = await createTestSeason();
    await prisma.style.update({
      where: { id: otherStyle.styleId },
      data: { seasonId: otherSeason.id },
    });
    const fileId = createId();
    await prisma.file.create({
      data: {
        id: fileId,
        fileName: 'primary.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey: 'batch10/primary.png',
      },
    });
    const imageId = createId();
    await prisma.styleImage.create({
      data: { id: imageId, styleId: a.styleId, fileId, isPrimary: true, sortOrder: 5 },
    });
    await prisma.styleImage.create({
      data: { id: createId(), styleId: a.styleId, fileId, sortOrder: 0 },
    });

    const cases: Filters[] = [
      {},
      { factoryId: a.factoryId },
      { styleId: a.styleId },
      { sizeId: a.sizeId },
      { seasonId: style.seasonId },
      { seasonId: otherSeason.id },
      { recordOrigin: 'LIVE_WORKFLOW' },
      { recordOrigin: 'HISTORICAL_IMPORT' },
      {
        factoryId: a.factoryId,
        styleId: a.styleId,
        sizeId: a.sizeId,
        seasonId: style.seasonId,
        recordOrigin: 'LIVE_WORKFLOW',
      },
      { factoryId: a.factoryId, excludeSaleOrderId: own.order.id },
      { factoryId: historical.factoryId, excludeSaleOrderId: own.order.id },
      { styleId: "' OR TRUE --" },
      { factoryId: createId() },
    ];
    for (const filters of cases) {
      expect(
        normalized(await getPooledFactoryInventory(prisma, filters)),
        JSON.stringify(filters),
      ).toEqual(normalized(await getReferencePooledFactoryInventory(prisma, filters)));
    }
    const rows = await getPooledFactoryInventory(prisma, {
      factoryId: a.factoryId,
      sizeId: a.sizeId,
    });
    expect(rows[0]).toMatchObject({
      releasedQuantity: 130,
      committedQuantity: 30,
      availableQuantity: 100,
      styleNumber: style.styleNumber,
      styleName: style.styleName,
      primaryImage: { id: imageId, fileName: 'primary.png' },
    });
    const edit = await getPooledFactoryInventory(prisma, {
      factoryId: a.factoryId,
      sizeId: a.sizeId,
      excludeSaleOrderId: own.order.id,
    });
    expect(edit[0]).toMatchObject({
      releasedQuantity: 130,
      committedQuantity: 30,
      availableQuantity: 120,
    });
    expect(secondRelease.factoryId).toBe(a.factoryId);
    const counts = await countFalseHistoryForJobOrders(
      prisma,
      [a.jobOrderId, secondRelease.jobOrderId],
      [{ factoryId: a.factoryId, styleId: a.styleId }],
    );
    expect(counts).toMatchObject({ pooledInventoryLines: 2, pooledInventoryQuantity: 115 });
  });

  it('retains exhausted, inactive historical Sizes in the equal-split divisor and preserves negative availability', async () => {
    const a = await createReleasedQaStock({ quantity: 20 });
    const own = await allocate(a, 20);
    await prisma.size.update({ where: { id: a.sizeId }, data: { status: 'INACTIVE' } });
    const b = await createReleasedQaStock({
      factoryId: a.factoryId,
      styleId: a.styleId,
      quantity: 20,
    });
    const filters = { factoryId: a.factoryId, styleId: a.styleId };
    expect(normalized(await getPooledFactoryInventory(prisma, filters))).toEqual(
      normalized(await getReferencePooledFactoryInventory(prisma, filters)),
    );
    expect(
      (await getPooledFactoryInventory(prisma, filters)).find((r) => r.sizeId === a.sizeId),
    ).toMatchObject({ releasedQuantity: 20, committedQuantity: 20, availableQuantity: 0 });
    // The exhausted inactive Size must still divide a new Style total by two.
    const invalidSplitStore = await createTestRetailStore(a.distributorId);
    const invalidSplit = await request(app)
      .post('/sale-orders')
      .set('Authorization', `Bearer ${own.token}`)
      .set('Idempotency-Key', createId())
      .send({
        factoryId: a.factoryId,
        soDate: '2026-06-30',
        distributors: [
          {
            clientKey: 'g',
            distributorId: a.distributorId,
            destinations: [
              {
                clientKey: 'd',
                retailStoreId: invalidSplitStore.id,
                addressLine1: 'Test',
                city: 'Chennai',
                state: 'TN',
                country: 'India',
              },
            ],
          },
        ],
        lines: [{ destinationClientKey: 'd', styleId: a.styleId, totalQuantity: 3 }],
      })
      .expect(400);
    expect(invalidSplit.body.error.message).toMatch(/does not divide evenly across its 2 Size/);
    // Deliberate inconsistent ledger fixture: reads must expose the negative value.
    await prisma.stockAllocation.updateMany({
      where: { qaReleaseLineId: a.qaReleaseLineId },
      data: { quantity: 25 },
    });
    const rows = await getPooledFactoryInventory(prisma, filters);
    expect(rows.find((r) => r.sizeId === a.sizeId)?.availableQuantity).toBe(-5);
    expect(rows.find((r) => r.sizeId === b.sizeId)?.availableQuantity).toBe(20);
    expect(normalized(rows)).toEqual(
      normalized(await getReferencePooledFactoryInventory(prisma, filters)),
    );
  });

  it('does not materialize historical release rows to compute one pool total', async () => {
    const a = await createReleasedQaStock({ quantity: 100 });
    await createReleasedQaStock({
      factoryId: a.factoryId,
      styleId: a.styleId,
      sizeId: a.sizeId,
      quantity: 30,
    });
    const historicalRead = vi.spyOn(prisma.qaReleaseLine, 'findMany');
    expect(await getPooledFactoryInventory(prisma, { factoryId: a.factoryId })).toEqual([
      expect.objectContaining({
        releasedQuantity: 130,
        committedQuantity: 0,
        availableQuantity: 130,
      }),
    ]);
    expect(historicalRead).not.toHaveBeenCalled();
  });

  it('keeps totals above int4 range exact', async () => {
    // The fixture creates upstream quantities at 4x the release amount.
    const a = await createReleasedQaStock({ quantity: 500_000_000 });
    for (let i = 0; i < 4; i += 1) {
      await createReleasedQaStock({
        factoryId: a.factoryId,
        styleId: a.styleId,
        sizeId: a.sizeId,
        quantity: 500_000_000,
      });
    }
    const filters = { factoryId: a.factoryId };
    expect((await getPooledFactoryInventory(prisma, filters))[0]?.releasedQuantity).toBe(
      2_500_000_000,
    );
    expect(normalized(await getPooledFactoryInventory(prisma, filters))).toEqual(
      normalized(await getReferencePooledFactoryInventory(prisma, filters)),
    );
  });

  it.each(['releasedQuantity', 'committedQuantity', 'availableQuantity'] as const)(
    'rejects unsafe %s from the SQL boundary',
    async (field) => {
      const a = await createReleasedQaStock({ quantity: 1 });
      const [row] = await getReferencePooledFactoryInventory(prisma, { factoryId: a.factoryId });
      // Reaching >2^53 with int4 source rows would require millions of releases.
      // Stub only the database boundary; exercise the production DTO conversion.
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([
        {
          ...row,
          releasedQuantity: 1n,
          committedQuantity: 0n,
          availableQuantity: 1n,
          [field]: 9_007_199_254_740_992n,
        },
      ]);
      await expect(getPooledFactoryInventory(prisma, { factoryId: a.factoryId })).rejects.toThrow(
        /safe integer/i,
      );
    },
  );
});
