import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';

const app = createApp();
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52,
]);
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture(
  policy:
    'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' | 'PROGRESS_PERCENTAGE' = 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
  threshold = 50,
) {
  const qa = await createTestUserAndToken({
    email: `qa-${createId()}@test.local`,
    password: 'pass',
    roles: ['QA_USER'],
  });
  const factory = await createTestFactory();
  const distributor = await createTestDistributor();
  const style = await prisma.style.create({
    data: {
      id: createId(),
      styleNumber: `ST-${createId()}`,
      styleName: 'Inspection style',
      finalMrp: 100,
    },
  });
  const size = await prisma.size.create({
    data: { id: createId(), code: `S-${createId()}`, label: 'S', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const po = await prisma.distributorPurchaseOrder.create({
    data: {
      id: createId(),
      poNumber: `PO-${createId()}`,
      distributorId: distributor.id,
      poDate: new Date(),
      purchaseMode: 'OUTRIGHT',
      status: 'SUBMITTED',
      createdBy: qa.userId,
      lines: {
        create: {
          id: createId(),
          styleId: style.id,
          sizes: { create: { id: createId(), sizeId: size.id, orderedQuantity: 100 } },
        },
      },
    },
    include: { lines: { include: { sizes: true } } },
  });
  const components = [
    {
      id: createId(),
      sequence: 1,
      type: 'SYSTEM_CONTEXT' as const,
      title: 'Context',
      config: {
        fields: [
          {
            key: 'jobOrder',
            label: 'Job Order',
            dataType: 'TEXT',
            source: 'SYSTEM',
            sourceKey: 'JOB_ORDER_NUMBER',
          },
        ],
      },
    },
    {
      id: createId(),
      sequence: 2,
      type: 'PRODUCTION_PROGRESS' as const,
      title: 'Progress',
      config: {
        metrics: [{ key: 'sewn', label: 'Sewn', source: 'SYSTEM', sourceActivityCode: 'SEWING' }],
      },
    },
    {
      id: createId(),
      sequence: 3,
      type: 'CHECKLIST' as const,
      title: 'Checks',
      config: {
        items: [{ key: 'workmanship', label: 'Workmanship' }],
        responseOptions: ['PASSED', 'FAILED'],
      },
    },
    {
      id: createId(),
      sequence: 4,
      type: 'AQL_RESULT' as const,
      title: 'AQL',
      config: { criteria: [{ severity: 'MAJOR', aql: 2.5 }] },
    },
    {
      id: createId(),
      sequence: 5,
      type: 'INSPECTION_OUTCOME' as const,
      title: 'Outcome',
      config: { allowedOutcomes: ['PASS', 'FAIL'], remarksRequiredWhen: 'FAIL' },
    },
    {
      id: createId(),
      sequence: 6,
      type: 'SIGNATURES' as const,
      title: 'Sign-off',
      config: {
        roles: [{ key: 'qualityController', label: 'Quality Controller', required: true }],
      },
    },
    {
      id: createId(),
      sequence: 7,
      type: 'ATTACHMENTS' as const,
      title: 'Evidence',
      config: {
        requirements: [
          {
            key: 'inspectionPhoto',
            label: 'Inspection photo',
            requiredWhen: 'INSPECTION_FAILED',
          },
        ],
      },
    },
  ];
  const form = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `INLINE_${createId()}`,
      name: 'Inline Inspection Report',
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
              title: 'Inspection',
              components: { create: components },
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
      code: `PF-${createId()}`,
      name: 'Quality flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const sewing = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 1,
      name: 'Sewing',
      code: 'SEWING',
    },
  });
  const activity = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 2,
      name: policy === 'PROGRESS_PERCENTAGE' ? 'Final Inspection' : 'Inline Inspection',
      activityType: 'QUALITY',
      qualityFormVersionId: form.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: sewing.id,
      qualityAvailabilityPolicy: policy,
      executionMultiplicity: 'SINGLE',
      progressThresholdPercent: policy === 'PROGRESS_PERCENTAGE' ? threshold : null,
    },
  });
  const jobOrder = await prisma.jobOrder.create({
    data: {
      id: createId(),
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: po.id,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: 10,
      status: 'IN_PRODUCTION',
      createdBy: qa.userId,
      lines: {
        create: {
          id: createId(),
          purchaseOrderLineId: po.lines[0]!.id,
          styleId: style.id,
          orderedQuantityTotal: 100,
          status: 'IN_PRODUCTION',
          sizes: {
            create: {
              id: createId(),
              purchaseOrderLineSizeId: po.lines[0]!.sizes[0]!.id,
              sizeId: size.id,
              orderedQuantity: 100,
            },
          },
        },
      },
      stageStatuses: {
        create: {
          id: createId(),
          processFlowVersionStageId: sewing.id,
          stageSequence: 1,
          stageNameSnapshot: 'Sewing',
          status: 'NOT_STARTED',
          completedQuantity: 0,
        },
      },
    },
    include: { stageStatuses: true },
  });
  return { qa, jobOrder, sewing, activity, form, components };
}

const start = (f: Awaited<ReturnType<typeof fixture>>, token = f.qa.token) =>
  request(app)
    .post(`/job-orders/${f.jobOrder.id}/quality-activities/${f.activity.id}/executions`)
    .set('Authorization', `Bearer ${token}`);
function completePayload(
  f: Awaited<ReturnType<typeof fixture>>,
  execution: { version: number },
  outcome: 'PASS' | 'FAIL' = 'PASS',
) {
  return {
    expectedVersion: execution.version,
    checklistResponses: [
      { componentId: f.components[2]!.id, itemKey: 'workmanship', response: 'PASSED' },
    ],
    aqlResults: [
      {
        componentId: f.components[3]!.id,
        severity: 'MAJOR',
        maxAllowed: 2,
        found: outcome === 'PASS' ? 1 : 3,
      },
    ],
    defects: [],
    correctiveActions: [],
    testResults: [],
    quantities: [],
    comments: [],
    signoffs: [
      {
        componentId: f.components[5]!.id,
        roleKey: 'qualityController',
        signatoryName: 'QA Inspector',
      },
    ],
    outcome: {
      componentId: f.components[4]!.id,
      value: outcome,
      remarks: outcome === 'FAIL' ? 'Inspection failed' : null,
    },
  };
}

describe('Quality Activity Execution API', () => {
  it('gates Inline start to the associated active Production activity and does not allow a late new start', async () => {
    const f = await fixture();
    expect((await start(f)).status).toBe(409);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.jobOrder.stageStatuses[0]!.id },
      data: { status: 'IN_PROGRESS' },
    });
    const started = await start(f);
    expect(started.status).toBe(201);
    expect(started.body.data).toMatchObject({
      processFlowActivityId: f.activity.id,
      status: 'DRAFT',
      attemptNumber: 1,
      qualityForm: { versionId: f.form.versions[0]!.id },
    });
    await prisma.qualityActivityExecution.delete({ where: { id: started.body.data.id } });
    await prisma.jobOrderStageStatus.update({
      where: { id: f.jobOrder.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedQuantity: 100 },
    });
    expect((await start(f)).status).toBe(409);
  });

  it('honors exact configurable progress thresholds', async () => {
    const f = await fixture('PROGRESS_PERCENTAGE', 30);
    const runtime = f.jobOrder.stageStatuses[0]!;
    await prisma.jobOrderStageStatus.update({
      where: { id: runtime.id },
      data: { status: 'IN_PROGRESS', completedQuantity: 29 },
    });
    expect((await start(f)).status).toBe(409);
    await prisma.jobOrderStageStatus.update({
      where: { id: runtime.id },
      data: { completedQuantity: 30 },
    });
    expect((await start(f)).status).toBe(201);
  });

  it('rejects Production/wrong activities and unsupported form scope', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({
      where: { id: f.jobOrder.stageStatuses[0]!.id },
      data: { status: 'IN_PROGRESS' },
    });
    expect(
      (
        await request(app)
          .post(`/job-orders/${f.jobOrder.id}/quality-activities/${f.sewing.id}/executions`)
          .set('Authorization', `Bearer ${f.qa.token}`)
      ).status,
    ).toBe(400);
    await prisma.qualityFormVersion.update({
      where: { id: f.form.versions[0]!.id },
      data: { executionScope: 'SIZE' },
    });
    expect((await start(f)).status).toBe(400);
  });

  it('authorizes QA operations and makes concurrent/repeated start idempotent', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({
      where: { id: f.jobOrder.stageStatuses[0]!.id },
      data: { status: 'IN_PROGRESS' },
    });
    const outsider = await createTestUserAndToken({
      email: 'factory-executor@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    expect((await start(f, outsider.token)).status).toBe(403);
    const [one, two] = await Promise.all([start(f), start(f)]);
    expect([one.status, two.status].every((x) => x === 201)).toBe(true);
    expect(one.body.data.id).toBe(two.body.data.id);
    expect(await prisma.qualityActivityExecution.count()).toBe(1);
  });

  it('accepts incomplete drafts, rejects cross-definition values, suppresses no-ops, and detects stale versions', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({
      where: { id: f.jobOrder.stageStatuses[0]!.id },
      data: { status: 'IN_PROGRESS' },
    });
    const execution = (await start(f)).body.data;
    const empty = {
      expectedVersion: execution.version,
      checklistResponses: [],
      aqlResults: [],
      defects: [],
      correctiveActions: [],
      testResults: [],
      quantities: [],
      comments: [],
      signoffs: [],
      outcome: null,
    };
    const noop = await request(app)
      .put(`/quality-executions/${execution.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(empty);
    expect(noop.status).toBe(200);
    expect(noop.body.data.version).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'QUALITY_ACTIVITY_DRAFT_SAVED' } })).toBe(
      0,
    );
    const invalid = await request(app)
      .put(`/quality-executions/${execution.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({
        ...empty,
        checklistResponses: [
          { componentId: f.components[2]!.id, itemKey: 'unknown', response: 'PASSED' },
        ],
      });
    expect(invalid.status).toBe(400);
    const saved = await request(app)
      .put(`/quality-executions/${execution.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({
        ...empty,
        checklistResponses: [
          { componentId: f.components[2]!.id, itemKey: 'workmanship', response: 'PASSED' },
        ],
      });
    expect(saved.body.data.version).toBe(2);
    expect(
      (
        await request(app)
          .put(`/quality-executions/${execution.id}`)
          .set('Authorization', `Bearer ${f.qa.token}`)
          .send(empty)
      ).body.error.code,
    ).toBe('STALE_VERSION');
  });

  it('uses strict finalization, persists PASS/FAIL truthfully, and strands no started draft', async () => {
    for (const outcome of ['PASS', 'FAIL'] as const) {
      const f = await fixture();
      await prisma.jobOrderStageStatus.update({
        where: { id: f.jobOrder.stageStatuses[0]!.id },
        data: { status: 'IN_PROGRESS' },
      });
      const execution = (await start(f)).body.data;
      await prisma.jobOrderStageStatus.update({
        where: { id: f.jobOrder.stageStatuses[0]!.id },
        data: { status: 'COMPLETED', completedQuantity: 100 },
      });
      const missing = await request(app)
        .post(`/quality-executions/${execution.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send({ ...completePayload(f, execution, outcome), signoffs: [] });
      expect(missing.status).toBe(400);
      if (outcome === 'FAIL') {
        const missingConditionalEvidence = await request(app)
          .post(`/quality-executions/${execution.id}/finalize`)
          .set('Authorization', `Bearer ${f.qa.token}`)
          .send(completePayload(f, execution, outcome));
        expect(missingConditionalEvidence.status).toBe(400);
        await request(app)
          .post(`/quality-executions/${execution.id}/attachments`)
          .set('Authorization', `Bearer ${f.qa.token}`)
          .field('componentId', f.components[6]!.id)
          .field('requirementKey', 'inspectionPhoto')
          .attach('image', png, 'failed-part.png');
      }
      const finalized = await request(app)
        .post(`/quality-executions/${execution.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send(completePayload(f, execution, outcome));
      expect(finalized.status).toBe(200);
      expect(finalized.body.data.responses.outcome.value).toBe(outcome);
      expect(
        (
          await request(app)
            .put(`/quality-executions/${execution.id}`)
            .set('Authorization', `Bearer ${f.qa.token}`)
            .send(completePayload(f, { version: finalized.body.data.version }, outcome))
        ).status,
      ).toBe(409);
      const production = await prisma.jobOrderStageStatus.findUniqueOrThrow({
        where: { id: f.jobOrder.stageStatuses[0]!.id },
      });
      expect(production.status).toBe('COMPLETED');
      expect(await prisma.qaReworkTask.count()).toBe(0);
      await resetDatabase();
    }
  });

  it('scopes attachment ownership and duplicates to one execution and freezes evidence on finalize', async () => {
    const first = await fixture();
    const second = await fixture();
    await prisma.jobOrderStageStatus.updateMany({
      where: {
        id: { in: [first.jobOrder.stageStatuses[0]!.id, second.jobOrder.stageStatuses[0]!.id] },
      },
      data: { status: 'IN_PROGRESS' },
    });
    const firstExecution = (await start(first)).body.data;
    const secondExecution = (await start(second)).body.data;
    const upload = (executionId: string, token: string, componentId: string) =>
      request(app)
        .post(`/quality-executions/${executionId}/attachments`)
        .set('Authorization', `Bearer ${token}`)
        .field('componentId', componentId)
        .field('requirementKey', 'inspectionPhoto')
        .attach('image', png, 'photo.png');
    const firstUpload = await upload(firstExecution.id, first.qa.token, first.components[6]!.id);
    expect(firstUpload.status).toBe(201);
    expect(
      (
        await request(app)
          .get(`/quality-executions/attachments/${firstUpload.body.data.id}/content`)
          .set('Authorization', `Bearer ${first.qa.token}`)
      ).status,
    ).toBe(200);
    expect((await upload(firstExecution.id, first.qa.token, first.components[6]!.id)).status).toBe(
      200,
    );
    expect(
      (await upload(secondExecution.id, second.qa.token, second.components[6]!.id)).status,
    ).toBe(201);
    expect(await prisma.qualityAttachment.count()).toBe(2);
    await request(app)
      .post(`/quality-executions/${firstExecution.id}/finalize`)
      .set('Authorization', `Bearer ${first.qa.token}`)
      .send(completePayload(first, firstExecution));
    expect(
      (
        await request(app)
          .delete(`/quality-executions/attachments/${firstUpload.body.data.id}`)
          .set('Authorization', `Bearer ${first.qa.token}`)
      ).status,
    ).toBe(409);
    expect((await upload(firstExecution.id, first.qa.token, first.components[6]!.id)).status).toBe(
      409,
    );
    const factoryUser = await createTestUserAndToken({
      email: 'attachment-factory@test.local',
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    expect(
      (await upload(secondExecution.id, factoryUser.token, second.components[6]!.id)).status,
    ).toBe(403);
  });
});
