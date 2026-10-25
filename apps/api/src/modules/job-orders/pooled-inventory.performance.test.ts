import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { createId } from '@erve/shared';
import { PrismaClient } from '../../generated/prisma/client.js';
import { Prisma, prisma } from '../../db/prisma.js';
import {
  createReleasedQaStock,
  createTestFinancialYear,
  createTestUser,
  resetDatabase,
} from '../../test/helpers.js';
import { getReferencePooledFactoryInventory } from '../../test/pooled-inventory-reference.js';
import { getPooledFactoryInventory } from './pooled-inventory.service.js';

// Explicit opt-in: normal focused runs and CI do not seed volume histories.
describe.skipIf(process.env.POOLED_INVENTORY_BENCHMARK !== '1')(
  'PAG-P1-08 disposable volume benchmark',
  () => {
    afterAll(() => prisma.$disconnect());

    it('compares both implementations on identical increasing histories at fixed pool cardinality', async () => {
      const target = new URL(process.env.DATABASE_URL!);
      // This harness is intentionally restricted to the independently verified
      // Batch 10 container, not merely any database passing the test-name guard.
      expect([target.hostname, target.port, target.pathname]).toEqual([
        '127.0.0.1',
        '55450',
        '/erve_batch10_test',
      ]);
      await resetDatabase();
      const stock = await createReleasedQaStock({ quantity: 10 });
      const release = await prisma.qaRelease.findUniqueOrThrow({
        where: { id: stock.qaReleaseId },
      });
      const batch = await prisma.finalQualityBatch.findUniqueOrThrow({
        where: { id: release.finalQualityBatchId },
      });
      const execution = await prisma.qualityActivityExecution.findUniqueOrThrow({
        where: { id: release.sourceQualityExecutionId },
      });
      const actorId = await createTestUser({
        email: `${createId()}@test.local`,
        password: 'pass',
        roles: ['ADMIN'],
      });
      const fy = await createTestFinancialYear();
      const orderId = createId();
      const groupId = createId();
      const destinationIds = [createId(), createId()];
      await prisma.saleOrder.create({
        data: {
          id: orderId,
          saleOrderNumber: `BENCH-${orderId}`,
          financialYearId: fy.id,
          soSerial: 1,
          factoryId: stock.factoryId,
          soDate: new Date('2026-06-30'),
          createdBy: actorId,
        },
      });
      await prisma.saleOrderDistributor.create({
        data: {
          id: groupId,
          saleOrderId: orderId,
          distributorId: stock.distributorId,
          purchaseMode: 'OUTRIGHT',
        },
      });
      await prisma.saleOrderDestination.createMany({
        data: destinationIds.map((id) => ({
          id,
          saleOrderId: orderId,
          saleOrderDistributorId: groupId,
          addressLine1: 'Benchmark',
          city: 'Chennai',
          state: 'TN',
          country: 'India',
        })),
      });
      const lineIds = [createId(), createId()];
      await prisma.saleOrderLine.createMany({
        data: lineIds.map((id, index) => ({
          id,
          saleOrderId: orderId,
          destinationId: destinationIds[index]!,
          styleId: stock.styleId,
          sizeId: stock.sizeId,
          quantity: 50_000,
        })),
      });

      const events: Prisma.QueryEvent[] = [];
      const measured = new PrismaClient({
        adapter: new PrismaPg({ connectionString: target.toString() }),
        log: [{ emit: 'event', level: 'query' }],
      });
      measured.$on('query', (event) => events.push(event));
      let returnedRows = 0;
      const observed = measured.$extends({
        query: {
          async $allOperations({ args, query }) {
            const result = await query(args);
            if (Array.isArray(result)) returnedRows += result.length;
            return result;
          },
        },
      }) as unknown as typeof prisma;
      const outputDirectory = process.env.POOLED_INVENTORY_BENCHMARK_OUTPUT;
      const samples: unknown[] = [];
      let seeded = 1;
      try {
        for (const count of [100, 1_000, 10_000]) {
          const indices = Array.from({ length: count - seeded }, (_, i) => seeded + i + 1);
          await prisma.$transaction(
            async (tx) => {
              await tx.finalQualityBatch.createMany({
                data: indices.map((n) => ({
                  ...batch,
                  id: `bench-b-${n}`,
                  batchNumber: n,
                  disposition: 'DRAFT',
                  terminalById: null,
                  terminalAt: null,
                })),
              });
              await tx.finalQualityBatchAllocation.createMany({
                data: indices.map((n) => ({
                  id: `bench-ba-${n}`,
                  finalQualityBatchId: `bench-b-${n}`,
                  jobOrderLineSizeId: stock.jobOrderLineSizeId,
                  quantity: 10,
                })),
              });
              await tx.qualityActivityExecution.createMany({
                data: indices.map((n) => ({
                  ...execution,
                  id: `bench-e-${n}`,
                  finalQualityBatchId: `bench-b-${n}`,
                  batchNumber: n,
                })),
              });
              await tx.qaRelease.createMany({
                data: indices.map((n) => ({
                  ...release,
                  id: `bench-r-${n}`,
                  finalQualityBatchId: `bench-b-${n}`,
                  sourceQualityExecutionId: `bench-e-${n}`,
                })),
              });
              await tx.qaReleaseLine.createMany({
                data: indices.map((n) => ({
                  id: `bench-rl-${n}`,
                  qaReleaseId: `bench-r-${n}`,
                  jobOrderLineSizeId: stock.jobOrderLineSizeId,
                  quantity: 10,
                })),
              });
              await tx.finalQualityBatch.updateMany({
                where: { id: { in: indices.map((n) => `bench-b-${n}`) } },
                data: { disposition: 'RELEASED', terminalById: actorId, terminalAt: new Date() },
              });
              await tx.stockAllocation.createMany({
                data: indices.flatMap((n) =>
                  lineIds.map((lineId, i) => ({
                    id: `bench-sa-${n}-${i}`,
                    saleOrderLineId: lineId,
                    qaReleaseLineId: `bench-rl-${n}`,
                    quantity: i + 2,
                    status: 'ACTIVE',
                    allocationSource: 'MERCHANDISER_ALLOCATION',
                    allocatedById: actorId,
                  })),
                ),
              });
            },
            { timeout: 180_000 },
          );
          seeded = count;
          await prisma.$executeRaw`ANALYZE`;
          const filters = { factoryId: stock.factoryId };
          const baseline = await getReferencePooledFactoryInventory(observed, filters);
          expect(await getPooledFactoryInventory(observed, filters)).toEqual(baseline);
          expect(baseline[0]).toMatchObject({
            releasedQuantity: count * 10,
            committedQuantity: (count - 1) * 5,
            availableQuantity: count * 5 + 5,
          });
          expect(
            await getPooledFactoryInventory(observed, { ...filters, excludeSaleOrderId: orderId }),
          ).toEqual(
            await getReferencePooledFactoryInventory(observed, {
              ...filters,
              excludeSaleOrderId: orderId,
            }),
          );

          for (const [name, fn] of [
            ['old', getReferencePooledFactoryInventory],
            ['new', getPooledFactoryInventory],
          ] as const) {
            const runs: { ms: number; queries: number; rows: number; heapDeltaBytes: number }[] =
              [];
            let representative: Prisma.QueryEvent[] = [];
            for (let run = 0; run < 5; run += 1) {
              events.length = 0;
              returnedRows = 0;
              globalThis.gc?.();
              const heapBefore = process.memoryUsage().heapUsed;
              const started = performance.now();
              expect(await fn(observed, filters)).toEqual(baseline);
              runs.push({
                ms: performance.now() - started,
                queries: events.length,
                rows: returnedRows,
                heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
              });
              representative = events.filter(
                (event) =>
                  event.query.includes('qa_release_lines') ||
                  (event.query.includes('stock_allocations') && event.query.includes('GROUP BY')),
              );
            }
            expect(representative).toHaveLength(name === 'old' ? 2 : 1);
            // Replay our own Prisma-generated SELECT, retaining every parameter
            // as a bound value. No fixture values are interpolated into SQL text.
            const plans = [];
            for (const statement of representative) {
              const values = JSON.parse(statement.params) as unknown[];
              const strings = statement.query.split(/\$\d+/g);
              strings[0] = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${strings[0]}`;
              const parameters = [...statement.query.matchAll(/\$(\d+)/g)].map(
                (match) => values[Number(match[1]) - 1],
              );
              plans.push(await measured.$queryRaw(new Prisma.Sql(strings, parameters)));
            }
            const sample = {
              releases: count,
              allocations: (count - 1) * 2,
              pools: 1,
              implementation: name,
              runs,
              plans,
            };
            samples.push(sample);
            console.log(JSON.stringify(sample));
          }
        }
        if (outputDirectory) {
          fs.mkdirSync(outputDirectory, { recursive: true });
          fs.writeFileSync(
            path.join(outputDirectory, 'pooled-inventory-benchmark.json'),
            JSON.stringify(samples, null, 2),
          );
        }
      } finally {
        await measured.$disconnect();
      }
    }, 600_000);
  },
);
