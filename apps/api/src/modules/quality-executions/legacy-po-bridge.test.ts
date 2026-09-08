// Phase 2.1 regression coverage for the QaReleaseLine.purchaseOrderLineSizeId
// legacy Sale Order compatibility bridge: it may be populated only when (A)
// the releasing Job Order has exactly one source Order Sheet AND (B) that
// source has a matching line-size for the produced sizeId — never inferred
// from "which source looks like it forecasts this size" once there is more
// than one source. See job-orders-production-plan-decoupling plan
// §"QA / production service changes" and quality-executions.service.ts
// resolveLegacyPurchaseOrderLineSizeIds.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  allocateTestDocumentSerial,
  createTestDistributor,
  createTestFactory,
  createTestFinancialYear,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

interface OrderSheetSpec {
  sizeIds: string[];
}

// Builds N source Order Sheets (each forecasting the given sizes), a Job
// Order claimed by all of them producing `producedSizes`, and everything
// needed to drive one real BATCHED Final Inspection PASS through the HTTP
// API (mirrors final-batching.test.ts's fixture, generalized to N sources).
async function buildFixture(orderSheets: OrderSheetSpec[], producedSizes: Array<{ sizeId: string; quantity: number }>) {
  const qa = await createTestUserAndToken({
    email: `bridge-${createId()}@test.local`,
    password: 'pass',
    roles: ['QA_USER', 'ADMIN'],
  });
  const factory = await createTestFactory();
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: `BRIDGE-${createId()}`, styleName: 'Bridge style', finalMrp: 100 },
  });
  const financialYear = await createTestFinancialYear();

  const poIds: string[] = [];
  for (const sheet of orderSheets) {
    const distributor = await createTestDistributor();
    const poSerial = await allocateTestDocumentSerial('PURCHASE_ORDER', financialYear.id);
    const po = await prisma.distributorPurchaseOrder.create({
      data: {
        id: createId(),
        poNumber: `PO-${createId()}`,
        distributorId: distributor.id,
        poDate: new Date(),
        purchaseMode: 'OUTRIGHT',
        status: 'SUBMITTED',
        createdBy: qa.userId,
        financialYearId: financialYear.id,
        poSerial,
        lines: {
          create: {
            id: createId(),
            styleId: style.id,
            sizes: { create: sheet.sizeIds.map((sizeId) => ({ id: createId(), sizeId, orderedQuantity: 100 })) },
          },
        },
      },
    });
    poIds.push(po.id);
  }

  const outcomeId = createId();
  const form = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `BRIDGE_FORM_${createId()}`,
      name: 'Final Inspection',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          activityType: 'INSPECTION',
          executionScope: 'JOB_ORDER',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          sections: {
            create: {
              id: createId(),
              sequence: 1,
              title: 'Conclusion',
              components: {
                create: {
                  id: outcomeId,
                  sequence: 1,
                  type: 'INSPECTION_OUTCOME',
                  title: 'Inspection conclusion',
                  config: { allowedOutcomes: ['PASS', 'FAIL'] },
                },
              },
            },
          },
        },
      },
    },
    include: { versions: true },
  });
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `BRIDGE-FLOW-${createId()}`,
      name: 'Bridge flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const finishing = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 1,
      name: 'Finishing',
      code: 'FINISHING',
    },
  });
  const final = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 2,
      name: 'Final Inspection',
      activityType: 'QUALITY',
      qualityFormVersionId: form.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: finishing.id,
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    },
  });
  const totalQuantity = producedSizes.reduce((sum, size) => sum + size.quantity, 0);
  const jobOrderSerial = await allocateTestDocumentSerial('JOB_ORDER', financialYear.id);
  const job = await prisma.jobOrder.create({
    data: {
      id: createId(),
      jobOrderNumber: `JO-${createId()}`,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: 10,
      status: 'IN_PRODUCTION',
      factoryConfirmationStatus: 'CONFIRMED',
      preparedQuantityTotal: totalQuantity,
      createdBy: qa.userId,
      financialYearId: financialYear.id,
      jobOrderSerial,
      lines: {
        create: {
          id: createId(),
          styleId: style.id,
          orderedQuantityTotal: totalQuantity,
          preparedQuantityTotal: totalQuantity,
          sizes: {
            create: producedSizes.map((size) => ({
              id: createId(),
              sizeId: size.sizeId,
              orderedQuantity: size.quantity,
              preparedQuantity: size.quantity,
            })),
          },
        },
      },
      stageStatuses: {
        create: {
          id: createId(),
          processFlowVersionStageId: finishing.id,
          stageSequence: 1,
          stageNameSnapshot: 'Finishing',
          status: 'IN_PROGRESS',
          completedQuantity: totalQuantity,
        },
      },
    },
    include: { stageStatuses: true, lines: { include: { sizes: true } } },
  });
  for (const poId of poIds) {
    await prisma.distributorPurchaseOrder.update({ where: { id: poId }, data: { jobOrderId: job.id } });
  }
  return { qa, job, final, form, outcomeId, poIds };
}

const startAndFinalizePass = async (f: Awaited<ReturnType<typeof buildFixture>>) => {
  const started = await request(app)
    .post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .send({
      allocations: f.job.lines[0]!.sizes.map((size) => ({
        jobOrderLineSizeId: size.id,
        quantity: size.preparedQuantity,
      })),
    })
    .expect(201);
  const execution = started.body.data;
  await request(app)
    .post(`/quality-executions/${execution.id}/finalize`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .send({
      expectedVersion: execution.version,
      checklistResponses: [],
      aqlResults: [],
      defects: [],
      correctiveActions: [],
      testResults: [],
      quantities: [],
      comments: [],
      fieldResponses: [],
      attendees: [],
      actions: [],
      signoffs: [],
      outcome: { componentId: f.outcomeId, value: 'PASS' },
    })
    .expect(200);
  return prisma.qaReleaseLine.findMany({
    where: { release: { jobOrderId: f.job.id } },
    include: { jobOrderLineSize: true },
  });
};

describe('legacy QaReleaseLine.purchaseOrderLineSizeId bridge (Phase 2.1)', () => {
  it('stays null for every size of a multi-source Job Order, regardless of which source forecasts which size', async () => {
    const sizeA = createId();
    const sizeB = createId();
    await prisma.size.createMany({
      data: [
        { id: sizeA, code: `BRIDGE-A-${createId()}`, label: 'A', sizeType: 'ALPHA', sortOrder: 1 },
        { id: sizeB, code: `BRIDGE-B-${createId()}`, label: 'B', sizeType: 'ALPHA', sortOrder: 2 },
      ],
    });
    // OS-A forecasts only sizeA; OS-B forecasts only sizeB — the Job Order
    // (multi-source) produces sizeA. There is no "sizeA belongs to OS-A"
    // even though OS-A is the only source that forecasts it.
    const f = await buildFixture(
      [{ sizeIds: [sizeA] }, { sizeIds: [sizeB] }],
      [{ sizeId: sizeA, quantity: 90 }],
    );

    const releaseLines = await startAndFinalizePass(f);
    expect(releaseLines).toHaveLength(1);
    expect(releaseLines[0]!.purchaseOrderLineSizeId).toBeNull();

    const osALineSize = await prisma.distributorPurchaseOrderLineSize.findFirstOrThrow({
      where: { sizeId: sizeA, purchaseOrderLine: { purchaseOrderId: f.poIds[0] } },
    });
    expect(osALineSize.qaPassedQuantity).toBe(0);
  });

  it('stays null for a size a single source never forecast, but populates for a size it does', async () => {
    const forecastSize = createId();
    const extraSize = createId();
    await prisma.size.createMany({
      data: [
        { id: forecastSize, code: `BRIDGE-F-${createId()}`, label: 'F', sizeType: 'ALPHA', sortOrder: 1 },
        { id: extraSize, code: `BRIDGE-E-${createId()}`, label: 'E', sizeType: 'ALPHA', sortOrder: 2 },
      ],
    });
    // Exactly one source, forecasting only `forecastSize` — the Job Order
    // (still single-source) also produces `extraSize`, which that source
    // never forecast at all.
    const f = await buildFixture(
      [{ sizeIds: [forecastSize] }],
      [
        { sizeId: forecastSize, quantity: 60 },
        { sizeId: extraSize, quantity: 30 },
      ],
    );

    const releaseLines = await startAndFinalizePass(f);
    expect(releaseLines).toHaveLength(2);
    const byJobOrderLineSizeId = new Map(
      releaseLines.map((line) => [line.jobOrderLineSize.sizeId, line]),
    );
    expect(byJobOrderLineSizeId.get(forecastSize)!.purchaseOrderLineSizeId).not.toBeNull();
    expect(byJobOrderLineSizeId.get(extraSize)!.purchaseOrderLineSizeId).toBeNull();

    const forecastLineSize = await prisma.distributorPurchaseOrderLineSize.findFirstOrThrow({
      where: { sizeId: forecastSize, purchaseOrderLine: { purchaseOrderId: f.poIds[0] } },
    });
    expect(forecastLineSize.qaPassedQuantity).toBe(60);
    // No DistributorPurchaseOrderLineSize row exists for extraSize on this
    // source at all — nothing to increment, and nothing was invented.
    expect(
      await prisma.distributorPurchaseOrderLineSize.count({
        where: { sizeId: extraSize, purchaseOrderLine: { purchaseOrderId: f.poIds[0] } },
      }),
    ).toBe(0);
  });
});
