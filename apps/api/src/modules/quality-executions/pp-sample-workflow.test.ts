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
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const checklistCodes = [
  'FABRIC_COLOUR_QUALITY','TRIMS_CARD','FABRIC_GSM','MEASUREMENTS_REPORT','GARMENT_CONSTRUCTION',
  'GENERAL_QUALITY_PRESENTATION','LABELLING_POSITION','FIT_SAMPLE_BUYER_COMMENTS','SPI','SAMPLE_TAG',
  'DATA_SHEET_PULL_TEST_PINCH_SETTING','METAL_DETECTION','P_AND_P','PP_SAMPLE_FIT_COMMENTS','SOURCE_DECLARATION_FORM',
] as const;

async function workflow() {
  const qa = await createTestUserAndToken({ email: `qa-${createId()}@test.local`, password: 'pass', roles: ['QA_USER'] });
  const merchandiser = await createTestUserAndToken({ email: `merch-${createId()}@test.local`, password: 'pass', roles: ['MERCHANDISER'] });
  const factoryUser = await createTestUserAndToken({ email: `factory-${createId()}@test.local`, password: 'pass', roles: ['FACTORY_USER'] });
  const factory = await createTestFactory();
  await prisma.userFactory.create({ data: { id: createId(), userId: factoryUser.userId, factoryId: factory.id } });
  const distributor = await createTestDistributor();
  const style = await prisma.style.create({ data: { id: createId(), styleNumber: `PP-${createId()}`, styleName: 'PP style', finalMrp: 100 } });
  const sizes = await Promise.all(['S', 'M'].map((label, index) => prisma.size.create({ data: { id: createId(), code: `${label}-${createId()}`, label, sizeType: 'ALPHA', sortOrder: index + 1 } })));
  const po = await prisma.distributorPurchaseOrder.create({
    data: {
      id: createId(), poNumber: `PO-${createId()}`, distributorId: distributor.id, poDate: new Date(),
      purchaseMode: 'OUTRIGHT', status: 'SUBMITTED', createdBy: qa.userId,
      lines: { create: { id: createId(), styleId: style.id, sizes: { create: sizes.map((size) => ({ id: createId(), sizeId: size.id, orderedQuantity: 10 })) } } },
    },
    include: { lines: { include: { sizes: true } } },
  });
  const sampleForm = await prisma.qualityForm.create({
    data: { id: createId(), code: `SAMPLE_${createId()}`, name: 'Sample', versions: { create: { id: createId(), versionNumber: 1, activityType: 'INSPECTION', executionScope: 'SIZE', status: 'PUBLISHED', publishedAt: new Date() } } },
    include: { versions: true },
  });
  const fieldId = createId();
  const attendeeId = createId();
  const actionId = createId();
  const ppmForm = await prisma.qualityForm.create({
    data: { id: createId(), code: `PPM_${createId()}`, name: 'PPM', versions: { create: { id: createId(), versionNumber: 1, activityType: 'MEETING', executionScope: 'JOB_ORDER', status: 'PUBLISHED', publishedAt: new Date(), sections: { create: { id: createId(), sequence: 1, title: 'Meeting', components: { create: [
      { id: fieldId, sequence: 1, type: 'FIELD_GROUP', title: 'Meeting details', config: { fields: [{ key: 'meetingDate', label: 'Meeting Date', dataType: 'DATE', source: 'USER', required: true }] } },
      { id: attendeeId, sequence: 2, type: 'ATTENDEE_LIST', title: 'Attendees', config: { roles: ['QA'], allowOther: false } },
      { id: actionId, sequence: 3, type: 'ACTION_LIST', title: 'Actions', config: { columns: [{ key: 'action', label: 'Action', dataType: 'TEXT', required: true }, { key: 'settleDate', label: 'Settle Date', dataType: 'DATE' }] } },
    ] } } } } } },
    include: { versions: true },
  });
  const flow = await prisma.processFlow.create({ data: { id: createId(), code: `FLOW-${createId()}`, name: 'Confirmed workflow', versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } } }, include: { versions: true } });
  const versionId = flow.versions[0]!.id;
  const pp = await prisma.processFlowVersionStage.create({ data: { id: createId(), processFlowVersionId: versionId, sequence: 1, name: 'PP Sample Checklist', activityType: 'QUALITY', qualityFormVersionId: sampleForm.versions[0]!.id, qualityExecutionMode: 'SEQUENTIAL_GATE', gateSatisfactionRequirement: 'OUTCOME_PASS', executionMultiplicity: 'SINGLE' } });
  const ppm = await prisma.processFlowVersionStage.create({ data: { id: createId(), processFlowVersionId: versionId, sequence: 2, name: 'Size Set / Pre-Production', activityType: 'QUALITY', qualityFormVersionId: ppmForm.versions[0]!.id, qualityExecutionMode: 'SEQUENTIAL_GATE', gateSatisfactionRequirement: 'FINALIZED', executionMultiplicity: 'SINGLE' } });
  const cutting = await prisma.processFlowVersionStage.create({ data: { id: createId(), processFlowVersionId: versionId, sequence: 3, name: 'Cutting', code: 'CUTTING' } });
  const lineId = createId();
  const job = await prisma.jobOrder.create({
    data: {
      id: createId(), jobOrderNumber: `JO-${createId()}`, purchaseOrderId: po.id, factoryId: factory.id,
      processFlowVersionId: versionId, unitPrice: 10, status: 'SENT_TO_FACTORY', disclaimerText: 'Terms', disclaimerRevision: 1, createdBy: qa.userId,
      lines: { create: { id: lineId, purchaseOrderLineId: po.lines[0]!.id, styleId: style.id, orderedQuantityTotal: 20, sizes: { create: po.lines[0]!.sizes.map((size) => ({ id: createId(), purchaseOrderLineSizeId: size.id, sizeId: size.sizeId, orderedQuantity: 10 })) } } },
      stageStatuses: { create: { id: createId(), processFlowVersionStageId: cutting.id, stageSequence: cutting.sequence, stageNameSnapshot: cutting.name, completedQuantity: 0 } },
    },
    include: { lines: { include: { sizes: true } }, stageStatuses: true },
  });
  return { qa, merchandiser, factoryUser, job, pp, ppm, cutting, sampleForm, ppmForm, fieldId, attendeeId, actionId };
}

function startPp(f: Awaited<ReturnType<typeof workflow>>, quantity = 5, sizeId = f.job.lines[0]!.sizes[1]!.id) {
  return request(app).post(`/job-orders/${f.job.id}/quality-activities/${f.pp.id}/executions`).set('Authorization', `Bearer ${f.qa.token}`).send({ sampleJobOrderLineSizeId: sizeId, sampleQuantity: quantity });
}

async function completePp(f: Awaited<ReturnType<typeof workflow>>, decision: 'PASS' | 'FAIL') {
  const started = await startPp(f).expect(201);
  const execution = started.body.data;
  const detail = await request(app).get(`/qa/job-orders/${f.job.id}`).set('Authorization', `Bearer ${f.qa.token}`).expect(200);
  const session = detail.body.data.sessions[0];
  const form = session.forms[0];
  const saved = await request(app).put(`/qa/inspections/${session.id}/forms/${form.id}`).set('Authorization', `Bearer ${f.qa.token}`).set('Idempotency-Key', createId()).send({
    expectedVersion: form.version, sampleQuantity: 5, inspectionRemarks: null,
    checklist: checklistCodes.map((itemCode) => ({ itemCode, status: 'YES', remarks: null })),
    inspectedQuantity: 5, acceptedQuantity: 5, reworkQuantity: 0, permanentlyRejectedQuantity: 0,
    defectCategory: null, otherDefectDetails: null, defectNotes: null,
  }).expect(200);
  const savedForm = saved.body.data.sessions[0].forms[0];
  await request(app).post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`).set('Authorization', `Bearer ${f.qa.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: savedForm.version, ppSampleDecision: decision }).expect(200);
  return execution;
}

describe('Process Flow PP Sample bridge and PPM gate', () => {
  it('is unavailable before acknowledgement and creates one locked size form afterward', async () => {
    const f = await workflow();
    await startPp(f).expect(409);
    await prisma.jobOrder.update({ where: { id: f.job.id }, data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED', confirmedAt: new Date() } });
    await startPp(f, 0).expect(400);
    const other = await workflow();
    await startPp(f, 5, other.job.lines[0]!.sizes[0]!.id).expect(400);
    const started = await startPp(f, 5).expect(201);
    expect(started.body.data).toMatchObject({ qualityForm: { versionId: f.sampleForm.versions[0]!.id }, ppSample: { sampleQuantity: 5 } });
    const session = await prisma.qaInspectionSession.findUniqueOrThrow({ where: { qualityActivityExecutionId: started.body.data.id }, include: { forms: true } });
    expect(session.forms).toHaveLength(1);
    expect(session.forms[0]).toMatchObject({ jobOrderLineSizeId: f.job.lines[0]!.sizes[1]!.id, sampleQuantity: 5 });
    await startPp(f, 6).expect(409);
    await request(app).put(`/qa/inspections/${session.id}/forms/${session.forms[0]!.id}`).set('Authorization', `Bearer ${f.qa.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: 1, sampleQuantity: 6, checklist: checklistCodes.map((itemCode) => ({ itemCode, status: null, remarks: null })), inspectedQuantity: 0, acceptedQuantity: 0, reworkQuantity: 0, permanentlyRejectedQuantity: 0 }).expect(409);
  });

  it.each(['PASS', 'FAIL'] as const)('requires an explicit decision and applies %s without inference', async (decision) => {
    const f = await workflow();
    await prisma.jobOrder.update({ where: { id: f.job.id }, data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED' } });
    const started = await startPp(f).expect(201);
    const session = await prisma.qaInspectionSession.findUniqueOrThrow({ where: { qualityActivityExecutionId: started.body.data.id }, include: { forms: { include: { checklist: true } } } });
    const form = session.forms[0]!;
    await prisma.qaSizeInspectionChecklistItem.updateMany({ where: { inspectionFormId: form.id }, data: { status: 'YES' } });
    await prisma.qaSizeInspectionForm.update({ where: { id: form.id }, data: { inspectedQuantity: 5, acceptedQuantity: 5 } });
    await request(app).post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`).set('Authorization', `Bearer ${f.qa.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: form.version }).expect(400);
    await request(app).post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`).set('Authorization', `Bearer ${f.factoryUser.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: form.version, ppSampleDecision: decision }).expect(403);
    await request(app).post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`).set('Authorization', `Bearer ${f.qa.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: form.version, ppSampleDecision: decision }).expect(200);
    const finalizedForm = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } });
    await request(app).post(`/qa/inspections/${session.id}/forms/${form.id}/reopen`).set('Authorization', `Bearer ${f.merchandiser.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: finalizedForm.version, reason: 'Try another PP result' }).expect(409);
    const execution = await prisma.qualityActivityExecution.findUniqueOrThrow({ where: { id: started.body.data.id } });
    expect(execution.outcome).toBe(decision);
    const detail = await request(app).get(`/job-orders/${f.job.id}`).set('Authorization', `Bearer ${f.qa.token}`).expect(200);
    expect(detail.body.data.qualityActivities.find((a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.pp.id).status).toBe(decision === 'PASS' ? 'COMPLETED' : 'FAILED');
    expect(detail.body.data.qualityActivities.find((a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.ppm.id).status).toBe(decision === 'PASS' ? 'AVAILABLE' : 'NOT_AVAILABLE');
  });

  it('PASS unlocks PPM, not Production; PPM finalization unlocks Cutting', async () => {
    const f = await workflow();
    await prisma.jobOrder.update({ where: { id: f.job.id }, data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED' } });
    await completePp(f, 'PASS');
    const cuttingRuntime = f.job.stageStatuses.find((stage) => stage.processFlowVersionStageId === f.cutting.id)!;
    await request(app).post(`/job-orders/${f.job.id}/actions/start-stage`).set('Authorization', `Bearer ${f.factoryUser.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: f.job.version, stageStatusId: cuttingRuntime.id }).expect(409);
    const ppmStarted = await request(app).post(`/job-orders/${f.job.id}/quality-activities/${f.ppm.id}/executions`).set('Authorization', `Bearer ${f.qa.token}`).send({}).expect(201);
    const payload = { expectedVersion: ppmStarted.body.data.version, checklistResponses: [], aqlResults: [], defects: [], correctiveActions: [], testResults: [], quantities: [], comments: [], fieldResponses: [{ componentId: f.fieldId, fieldKey: 'meetingDate', value: '2026-08-18' }], attendees: [{ componentId: f.attendeeId, roleKey: 'QA', attendeeName: 'Inspector One' }], actions: [{ componentId: f.actionId, values: { action: 'Confirm trims', settleDate: '2026-08-19' } }], signoffs: [], outcome: null };
    await request(app).put(`/quality-executions/${ppmStarted.body.data.id}`).set('Authorization', `Bearer ${f.qa.token}`).send({ ...payload, attendees: [{ componentId: f.attendeeId, roleKey: 'Unknown', attendeeName: 'Invalid' }] }).expect(400);
    await request(app).post(`/quality-executions/${ppmStarted.body.data.id}/finalize`).set('Authorization', `Bearer ${f.qa.token}`).send(payload).expect(200);
    expect(await prisma.qualityAttendeeResponse.count({ where: { executionId: ppmStarted.body.data.id } })).toBe(1);
    expect(await prisma.qualityActionResponse.count({ where: { executionId: ppmStarted.body.data.id } })).toBe(1);
    await request(app).post(`/job-orders/${f.job.id}/actions/start-stage`).set('Authorization', `Bearer ${f.factoryUser.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: f.job.version, stageStatusId: cuttingRuntime.id }).expect(200);
  });

  it('leaves legacy ERVE-015 multi-size session creation unchanged', async () => {
    const f = await workflow();
    await prisma.jobOrder.update({ where: { id: f.job.id }, data: { status: 'READY_FOR_QA', preparedQuantityTotal: 20 } });
    await prisma.jobOrderLineSize.updateMany({ where: { jobOrderLine: { jobOrderId: f.job.id } }, data: { preparedQuantity: 10 } });
    const result = await request(app).post(`/qa/job-orders/${f.job.id}/inspections`).set('Authorization', `Bearer ${f.qa.token}`).set('Idempotency-Key', createId()).send({ expectedVersion: f.job.version, sourceReworkTaskIds: [] }).expect(201);
    expect(result.body.data.sessions[0].forms).toHaveLength(2);
    expect(result.body.data.sessions[0].processFlowPpSample).toBeNull();
  });
});
