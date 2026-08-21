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
  'FABRIC_COLOUR_QUALITY',
  'TRIMS_CARD',
  'FABRIC_GSM',
  'MEASUREMENTS_REPORT',
  'GARMENT_CONSTRUCTION',
  'GENERAL_QUALITY_PRESENTATION',
  'LABELLING_POSITION',
  'FIT_SAMPLE_BUYER_COMMENTS',
  'SPI',
  'SAMPLE_TAG',
  'DATA_SHEET_PULL_TEST_PINCH_SETTING',
  'METAL_DETECTION',
  'P_AND_P',
  'PP_SAMPLE_FIT_COMMENTS',
  'SOURCE_DECLARATION_FORM',
] as const;

async function workflow() {
  const qa = await createTestUserAndToken({
    email: `qa-${createId()}@test.local`,
    password: 'pass',
    roles: ['QA_USER'],
  });
  const merchandiser = await createTestUserAndToken({
    email: `merch-${createId()}@test.local`,
    password: 'pass',
    roles: ['MERCHANDISER'],
  });
  const factoryUser = await createTestUserAndToken({
    email: `factory-${createId()}@test.local`,
    password: 'pass',
    roles: ['FACTORY_USER'],
  });
  const factory = await createTestFactory();
  await prisma.userFactory.create({
    data: { id: createId(), userId: factoryUser.userId, factoryId: factory.id },
  });
  const distributor = await createTestDistributor();
  const style = await prisma.style.create({
    data: { id: createId(), styleNumber: `PP-${createId()}`, styleName: 'PP style', finalMrp: 100 },
  });
  const sizes = await Promise.all(
    ['S', 'M'].map((label, index) =>
      prisma.size.create({
        data: {
          id: createId(),
          code: `${label}-${createId()}`,
          label,
          sizeType: 'ALPHA',
          sortOrder: index + 1,
        },
      }),
    ),
  );
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
          sizes: {
            create: sizes.map((size) => ({ id: createId(), sizeId: size.id, orderedQuantity: 10 })),
          },
        },
      },
    },
    include: { lines: { include: { sizes: true } } },
  });
  const sampleForm = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `SAMPLE_${createId()}`,
      name: 'Sample',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          activityType: 'INSPECTION',
          executionScope: 'SIZE',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      },
    },
    include: { versions: true },
  });
  const fieldId = createId();
  const attendeeId = createId();
  const actionId = createId();
  const ppmForm = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `PPM_${createId()}`,
      name: 'PPM',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          activityType: 'MEETING',
          executionScope: 'JOB_ORDER',
          status: 'PUBLISHED',
          publishedAt: new Date(),
          sections: {
            create: {
              id: createId(),
              sequence: 1,
              title: 'Meeting',
              components: {
                create: [
                  {
                    id: fieldId,
                    sequence: 1,
                    type: 'FIELD_GROUP',
                    title: 'Meeting details',
                    config: {
                      fields: [
                        {
                          key: 'meetingDate',
                          label: 'Meeting Date',
                          dataType: 'DATE',
                          source: 'USER',
                          required: true,
                        },
                      ],
                    },
                  },
                  {
                    id: attendeeId,
                    sequence: 2,
                    type: 'ATTENDEE_LIST',
                    title: 'Attendees',
                    config: { roles: ['QA'], allowOther: false },
                  },
                  {
                    id: actionId,
                    sequence: 3,
                    type: 'ACTION_LIST',
                    title: 'Actions',
                    config: {
                      columns: [
                        { key: 'action', label: 'Action', dataType: 'TEXT', required: true },
                        { key: 'settleDate', label: 'Settle Date', dataType: 'DATE' },
                      ],
                    },
                  },
                ],
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
      code: `FLOW-${createId()}`,
      name: 'Confirmed workflow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const versionId = flow.versions[0]!.id;
  const inlineOutcomeId = createId();
  const finalOutcomeId = createId();
  const inlineForm = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `INLINE_${createId()}`,
      name: 'Inline',
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
              title: 'Outcome',
              components: {
                create: {
                  id: inlineOutcomeId,
                  sequence: 1,
                  type: 'INSPECTION_OUTCOME',
                  title: 'Outcome',
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
  const finalForm = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `FINAL_${createId()}`,
      name: 'Final',
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
              title: 'Outcome',
              components: {
                create: {
                  id: finalOutcomeId,
                  sequence: 1,
                  type: 'INSPECTION_OUTCOME',
                  title: 'Outcome',
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
  const pp = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 1,
      name: 'PP Sample Checklist',
      activityType: 'QUALITY',
      qualityFormVersionId: sampleForm.versions[0]!.id,
      qualityExecutionMode: 'SEQUENTIAL_GATE',
      gateSatisfactionRequirement: 'OUTCOME_PASS',
      executionMultiplicity: 'SINGLE',
    },
  });
  const ppm = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 2,
      name: 'Size Set / Pre-Production',
      activityType: 'QUALITY',
      qualityFormVersionId: ppmForm.versions[0]!.id,
      qualityExecutionMode: 'SEQUENTIAL_GATE',
      gateSatisfactionRequirement: 'FINALIZED',
      executionMultiplicity: 'SINGLE',
    },
  });
  const cutting = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 3,
      name: 'Cutting',
      code: 'CUTTING',
    },
  });
  const printing = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 4,
      name: 'Printing',
      code: 'PRINTING',
    },
  });
  const sewing = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 5,
      name: 'Sewing',
      code: 'SEWING',
    },
  });
  const inline = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 6,
      name: 'Inline Inspection',
      activityType: 'QUALITY',
      qualityFormVersionId: inlineForm.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: sewing.id,
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'SINGLE',
    },
  });
  const finishing = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 7,
      name: 'Finishing',
      code: 'FINISHING',
    },
  });
  const final = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: versionId,
      sequence: 8,
      name: 'Final Inspection',
      activityType: 'QUALITY',
      qualityFormVersionId: finalForm.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: sewing.id,
      qualityAvailabilityPolicy: 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    },
  });
  const lineId = createId();
  const job = await prisma.jobOrder.create({
    data: {
      id: createId(),
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: po.id,
      factoryId: factory.id,
      processFlowVersionId: versionId,
      unitPrice: 10,
      status: 'SENT_TO_FACTORY',
      disclaimerText: 'Terms',
      disclaimerRevision: 1,
      createdBy: qa.userId,
      lines: {
        create: {
          id: lineId,
          purchaseOrderLineId: po.lines[0]!.id,
          styleId: style.id,
          orderedQuantityTotal: 20,
          sizes: {
            create: po.lines[0]!.sizes.map((size) => ({
              id: createId(),
              purchaseOrderLineSizeId: size.id,
              sizeId: size.sizeId,
              orderedQuantity: 10,
            })),
          },
        },
      },
      stageStatuses: {
        create: [cutting, printing, sewing, finishing].map((stage) => ({
          id: createId(),
          processFlowVersionStageId: stage.id,
          stageSequence: stage.sequence,
          stageNameSnapshot: stage.name,
          completedQuantity: 0,
        })),
      },
    },
    include: { lines: { include: { sizes: true } }, stageStatuses: true },
  });
  return {
    qa,
    merchandiser,
    factoryUser,
    job,
    pp,
    ppm,
    cutting,
    printing,
    sewing,
    inline,
    finishing,
    final,
    sampleForm,
    ppmForm,
    inlineOutcomeId,
    finalOutcomeId,
    fieldId,
    attendeeId,
    actionId,
  };
}

function startPp(
  f: Awaited<ReturnType<typeof workflow>>,
  quantity = 5,
  sizeId = f.job.lines[0]!.sizes[1]!.id,
) {
  return request(app)
    .post(`/job-orders/${f.job.id}/quality-activities/${f.pp.id}/executions`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .send({ sampleJobOrderLineSizeId: sizeId, sampleQuantity: quantity });
}

async function completePp(f: Awaited<ReturnType<typeof workflow>>, decision: 'PASS' | 'FAIL') {
  const started = await startPp(f).expect(201);
  const execution = started.body.data;
  await finalizeStartedPp(f, execution.id, decision);
  return execution;
}

async function finalizeStartedPp(
  f: Awaited<ReturnType<typeof workflow>>,
  executionId: string,
  decision: 'PASS' | 'FAIL',
) {
  const session = await prisma.qaInspectionSession.findUniqueOrThrow({
    where: { qualityActivityExecutionId: executionId },
    include: { forms: true },
  });
  const form = session.forms[0]!;
  const quantity = form.sampleQuantity!;
  await request(app)
    .put(`/qa/inspections/${session.id}/forms/${form.id}`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .set('Idempotency-Key', createId())
    .send({
      expectedVersion: form.version,
      sampleQuantity: quantity,
      inspectionRemarks: null,
      checklist: checklistCodes.map((itemCode) => ({ itemCode, status: 'YES', remarks: null })),
      defectCategory: null,
      otherDefectDetails: null,
      defectNotes: null,
    })
    .expect(200);
  const savedForm = await prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } });
  await request(app)
    .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
    .set('Authorization', `Bearer ${f.qa.token}`)
    .set('Idempotency-Key', createId())
    .send({ expectedVersion: savedForm.version, ppSampleDecision: decision })
    .expect(200);
}

describe('Process Flow PP Sample bridge and PPM gate', () => {
  it('is unavailable before acknowledgement and creates one locked size form afterward', async () => {
    const f = await workflow();
    await startPp(f).expect(409);
    await prisma.jobOrder.update({
      where: { id: f.job.id },
      data: {
        status: 'CONFIRMED_BY_FACTORY',
        factoryConfirmationStatus: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    });
    await startPp(f, 0).expect(400);
    const other = await workflow();
    await startPp(f, 5, other.job.lines[0]!.sizes[0]!.id).expect(400);
    const started = await startPp(f, 5).expect(201);
    expect(started.body.data).toMatchObject({
      qualityForm: { versionId: f.sampleForm.versions[0]!.id },
      ppSample: { sampleQuantity: 5 },
    });
    const session = await prisma.qaInspectionSession.findUniqueOrThrow({
      where: { qualityActivityExecutionId: started.body.data.id },
      include: { forms: true },
    });
    expect(session.forms).toHaveLength(1);
    expect(session.forms[0]).toMatchObject({
      jobOrderLineSizeId: f.job.lines[0]!.sizes[1]!.id,
      sampleQuantity: 5,
    });
    await startPp(f, 6).expect(409);
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${session.forms[0]!.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: 1,
        sampleQuantity: 5,
        checklist: checklistCodes.map((itemCode) => ({ itemCode, status: null, remarks: null })),
        inspectedQuantity: 0,
        acceptedQuantity: 0,
        reworkQuantity: 0,
        permanentlyRejectedQuantity: 0,
      })
      .expect(400);
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${session.forms[0]!.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: 1,
        sampleQuantity: 6,
        checklist: checklistCodes.map((itemCode) => ({ itemCode, status: null, remarks: null })),
      })
      .expect(409);
    await request(app)
      .put(`/qa/inspections/${session.id}/forms/${session.forms[0]!.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: 1,
        sampleQuantity: 5,
        checklist: checklistCodes.map((itemCode) => ({
          itemCode,
          status: 'AVAILABLE',
          remarks: null,
        })),
      })
      .expect(400);
  });

  it.each(['PASS', 'FAIL'] as const)(
    'requires an explicit decision and applies %s without inference',
    async (decision) => {
      const f = await workflow();
      await prisma.jobOrder.update({
        where: { id: f.job.id },
        data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED' },
      });
      const started = await startPp(f).expect(201);
      const session = await prisma.qaInspectionSession.findUniqueOrThrow({
        where: { qualityActivityExecutionId: started.body.data.id },
        include: { forms: { include: { checklist: true } } },
      });
      const form = session.forms[0]!;
      await prisma.qaSizeInspectionChecklistItem.updateMany({
        where: { inspectionFormId: form.id },
        data: { status: 'AVAILABLE' },
      });
      const invalidChecklist = await request(app)
        .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: form.version, ppSampleDecision: decision })
        .expect(400);
      expect(invalidChecklist.body.error.details.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'checklist',
            message: 'Every PP Sample checklist response must be Yes or No.',
          }),
        ]),
      );
      await prisma.qaSizeInspectionChecklistItem.updateMany({
        where: { inspectionFormId: form.id },
        // Checklist marks are observations. They never determine the explicit decision.
        data: { status: decision === 'PASS' ? 'NO' : 'YES' },
      });
      await request(app)
        .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: form.version })
        .expect(400);
      await request(app)
        .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
        .set('Authorization', `Bearer ${f.factoryUser.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: form.version, ppSampleDecision: decision })
        .expect(403);
      await request(app)
        .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: form.version, ppSampleDecision: decision })
        .expect(200);
      const finalizedForm = await prisma.qaSizeInspectionForm.findUniqueOrThrow({
        where: { id: form.id },
      });
      expect(finalizedForm).toMatchObject({
        inspectedQuantity: 0,
        acceptedQuantity: 0,
        reworkQuantity: 0,
        permanentlyRejectedQuantity: 0,
      });
      await request(app)
        .post(`/qa/inspections/${session.id}/forms/${form.id}/reopen`)
        .set('Authorization', `Bearer ${f.merchandiser.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: finalizedForm.version, reason: 'Try another PP result' })
        .expect(409);
      const execution = await prisma.qualityActivityExecution.findUniqueOrThrow({
        where: { id: started.body.data.id },
      });
      expect(execution.outcome).toBe(decision);
      const detail = await request(app)
        .get(`/job-orders/${f.job.id}`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .expect(200);
      expect(
        detail.body.data.qualityActivities.find(
          (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.pp.id,
        ).status,
      ).toBe(decision === 'PASS' ? 'COMPLETED' : 'FAILED');
      expect(
        detail.body.data.qualityActivities.find(
          (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.ppm.id,
        ).status,
      ).toBe(decision === 'PASS' ? 'AVAILABLE' : 'NOT_AVAILABLE');
    },
  );

  it('ignores legacy disposition values when finalizing a linked PP Sample', async () => {
    const f = await workflow();
    await prisma.jobOrder.update({
      where: { id: f.job.id },
      data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED' },
    });
    const started = await startPp(f).expect(201);
    const session = await prisma.qaInspectionSession.findUniqueOrThrow({
      where: { qualityActivityExecutionId: started.body.data.id },
      include: { forms: true },
    });
    const form = session.forms[0]!;
    await prisma.qaSizeInspectionChecklistItem.updateMany({
      where: { inspectionFormId: form.id },
      data: { status: 'YES' },
    });
    await prisma.qaSizeInspectionForm.update({
      where: { id: form.id },
      data: {
        inspectedQuantity: 5,
        permanentlyRejectedQuantity: 5,
        defectCategory: null,
      },
    });

    await request(app)
      .post(`/qa/inspections/${session.id}/forms/${form.id}/finalize`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: form.version, ppSampleDecision: 'PASS' })
      .expect(200);

    await expect(prisma.qaReworkTask.count({ where: { jobOrderId: f.job.id } })).resolves.toBe(0);
    await expect(
      prisma.qaEvidence.count({ where: { inspectionSessionId: session.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.qaSizeInspectionForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({
      inspectedQuantity: 0,
      acceptedQuantity: 0,
      reworkQuantity: 0,
      permanentlyRejectedQuantity: 0,
    });
  });

  it('PASS unlocks PPM, not Production; PPM finalization unlocks Cutting', async () => {
    const f = await workflow();
    await prisma.jobOrder.update({
      where: { id: f.job.id },
      data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED' },
    });
    await completePp(f, 'PASS');
    const cuttingRuntime = f.job.stageStatuses.find(
      (stage) => stage.processFlowVersionStageId === f.cutting.id,
    )!;
    await request(app)
      .post(`/job-orders/${f.job.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: f.job.version, stageStatusId: cuttingRuntime.id })
      .expect(409);
    const ppmStarted = await request(app)
      .post(`/job-orders/${f.job.id}/quality-activities/${f.ppm.id}/executions`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({})
      .expect(201);
    const payload = {
      expectedVersion: ppmStarted.body.data.version,
      checklistResponses: [],
      aqlResults: [],
      defects: [],
      correctiveActions: [],
      testResults: [],
      quantities: [],
      comments: [],
      fieldResponses: [{ componentId: f.fieldId, fieldKey: 'meetingDate', value: '2026-08-18' }],
      attendees: [{ componentId: f.attendeeId, roleKey: 'QA', attendeeName: 'Inspector One' }],
      actions: [
        { componentId: f.actionId, values: { action: 'Confirm trims', settleDate: '2026-08-19' } },
      ],
      signoffs: [],
      outcome: null,
    };
    await request(app)
      .put(`/quality-executions/${ppmStarted.body.data.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({
        ...payload,
        attendees: [{ componentId: f.attendeeId, roleKey: 'Unknown', attendeeName: 'Invalid' }],
      })
      .expect(400);
    await request(app)
      .post(`/quality-executions/${ppmStarted.body.data.id}/finalize`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(payload)
      .expect(200);
    expect(
      await prisma.qualityAttendeeResponse.count({
        where: { executionId: ppmStarted.body.data.id },
      }),
    ).toBe(1);
    expect(
      await prisma.qualityActionResponse.count({ where: { executionId: ppmStarted.body.data.id } }),
    ).toBe(1);
    await request(app)
      .post(`/job-orders/${f.job.id}/actions/start-stage`)
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: f.job.version, stageStatusId: cuttingRuntime.id })
      .expect(200);
  });

  it('preserves FAIL history, serializes retry start, and satisfies the gate with a later PASS', async () => {
    const f = await workflow();
    await prisma.jobOrder.update({
      where: { id: f.job.id },
      data: { status: 'CONFIRMED_BY_FACTORY', factoryConfirmationStatus: 'CONFIRMED' },
    });
    const first = await completePp(f, 'FAIL');
    const afterFail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(
      afterFail.body.data.qualityActivities.find(
        (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.ppm.id,
      ).status,
    ).toBe('NOT_AVAILABLE');

    const [retryA, retryB] = await Promise.all([startPp(f), startPp(f)]);
    expect([retryA.status, retryB.status]).toEqual([201, 201]);
    expect(retryA.body.data.id).toBe(retryB.body.data.id);
    expect(
      await prisma.qualityActivityExecution.count({
        where: { jobOrderId: f.job.id, processFlowActivityId: f.pp.id, status: 'DRAFT' },
      }),
    ).toBe(1);
    expect(retryA.body.data.attemptNumber).toBe(2);

    await finalizeStartedPp(f, retryA.body.data.id, 'PASS');
    const cycles = await prisma.qualityActivityExecution.findMany({
      where: { jobOrderId: f.job.id, processFlowActivityId: f.pp.id },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(
      cycles.map((cycle) => ({
        attempt: cycle.attemptNumber,
        batch: cycle.batchNumber,
        outcome: cycle.outcome,
        status: cycle.status,
      })),
    ).toEqual([
      { attempt: 1, batch: 1, outcome: 'FAIL', status: 'FINALIZED' },
      { attempt: 2, batch: 1, outcome: 'PASS', status: 'FINALIZED' },
    ]);
    expect(cycles[0]!.id).toBe(first.id);
    const afterPass = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    const ppView = afterPass.body.data.qualityActivities.find(
      (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.pp.id,
    );
    expect(ppView.status).toBe('COMPLETED');
    expect(
      ppView.executionHistory.map((cycle: { attemptNumber: number; outcome: string }) => [
        cycle.attemptNumber,
        cycle.outcome,
      ]),
    ).toEqual([
      [2, 'PASS'],
      [1, 'FAIL'],
    ]);
    expect(
      afterPass.body.data.qualityActivities.find(
        (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.ppm.id,
      ).status,
    ).toBe('AVAILABLE');
    await startPp(f).expect(409);
  });

  it('leaves legacy ERVE-015 multi-size session creation unchanged', async () => {
    const f = await workflow();
    await prisma.jobOrder.update({
      where: { id: f.job.id },
      data: { status: 'READY_FOR_QA', preparedQuantityTotal: 20 },
    });
    await prisma.jobOrderLineSize.updateMany({
      where: { jobOrderLine: { jobOrderId: f.job.id } },
      data: { preparedQuantity: 10 },
    });
    const result = await request(app)
      .post(`/qa/job-orders/${f.job.id}/inspections`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .set('Idempotency-Key', createId())
      .send({ expectedVersion: f.job.version, sourceReworkTaskIds: [] })
      .expect(201);
    expect(result.body.data.sessions[0].forms).toHaveLength(2);
    expect(result.body.data.sessions[0].processFlowPpSample).toBeNull();
  });

  it('runs the confirmed Quality + Production flow end to end without fabricating side effects', async () => {
    const f = await workflow();
    const confirmed = await request(app)
      .post(`/job-orders/${f.job.id}/actions/confirm`)
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: f.job.version,
        expectedDisclaimerRevision: 1,
        acknowledgeDisclaimer: true,
      })
      .expect(200);
    expect(
      confirmed.body.data.qualityActivities.find(
        (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.pp.id,
      ).status,
    ).toBe('AVAILABLE');
    expect(confirmed.body.data).toMatchObject({
      status: 'CONFIRMED_BY_FACTORY',
      operationalState: {
        lifecycleContext: { code: 'CONFIRMED_BY_FACTORY' },
        productionState: { label: 'Production Locked' },
        qualityState: { label: `${f.pp.name} Pending` },
        primaryDisplayState: { label: `${f.pp.name} Pending` },
      },
    });
    const qualityWork = await request(app)
      .get('/job-orders/quality-work')
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(
      qualityWork.body.data.some(
        (item: { jobOrderId: string; activity: { processFlowVersionStageId: string } }) =>
          item.jobOrderId === f.job.id && item.activity.processFlowVersionStageId === f.pp.id,
      ),
    ).toBe(true);
    await request(app)
      .get('/job-orders/quality-work')
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .expect(403);

    await completePp(f, 'FAIL');
    const afterPpFail = (
      await request(app).get(`/job-orders/${f.job.id}`).set('Authorization', `Bearer ${f.qa.token}`)
    ).body.data;
    expect(
      afterPpFail.qualityActivities.find(
        (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.ppm.id,
      ).status,
    ).toBe('NOT_AVAILABLE');
    expect(afterPpFail.operationalState.primaryDisplayState.label).toBe(`${f.pp.name} Failed`);
    await completePp(f, 'PASS');

    const ppmStarted = (
      await request(app)
        .post(`/job-orders/${f.job.id}/quality-activities/${f.ppm.id}/executions`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send({})
        .expect(201)
    ).body.data;
    const ppmPayload = {
      expectedVersion: ppmStarted.version,
      checklistResponses: [],
      aqlResults: [],
      defects: [],
      correctiveActions: [],
      testResults: [],
      quantities: [],
      comments: [],
      fieldResponses: [{ componentId: f.fieldId, fieldKey: 'meetingDate', value: '2026-08-20' }],
      attendees: [{ componentId: f.attendeeId, roleKey: 'QA', attendeeName: 'QA One' }],
      actions: [
        { componentId: f.actionId, values: { action: 'Release bulk', settleDate: '2026-08-20' } },
      ],
      signoffs: [],
      outcome: null,
    };
    await request(app)
      .put(`/quality-executions/${ppmStarted.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(ppmPayload)
      .expect(200);
    await request(app)
      .post(`/quality-executions/${ppmStarted.id}/finalize`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({ ...ppmPayload, expectedVersion: ppmStarted.version + 1 })
      .expect(200);

    let current = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .expect(200);
    expect(current.body.data).toMatchObject({
      status: 'CONFIRMED_BY_FACTORY',
      operationalState: {
        productionState: { label: 'Cutting Ready' },
        qualityState: { label: `${f.ppm.name} Completed` },
        primaryDisplayState: { label: 'Cutting Ready' },
      },
    });
    const runStage = async (definitionId: string, complete = true) => {
      const runtime = current.body.data.stages.find(
        (stage: { processFlowVersionStageId: string }) =>
          stage.processFlowVersionStageId === definitionId,
      );
      current = await request(app)
        .post(`/job-orders/${f.job.id}/actions/start-stage`)
        .set('Authorization', `Bearer ${f.factoryUser.token}`)
        .set('Idempotency-Key', createId())
        .send({ expectedVersion: current.body.data.version, stageStatusId: runtime.id })
        .expect(200);
      if (complete)
        current = await request(app)
          .post(`/job-orders/${f.job.id}/actions/complete-stage`)
          .set('Authorization', `Bearer ${f.factoryUser.token}`)
          .set('Idempotency-Key', createId())
          .send({ expectedVersion: current.body.data.version, stageStatusId: runtime.id })
          .expect(200);
    };
    await runStage(f.cutting.id);
    await runStage(f.printing.id);
    await runStage(f.sewing.id, false);
    expect(
      current.body.data.qualityActivities.find(
        (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.inline.id,
      ).status,
    ).toBe('AVAILABLE');
    expect(current.body.data.operationalState).toMatchObject({
      productionState: { label: 'Sewing In Progress' },
      qualityState: { label: 'Inline Inspection Pending' },
      primaryDisplayState: { label: 'Sewing In Progress' },
    });
    const inlineStarted = (
      await request(app)
        .post(`/job-orders/${f.job.id}/quality-activities/${f.inline.id}/executions`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send({})
        .expect(201)
    ).body.data;
    await runStage(f.sewing.id);
    expect(
      current.body.data.qualityActivities.find(
        (a: { processFlowVersionStageId: string }) => a.processFlowVersionStageId === f.final.id,
      ).status,
    ).toBe('AVAILABLE');
    expect(current.body.data.operationalState).toMatchObject({
      productionState: { label: 'Finishing Pending' },
      qualityState: { label: 'Final Inspection Pending' },
      primaryDisplayState: { label: 'Finishing Pending' },
    });
    const inlineReplay = await request(app)
      .post(`/job-orders/${f.job.id}/quality-activities/${f.inline.id}/executions`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send({})
      .expect(201);
    expect(inlineReplay.body.data.id).toBe(inlineStarted.id);
    expect(
      await prisma.qualityActivityExecution.count({
        where: { jobOrderId: f.job.id, processFlowActivityId: f.inline.id },
      }),
    ).toBe(1);
    const qualityPayload = (version: number, componentId: string, outcome: 'PASS' | 'FAIL') => ({
      expectedVersion: version,
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
      outcome: { componentId, value: outcome },
    });
    await request(app)
      .post(`/quality-executions/${inlineStarted.id}/finalize`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(qualityPayload(inlineStarted.version, f.inlineOutcomeId, 'FAIL'))
      .expect(200);
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe(
      'IN_PRODUCTION',
    );

    const firstFinal = (
      await request(app)
        .post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send({ inspectedQuantity: 5 })
        .expect(201)
    ).body.data;
    const firstSaved = await request(app)
      .put(`/quality-executions/${firstFinal.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(qualityPayload(firstFinal.version, f.finalOutcomeId, 'PASS'))
      .expect(200);
    await request(app)
      .post(`/quality-executions/${firstFinal.id}/finalize`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(qualityPayload(firstSaved.body.data.version, f.finalOutcomeId, 'PASS'))
      .expect(409);

    await runStage(f.finishing.id);
    current = await request(app)
      .post(`/job-orders/${f.job.id}/actions/update-prepared-quantity`)
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .set('Idempotency-Key', createId())
      .send({
        expectedVersion: current.body.data.version,
        sizes: f.job.lines[0]!.sizes.map((size) => ({
          jobOrderLineSizeId: size.id,
          preparedQuantity: 10,
        })),
      })
      .expect(200);
    expect(current.body.data.status).toBe('PRODUCTION_COMPLETE');
    let finalized = await request(app)
      .post(`/quality-executions/${firstFinal.id}/finalize`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .send(qualityPayload(firstSaved.body.data.version, f.finalOutcomeId, 'PASS'))
      .expect(200);
    for (const [quantity, outcome] of [
      [5, 'FAIL'],
      [10, 'PASS'],
    ] as const) {
      const batch = (
        await request(app)
          .post(`/job-orders/${f.job.id}/quality-activities/${f.final.id}/executions`)
          .set('Authorization', `Bearer ${f.qa.token}`)
          .send({ inspectedQuantity: quantity })
          .expect(201)
      ).body.data;
      finalized = await request(app)
        .post(`/quality-executions/${batch.id}/finalize`)
        .set('Authorization', `Bearer ${f.qa.token}`)
        .send(qualityPayload(batch.version, f.finalOutcomeId, outcome))
        .expect(200);
    }
    expect(finalized.body.data.coverage).toMatchObject({
      state: 'COMPLETE',
      inspectedQuantity: 20,
      remainingQuantity: 0,
      passedBatches: 2,
      failedBatches: 1,
      hasFailedBatches: true,
    });
    const completedDetail = await request(app)
      .get(`/job-orders/${f.job.id}`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    expect(completedDetail.body.data).toMatchObject({
      status: 'PRODUCTION_COMPLETE',
      operationalState: {
        productionState: { label: 'Production Completed' },
        qualityState: { label: 'Final Inspection Completed' },
        primaryDisplayState: { label: 'Workflow Completed' },
      },
    });
    expect(await prisma.qaReworkTask.count({ where: { jobOrderId: f.job.id } })).toBe(0);
    expect((await prisma.jobOrder.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe(
      'PRODUCTION_COMPLETE',
    );

    await prisma.auditLog.create({
      data: {
        id: createId(),
        actorId: f.qa.userId,
        action: 'QUALITY_ACTIVITY_ATTACHMENT_ADDED',
        entityType: 'QualityActivityExecution',
        entityId: firstFinal.id,
        metadata: { attachmentId: createId(), requirementKey: 'measurement_sheet' },
      },
    });

    const audit = await request(app)
      .get(`/job-orders/${f.job.id}/audit`)
      .set('Authorization', `Bearer ${f.qa.token}`)
      .expect(200);
    const history = audit.body.data as Array<{
      id: string;
      action: string;
      createdAt: string;
      metadata: Record<string, unknown>;
      entityType?: string;
      entityId?: string;
    }>;
    const expectedOrder = [...history].sort((left, right) => {
      const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return byTime || left.id.localeCompare(right.id);
    });
    expect(history.map(({ id }) => id)).toEqual(expectedOrder.map(({ id }) => id));
    expect(history.some(({ action }) => action === 'JOB_ORDER_FACTORY_CONFIRMED')).toBe(true);
    expect(history.some(({ action }) => action === 'JOB_ORDER_STAGE_COMPLETED')).toBe(true);
    expect(
      history
        .filter(({ action }) => action === 'PP_SAMPLE_FINALIZED')
        .map(({ metadata }) => [metadata.cycleNumber, metadata.decision]),
    ).toEqual([
      [1, 'FAIL'],
      [2, 'PASS'],
    ]);
    expect(
      history.some(
        ({ action, metadata }) =>
          action === 'QUALITY_ACTIVITY_FINALIZED' &&
          metadata.activityName === 'Size Set / Pre-Production',
      ),
    ).toBe(true);
    expect(
      history.some(
        ({ action, metadata }) =>
          action === 'QUALITY_ACTIVITY_FINALIZED' &&
          metadata.activityName === 'Inline Inspection' &&
          metadata.outcome === 'FAIL',
      ),
    ).toBe(true);
    expect(
      history
        .filter(({ action }) => action === 'FINAL_INSPECTION_BATCH_FINALIZED')
        .map(({ metadata }) => [
          metadata.batchNumber,
          metadata.inspectedQuantity,
          metadata.outcome,
        ]),
    ).toEqual([
      [1, 5, 'PASS'],
      [2, 5, 'FAIL'],
      [3, 10, 'PASS'],
    ]);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'QUALITY_ACTIVITY_ATTACHMENT_ADDED',
          metadata: expect.objectContaining({
            activityName: 'Final Inspection',
            batchNumber: 1,
            requirementKey: 'measurement_sheet',
          }),
        }),
      ]),
    );
    expect(history.every(({ entityType, entityId }) => !entityType && !entityId)).toBe(true);

    await request(app)
      .get(`/job-orders/${f.job.id}/audit`)
      .set('Authorization', `Bearer ${f.merchandiser.token}`)
      .expect(200);
    await request(app)
      .get(`/job-orders/${f.job.id}/audit`)
      .set('Authorization', `Bearer ${f.factoryUser.token}`)
      .expect(200);

    const wrongFactoryUser = await createTestUserAndToken({
      email: `wrong-factory-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    const wrongFactory = await createTestFactory();
    await prisma.userFactory.create({
      data: { id: createId(), userId: wrongFactoryUser.userId, factoryId: wrongFactory.id },
    });
    await request(app)
      .get(`/job-orders/${f.job.id}/audit`)
      .set('Authorization', `Bearer ${wrongFactoryUser.token}`)
      .expect(403);

    const distributorUser = await createTestUserAndToken({
      email: `distributor-${createId()}@test.local`,
      password: 'pass',
      roles: ['DISTRIBUTOR'],
    });
    await request(app)
      .get(`/job-orders/${f.job.id}/audit`)
      .set('Authorization', `Bearer ${distributorUser.token}`)
      .expect(403);
  }, 30_000);
});
