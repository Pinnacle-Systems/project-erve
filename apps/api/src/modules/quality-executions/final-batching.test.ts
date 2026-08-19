import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestDistributor, createTestFactory, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function fixture(preparedQuantity = 840) {
  const qa = await createTestUserAndToken({ email: `final-${createId()}@test.local`, password: 'pass', roles: ['QA_USER'] });
  const factory = await createTestFactory();
  const distributor = await createTestDistributor();
  const style = await prisma.style.create({ data: { id: createId(), styleNumber: `FINAL-${createId()}`, styleName: 'Final style', finalMrp: 100 } });
  const size = await prisma.size.create({ data: { id: createId(), code: `M-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 } });
  const po = await prisma.distributorPurchaseOrder.create({ data: { id: createId(), poNumber: `PO-${createId()}`, distributorId: distributor.id, poDate: new Date(), purchaseMode: 'OUTRIGHT', status: 'SUBMITTED', createdBy: qa.userId, lines: { create: { id: createId(), styleId: style.id, sizes: { create: { id: createId(), sizeId: size.id, orderedQuantity: 840 } } } } }, include: { lines: { include: { sizes: true } } } });
  const outcomeId = createId();
  const form = await prisma.qualityForm.create({ data: { id: createId(), code: `FINAL_${createId()}`, name: 'Final Inspection', versions: { create: { id: createId(), versionNumber: 2, activityType: 'INSPECTION', executionScope: 'JOB_ORDER', status: 'PUBLISHED', publishedAt: new Date(), sections: { create: { id: createId(), sequence: 1, title: 'Conclusion', components: { create: { id: outcomeId, sequence: 1, type: 'INSPECTION_OUTCOME', title: 'Inspection conclusion', config: { allowedOutcomes: ['PASS', 'FAIL'] } } } } } } } }, include: { versions: true } });
  const flow = await prisma.processFlow.create({ data: { id: createId(), code: `FINAL-FLOW-${createId()}`, name: 'Final batching flow', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } }, include: { versions: true } });
  const sewing = await prisma.processFlowVersionStage.create({ data: { id: createId(), processFlowVersionId: flow.versions[0]!.id, sequence: 1, name: 'Sewing', code: 'SEWING' } });
  const final = await prisma.processFlowVersionStage.create({ data: { id: createId(), processFlowVersionId: flow.versions[0]!.id, sequence: 2, name: 'Final Inspection', activityType: 'QUALITY', qualityFormVersionId: form.versions[0]!.id, qualityExecutionMode: 'IN_PROCESS', associatedProductionActivityId: sewing.id, qualityAvailabilityPolicy: 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES', executionMultiplicity: 'BATCHED', coverageTarget: 'PREPARED_QUANTITY' } });
  const job = await prisma.jobOrder.create({ data: { id: createId(), jobOrderNumber: `JO-${createId()}`, purchaseOrderId: po.id, factoryId: factory.id, processFlowVersionId: flow.versions[0]!.id, unitPrice: 10, status: 'IN_PRODUCTION', factoryConfirmationStatus: 'CONFIRMED', preparedQuantityTotal: preparedQuantity, createdBy: qa.userId, lines: { create: { id: createId(), purchaseOrderLineId: po.lines[0]!.id, styleId: style.id, orderedQuantityTotal: 840, preparedQuantityTotal: preparedQuantity, sizes: { create: { id: createId(), purchaseOrderLineSizeId: po.lines[0]!.sizes[0]!.id, sizeId: size.id, orderedQuantity: 840, preparedQuantity } } } }, stageStatuses: { create: { id: createId(), processFlowVersionStageId: sewing.id, stageSequence: 1, stageNameSnapshot: 'Sewing', status: 'IN_PROGRESS', completedQuantity: 840 } } }, include: { stageStatuses: true } });
  return { qa, job, sewing, final, form, outcomeId };
}

const payload = (version: number, outcomeId: string, outcome: 'PASS' | 'FAIL') => ({ expectedVersion: version, checklistResponses: [], aqlResults: [], defects: [], correctiveActions: [], testResults: [], quantities: [], comments: [], fieldResponses: [], attendees: [], actions: [], signoffs: [], outcome: { componentId: outcomeId, value: outcome } });
const start = (f: Awaited<ReturnType<typeof fixture>>, quantity: number) => request(app).post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`).set('Authorization', `Bearer ${f.qa.token}`).send({ inspectedQuantity: quantity });
const finalize = (f: Awaited<ReturnType<typeof fixture>>, execution: { id: string; version: number }, outcome: 'PASS' | 'FAIL' = 'PASS') => request(app).post(`/quality-executions/${execution.id}/finalize`).set('Authorization', `Bearer ${f.qa.token}`).send(payload(execution.version, f.outcomeId, outcome));

describe('Final Inspection batching and prepared coverage', () => {
  it('becomes available only after Sewing completes, without a percentage gate', async () => {
    const f = await fixture();
    await start(f, 300).expect(409);
    await prisma.jobOrderStageStatus.update({ where: { id: f.job.stageStatuses[0]!.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const execution = await start(f, 300).expect(201);
    expect(execution.body.data).toMatchObject({ batchNumber: 1, inspectedQuantity: 300, qualityForm: { versionId: f.form.versions[0]!.id } });
  });

  it('keeps an early batch as a draft while prepared quantity is not authoritative', async () => {
    const f = await fixture(0);
    await prisma.jobOrderStageStatus.update({
      where: { id: f.job.stageStatuses[0]!.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const started = (await start(f, 300).expect(201)).body.data;
    expect(started.coverage).toMatchObject({
      preparedQuantityAuthoritative: false,
      preparedQuantity: null,
      inspectedQuantity: 0,
      remainingQuantity: null,
      complete: false,
      reconciliationConflict: false,
    });
    const saved = await request(app)
      .put(`/quality-executions/${started.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(payload(started.version, f.outcomeId, 'PASS'))
      .expect(200);
    await finalize(f, saved.body.data).expect(409);
    const persisted = await prisma.qualityActivityExecution.findUniqueOrThrow({
      where: { id: started.id },
    });
    expect(persisted.status).toBe('DRAFT');
    expect(persisted.outcome).toBe('PASS');
  });

  it('aggregates 300 + 250 + 290 and keeps FAIL separate from physical coverage', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({ where: { id: f.job.stageStatuses[0]!.id }, data: { status: 'COMPLETED' } });
    const quantities = [300, 250, 290];
    let last: { id: string; version: number } | undefined;
    for (const [index, quantity] of quantities.entries()) {
      const started = await start(f, quantity).expect(201);
      last = started.body.data;
      const finalized = await finalize(f, last!, index === 1 ? 'FAIL' : 'PASS').expect(200);
      expect(finalized.body.data.coverage.inspectedQuantity).toBe(quantities.slice(0, index + 1).reduce((a, b) => a + b, 0));
    }
    const view = await request(app).get(`/quality-executions/${last!.id}`).set('Authorization', `Bearer ${f.qa.token}`).expect(200);
    expect(view.body.data.coverage).toMatchObject({ preparedQuantity: 840, inspectedQuantity: 840, remainingQuantity: 0, complete: true, reconciliationConflict: false });
    expect(view.body.data.coverage.batches[1]).toMatchObject({ batchNumber: 2, inspectedQuantity: 250, outcome: 'FAIL' });
    expect(view.body.data.attemptNumber).toBe(1);
    expect(view.body.data.batchNumber).toBe(3);
  });

  it('does not count drafts, rejects over-inspection, and surfaces later prepared-quantity changes', async () => {
    const f = await fixture();
    await prisma.jobOrderStageStatus.update({ where: { id: f.job.stageStatuses[0]!.id }, data: { status: 'COMPLETED' } });
    const first = (await start(f, 800).expect(201)).body.data;
    await finalize(f, first).expect(200);
    const draft = (await start(f, 50).expect(201)).body.data;
    expect(draft.coverage.inspectedQuantity).toBe(800);
    await finalize(f, draft).expect(400);
    await prisma.jobOrder.update({ where: { id: f.job.id }, data: { preparedQuantityTotal: 900 } });
    const increased = await request(app).get(`/quality-executions/${first.id}`).set('Authorization', `Bearer ${f.qa.token}`).expect(200);
    expect(increased.body.data.coverage).toMatchObject({ inspectedQuantity: 800, remainingQuantity: 100, reconciliationConflict: false });
    await prisma.jobOrder.update({ where: { id: f.job.id }, data: { preparedQuantityTotal: 790 } });
    const lowered = await request(app).get(`/quality-executions/${first.id}`).set('Authorization', `Bearer ${f.qa.token}`).expect(200);
    expect(lowered.body.data.coverage).toMatchObject({ inspectedQuantity: 800, remainingQuantity: 0, reconciliationConflict: true, complete: false });
  });

  it('serializes concurrent finalizations so cumulative coverage cannot overrun prepared quantity', async () => {
    const f = await fixture(100);
    await prisma.jobOrderStageStatus.update({ where: { id: f.job.stageStatuses[0]!.id }, data: { status: 'COMPLETED' } });
    const one = (await start(f, 60).expect(201)).body.data;
    const two = await prisma.qualityActivityExecution.create({ data: { id: createId(), jobOrderId: f.job.id, processFlowActivityId: f.final.id, qualityFormVersionId: f.form.versions[0]!.id, attemptNumber: 1, batchNumber: 2, inspectedQuantity: 50, startedById: f.qa.userId } });
    const [a, b] = await Promise.all([finalize(f, one), finalize(f, two)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const aggregate = await prisma.qualityActivityExecution.aggregate({ where: { jobOrderId: f.job.id, processFlowActivityId: f.final.id, status: 'FINALIZED' }, _sum: { inspectedQuantity: true } });
    expect(aggregate._sum.inspectedQuantity).toBeLessThanOrEqual(100);
  });
});
