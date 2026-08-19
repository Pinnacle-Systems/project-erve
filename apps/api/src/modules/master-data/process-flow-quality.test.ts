import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(async () => prisma.$disconnect());

async function manager(role: 'ADMIN' | 'MERCHANDISER' = 'ADMIN') {
  return createTestUserAndToken({
    email: `${role}-${createId()}@test.local`,
    password: 'password',
    roles: [role],
  });
}

async function qualityVersion(
  code: string,
  versionNumber = 1,
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED' = 'PUBLISHED',
) {
  const form = await prisma.qualityForm.upsert({
    where: { code },
    update: {},
    create: { id: createId(), code, name: `${code} Report` },
  });
  return prisma.qualityFormVersion.create({
    data: {
      id: createId(),
      qualityFormId: form.id,
      versionNumber,
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
      status,
      publishedAt: status === 'DRAFT' ? null : new Date(),
    },
  });
}

const production = (key: string, name: string) => ({
  activityKey: key,
  activityType: 'PRODUCTION',
  name,
});
const sequential = (key: string, formVersionId: string) => ({
  activityKey: key,
  activityType: 'QUALITY',
  name: 'Quality Gate',
  qualityFormVersionId: formVersionId,
  qualityExecutionMode: 'SEQUENTIAL_GATE',
});
const inProcess = (
  key: string,
  formVersionId: string,
  productionKey: string,
  policy:
    | 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
    | 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES'
    | 'PROGRESS_PERCENTAGE',
  threshold?: number,
) => ({
  activityKey: key,
  activityType: 'QUALITY',
  name: key === 'inline' ? 'Inline Inspection' : 'Final Inspection',
  qualityFormVersionId: formVersionId,
  qualityExecutionMode: 'IN_PROCESS',
  associatedProductionActivityKey: productionKey,
  qualityAvailabilityPolicy: policy,
  ...(threshold === undefined ? {} : { progressThresholdPercent: threshold }),
});

function createFlow(token: string, stages: object[], suffix = createId().slice(-6)) {
  return request(app)
    .post('/process-flows')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: `PF-${suffix}`, name: `Flow ${suffix}`, stages });
}

describe('Process Flow Quality activities', () => {
  it('keeps existing production-only flows ordered and explicitly typed', async () => {
    const { token } = await manager('MERCHANDISER');
    const created = await createFlow(token, [
      { name: 'Cutting' },
      { name: 'Printing' },
      { name: 'Sewing' },
    ]).expect(201);
    const detail = await request(app)
      .get(`/process-flow-versions/${created.body.data.versions[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      detail.body.data.stages.map(
        (activity: { sequence: number; name: string; activityType: string }) => [
          activity.sequence,
          activity.name,
          activity.activityType,
        ],
      ),
    ).toEqual([
      [1, 'Cutting', 'PRODUCTION'],
      [2, 'Printing', 'PRODUCTION'],
      [3, 'Sewing', 'PRODUCTION'],
    ]);
    const flows = await request(app)
      .get('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(flows.body.data[0].versions[0].hasQualityActivities).toBe(false);
  });

  it('creates sequential and both confirmed in-process Quality patterns', async () => {
    const { token } = await manager();
    const gateForm = await qualityVersion('GATE');
    const inlineForm = await qualityVersion('INLINE');
    const finalForm = await qualityVersion('FINAL');
    const response = await createFlow(token, [
      production('cutting', 'Cutting'),
      sequential('gate', gateForm.id),
      production('sewing', 'Sewing'),
      inProcess('inline', inlineForm.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
      production('finishing', 'Finishing'),
      inProcess('final', finalForm.id, 'finishing', 'PROGRESS_PERCENTAGE', 50),
    ]).expect(201);
    const detail = await request(app)
      .get(`/process-flow-versions/${response.body.data.versions[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const gate = detail.body.data.stages[1];
    const inline = detail.body.data.stages[3];
    const final = detail.body.data.stages[5];
    expect(gate).toMatchObject({
      activityType: 'QUALITY',
      qualityFormVersionId: gateForm.id,
      qualityExecutionMode: 'SEQUENTIAL_GATE',
      associatedProductionActivityId: null,
    });
    expect(inline).toMatchObject({
      qualityFormVersionId: inlineForm.id,
      qualityExecutionMode: 'IN_PROCESS',
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      progressThresholdPercent: null,
      associatedProductionActivity: { name: 'Sewing' },
    });
    expect(final).toMatchObject({
      qualityFormVersionId: finalForm.id,
      qualityAvailabilityPolicy: 'PROGRESS_PERCENTAGE',
      progressThresholdPercent: 50,
      associatedProductionActivity: { name: 'Finishing' },
    });
    const flows = await request(app)
      .get('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(flows.body.data[0].versions[0].hasQualityActivities).toBe(true);
  });

  it('requires exact published Quality Form versions and rejects Quality fields on Production', async () => {
    const { token } = await manager();
    const draft = await qualityVersion('DRAFT_FORM', 1, 'DRAFT');
    await createFlow(token, [
      { activityType: 'QUALITY', name: 'Missing Form', qualityExecutionMode: 'SEQUENTIAL_GATE' },
    ]).expect(400);
    await createFlow(token, [sequential('gate', draft.id)]).expect(400);
    await createFlow(token, [
      { ...production('sewing', 'Sewing'), qualityFormVersionId: draft.id },
    ]).expect(400);
  });

  it('persists and copies explicit gate, completion availability, multiplicity and coverage semantics', async () => {
    const { token } = await manager();
    const sample = await qualityVersion('SAMPLE_GATE');
    const ppm = await qualityVersion('PPM_GATE');
    const inline = await qualityVersion('INLINE_SINGLE');
    const final = await qualityVersion('FINAL_BATCHED');
    const flow = await createFlow(token, [
      {
        ...sequential('sample', sample.id),
        name: 'PP Sample Checklist',
        gateSatisfactionRequirement: 'OUTCOME_PASS',
        executionMultiplicity: 'SINGLE',
      },
      {
        ...sequential('ppm', ppm.id),
        name: 'Size Set / Pre-Production',
        gateSatisfactionRequirement: 'FINALIZED',
        executionMultiplicity: 'SINGLE',
      },
      production('sewing', 'Sewing'),
      {
        ...inProcess('inline', inline.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
        executionMultiplicity: 'SINGLE',
      },
      {
        ...inProcess('final', final.id, 'sewing', 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES'),
        executionMultiplicity: 'BATCHED',
        coverageTarget: 'PREPARED_QUANTITY',
      },
    ]).expect(201);
    const sourceId = flow.body.data.versions[0].id as string;
    const copied = await request(app)
      .post(`/process-flows/${flow.body.data.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: sourceId })
      .expect(201);
    const byName = new Map(
      copied.body.data.stages.map((stage: { name: string }) => [stage.name, stage]),
    );
    expect(byName.get('PP Sample Checklist')).toMatchObject({
      gateSatisfactionRequirement: 'OUTCOME_PASS',
      executionMultiplicity: 'SINGLE',
    });
    expect(byName.get('Size Set / Pre-Production')).toMatchObject({
      gateSatisfactionRequirement: 'FINALIZED',
    });
    expect(byName.get('Inline Inspection')).toMatchObject({
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'SINGLE',
      coverageTarget: null,
    });
    expect(byName.get('Final Inspection')).toMatchObject({
      qualityAvailabilityPolicy: 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    });
  });

  it('rejects invalid gate, multiplicity and coverage combinations', async () => {
    const { token } = await manager();
    const form = await qualityVersion('INVALID_WORKFLOW');
    await createFlow(token, [
      { ...sequential('gate', form.id), executionMultiplicity: 'BATCHED', coverageTarget: 'PREPARED_QUANTITY' },
    ]).expect(400);
    await createFlow(token, [
      production('sewing', 'Sewing'),
      {
        ...inProcess('final', form.id, 'sewing', 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES'),
        executionMultiplicity: 'BATCHED',
      },
    ]).expect(400);
    await createFlow(token, [
      production('sewing', 'Sewing'),
      {
        ...inProcess('inline', form.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
        executionMultiplicity: 'SINGLE',
        coverageTarget: 'PREPARED_QUANTITY',
      },
    ]).expect(400);
  });

  it.each([
    [
      'self association',
      (id: string) => [
        production('sewing', 'Sewing'),
        inProcess('inline', id, 'inline', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
      ],
    ],
    [
      'missing same-version association',
      (id: string) => [
        production('sewing', 'Sewing'),
        inProcess('inline', id, 'other-version-stage', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
      ],
    ],
    [
      'association with Quality',
      (id: string) => [
        production('sewing', 'Sewing'),
        sequential('gate', id),
        inProcess('inline', id, 'gate', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
      ],
    ],
  ])('rejects invalid in-process relationship: %s', async (_label, activities) => {
    const { token } = await manager();
    const form = await qualityVersion('RELATIONSHIP');
    await createFlow(token, activities(form.id)).expect(400);
  });

  it.each([
    ['active policy with threshold', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE', 50],
    ['percentage without threshold', 'PROGRESS_PERCENTAGE', undefined],
    ['zero percentage', 'PROGRESS_PERCENTAGE', 0],
    ['percentage over 100', 'PROGRESS_PERCENTAGE', 101],
  ] as const)('rejects incompatible availability: %s', async (_label, policy, threshold) => {
    const { token } = await manager();
    const form = await qualityVersion('AVAILABILITY');
    await createFlow(token, [
      production('finishing', 'Finishing'),
      inProcess('final', form.id, 'finishing', policy, threshold),
    ]).expect(400);
  });

  it('copies the exact Quality Form version and never upgrades it to a newer publication', async () => {
    const { token } = await manager();
    const inlineV1 = await qualityVersion('INLINE_COPY', 1);
    const finalV1 = await qualityVersion('FINAL_COPY', 1);
    const flow = await createFlow(token, [
      production('sewing', 'Sewing'),
      inProcess('inline', inlineV1.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
      production('finishing', 'Finishing'),
      inProcess('final', finalV1.id, 'finishing', 'PROGRESS_PERCENTAGE', 50),
    ]).expect(201);
    const source = await request(app)
      .get(`/process-flow-versions/${flow.body.data.versions[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await prisma.qualityFormVersion.update({
      where: { id: finalV1.id },
      data: { status: 'RETIRED' },
    });
    const finalV2 = await qualityVersion('FINAL_COPY', 2);
    const copied = await request(app)
      .post(`/process-flows/${flow.body.data.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: flow.body.data.versions[0].id })
      .expect(201);

    type CopiedActivity = {
      id: string;
      name: string;
      associatedProductionActivityId: string | null;
      qualityFormVersionId: string | null;
    };
    const sourceByName = new Map<string, CopiedActivity>(
      (source.body.data.stages as CopiedActivity[]).map((activity) => [activity.name, activity]),
    );
    const copiedByName = new Map<string, CopiedActivity>(
      (copied.body.data.stages as CopiedActivity[]).map((activity) => [activity.name, activity]),
    );
    const copiedSewing = copiedByName.get('Sewing')!;
    const copiedInline = copiedByName.get('Inline Inspection')!;
    const copiedFinishing = copiedByName.get('Finishing')!;
    const copiedFinal = copiedByName.get('Final Inspection')!;

    expect(copiedInline.associatedProductionActivityId).toBe(copiedSewing.id);
    expect(copiedFinal.associatedProductionActivityId).toBe(copiedFinishing.id);
    expect(copiedInline.associatedProductionActivityId).not.toBe(sourceByName.get('Sewing')!.id);
    expect(copiedFinal.associatedProductionActivityId).not.toBe(sourceByName.get('Finishing')!.id);
    expect(copiedInline.qualityFormVersionId).toBe(inlineV1.id);
    expect(copiedFinal.qualityFormVersionId).toBe(finalV1.id);
    expect(copiedFinal.qualityFormVersionId).not.toBe(finalV2.id);
  });

  it('keeps retired Quality Form versions readable while immutable Process Flow versions reject edits', async () => {
    const { token } = await manager();
    const form = await qualityVersion('HISTORICAL');
    const flow = await createFlow(token, [
      production('sewing', 'Sewing'),
      inProcess('inline', form.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
    ]).expect(201);
    const versionId = flow.body.data.versions[0].id;
    await request(app)
      .post(`/process-flow-versions/${versionId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await prisma.qualityFormVersion.update({ where: { id: form.id }, data: { status: 'RETIRED' } });
    const detail = await request(app)
      .get(`/process-flow-versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.data.stages[1].qualityFormVersion).toMatchObject({
      id: form.id,
      status: 'RETIRED',
      qualityForm: { code: 'HISTORICAL', name: 'HISTORICAL Report' },
    });
    expect(
      await prisma.processFlowVersionStage.findUniqueOrThrow({
        where: { id: detail.body.data.stages[1].id },
        select: { qualityFormVersionId: true },
      }),
    ).toEqual({ qualityFormVersionId: form.id });
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [production('changed', 'Changed')] })
      .expect(409);
  });

  it('preserves an existing retired reference in a draft but rejects it for a newly configured activity', async () => {
    const { token } = await manager();
    const form = await qualityVersion('RETIRED_DRAFT');
    const flow = await createFlow(token, [
      production('sewing', 'Sewing'),
      inProcess('inline', form.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
    ]).expect(201);
    const versionId = flow.body.data.versions[0].id;
    const detail = await request(app)
      .get(`/process-flow-versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const [sewing, inline] = detail.body.data.stages;
    await prisma.qualityFormVersion.update({ where: { id: form.id }, data: { status: 'RETIRED' } });

    const preservedStages = [
      { activityKey: sewing.id, activityType: 'PRODUCTION', name: 'Sewing' },
      {
        activityKey: inline.id,
        activityType: 'QUALITY',
        name: 'Inline Inspection',
        qualityFormVersionId: form.id,
        qualityExecutionMode: 'IN_PROCESS',
        associatedProductionActivityKey: sewing.id,
        qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      },
      production('finishing', 'Finishing'),
    ];
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: preservedStages })
      .expect(200);

    const refreshed = await request(app)
      .get(`/process-flow-versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const refreshedSewing = refreshed.body.data.stages.find(
      (activity: { name: string }) => activity.name === 'Sewing',
    );
    const refreshedInline = refreshed.body.data.stages.find(
      (activity: { name: string }) => activity.name === 'Inline Inspection',
    );

    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [
          {
            activityKey: refreshedSewing.id,
            activityType: 'PRODUCTION',
            name: 'Sewing',
          },
          {
            activityKey: refreshedInline.id,
            activityType: 'QUALITY',
            name: 'Inline Inspection',
            qualityFormVersionId: form.id,
            qualityExecutionMode: 'IN_PROCESS',
            associatedProductionActivityKey: refreshedSewing.id,
            qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
          },
          production('finishing', 'Finishing'),
          {
            activityKey: 'new-retired-gate',
            activityType: 'QUALITY',
            name: 'New Retired Gate',
            qualityFormVersionId: form.id,
            qualityExecutionMode: 'SEQUENTIAL_GATE',
          },
        ],
      })
      .expect(400);
  });

  it('keeps Process Flow route authorization unchanged', async () => {
    const form = await qualityVersion('AUTH');
    const { token: merchToken } = await manager('MERCHANDISER');
    await createFlow(merchToken, [
      production('sewing', 'Sewing'),
      sequential('gate', form.id),
    ]).expect(201);
    const { token: qaToken } = await createTestUserAndToken({
      email: 'qa-flow@test.local',
      password: 'password',
      roles: ['QA_USER'],
    });
    await createFlow(qaToken, [production('sewing', 'Sewing')]).expect(403);
    await request(app).get('/process-flows').set('Authorization', `Bearer ${qaToken}`).expect(403);
  });

  it('suppresses audit noise for a semantic no-op draft replacement', async () => {
    const { token } = await manager();
    const form = await qualityVersion('NOOP');
    const flow = await createFlow(token, [
      production('sewing', 'Sewing'),
      inProcess('inline', form.id, 'sewing', 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'),
    ]).expect(201);
    const versionId = flow.body.data.versions[0].id;
    const detail = await request(app)
      .get(`/process-flow-versions/${versionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const [sewing, inline] = detail.body.data.stages;
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [
          {
            activityKey: sewing.id,
            activityType: 'PRODUCTION',
            name: sewing.name,
            code: null,
            status: 'ACTIVE',
          },
          {
            activityKey: inline.id,
            activityType: 'QUALITY',
            name: inline.name,
            code: null,
            status: 'ACTIVE',
            qualityFormVersionId: form.id,
            qualityExecutionMode: 'IN_PROCESS',
            associatedProductionActivityKey: sewing.id,
            qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
          },
        ],
      })
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: { entityId: versionId, action: 'PROCESS_FLOW_DRAFT_STAGES_REPLACED' },
      }),
    ).toBe(0);
  });
});

describe('Process Flow Quality database integrity', () => {
  async function foundation() {
    const form = await qualityVersion('DB_INTEGRITY');
    const flow = await prisma.processFlow.create({
      data: {
        id: createId(),
        code: `DB-${createId()}`,
        name: 'Database Integrity Flow',
        versions: {
          create: [
            { id: createId(), versionNumber: 1 },
            { id: createId(), versionNumber: 2 },
          ],
        },
      },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });
    const [version1, version2] = flow.versions;
    const production1 = await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: version1!.id,
        sequence: 1,
        name: 'Sewing',
      },
    });
    const production2 = await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: version2!.id,
        sequence: 1,
        name: 'Other Sewing',
      },
    });
    return { form, version1: version1!, version2: version2!, production1, production2 };
  }

  it('database check rejects every Quality-only field on a Production activity', async () => {
    const { form, version1, production1 } = await foundation();
    const invalidConfigurations = [
      { qualityFormVersionId: form.id },
      { qualityExecutionMode: 'SEQUENTIAL_GATE' },
      { associatedProductionActivityId: production1.id },
      { qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' },
      { progressThresholdPercent: 50 },
    ];
    for (const configuration of invalidConfigurations) {
      await expect(
        prisma.processFlowVersionStage.create({
          data: {
            id: createId(),
            processFlowVersionId: version1.id,
            sequence: 2,
            name: `Invalid Production ${createId()}`,
            activityType: 'PRODUCTION',
            ...configuration,
          } as never,
        }),
      ).rejects.toThrow();
    }
  });

  it('database check enforces the Sequential Quality gate shape', async () => {
    const { form, version1, production1 } = await foundation();
    await expect(
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: version1.id,
          sequence: 2,
          name: 'Missing Execution Mode',
          activityType: 'QUALITY',
          qualityFormVersionId: form.id,
        } as never,
      }),
    ).rejects.toThrow();
    await expect(
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: version1.id,
          sequence: 2,
          name: 'Missing Form',
          activityType: 'QUALITY',
          qualityExecutionMode: 'SEQUENTIAL_GATE',
        } as never,
      }),
    ).rejects.toThrow();
    await expect(
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: version1.id,
          sequence: 2,
          name: 'Sequential With Association',
          activityType: 'QUALITY',
          qualityFormVersionId: form.id,
          qualityExecutionMode: 'SEQUENTIAL_GATE',
          gateSatisfactionRequirement: 'FINALIZED',
          executionMultiplicity: 'SINGLE',
          associatedProductionActivityId: production1.id,
          qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
        } as never,
      }),
    ).rejects.toThrow();
    await expect(
      prisma.processFlowVersionStage.create({
        data: {
          id: createId(),
          processFlowVersionId: version1.id,
          sequence: 2,
          name: 'Valid Gate',
          activityType: 'QUALITY',
          qualityFormVersionId: form.id,
          qualityExecutionMode: 'SEQUENTIAL_GATE',
          gateSatisfactionRequirement: 'FINALIZED',
          executionMultiplicity: 'SINGLE',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('database trigger requires an associated Production activity in the same version', async () => {
    const { form, version1, production1, production2 } = await foundation();
    const quality = await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: version1.id,
        sequence: 2,
        name: 'Gate',
        activityType: 'QUALITY',
        qualityFormVersionId: form.id,
        qualityExecutionMode: 'SEQUENTIAL_GATE',
        gateSatisfactionRequirement: 'FINALIZED',
        executionMultiplicity: 'SINGLE',
      },
    });
    const input = (associatedProductionActivityId: string) => ({
      id: createId(),
      processFlowVersionId: version1.id,
      sequence: 3,
      name: `Inline ${createId()}`,
      activityType: 'QUALITY',
      qualityFormVersionId: form.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId,
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'SINGLE',
    });
    await expect(
      prisma.processFlowVersionStage.create({ data: input(quality.id) as never }),
    ).rejects.toThrow();
    await expect(
      prisma.processFlowVersionStage.create({ data: input(production2.id) as never }),
    ).rejects.toThrow();
    await expect(
      prisma.processFlowVersionStage.create({ data: input(production1.id) as never }),
    ).resolves.toBeDefined();
  });

  it('database check enforces availability and percentage threshold combinations', async () => {
    const { form, version1, production1 } = await foundation();
    const input = (policy: string, threshold?: number) => ({
      id: createId(),
      processFlowVersionId: version1.id,
      sequence: 2,
      name: `Inspection ${createId()}`,
      activityType: 'QUALITY',
      qualityFormVersionId: form.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: production1.id,
      qualityAvailabilityPolicy: policy,
      executionMultiplicity: 'SINGLE',
      ...(threshold === undefined ? {} : { progressThresholdPercent: threshold }),
    });
    await expect(
      prisma.processFlowVersionStage.create({
        data: input('WHILE_ASSOCIATED_ACTIVITY_ACTIVE', 50) as never,
      }),
    ).rejects.toThrow();
    for (const threshold of [undefined, 0, 101]) {
      await expect(
        prisma.processFlowVersionStage.create({
          data: input('PROGRESS_PERCENTAGE', threshold) as never,
        }),
      ).rejects.toThrow();
    }
    await expect(
      prisma.processFlowVersionStage.create({
        data: input('PROGRESS_PERCENTAGE', 50) as never,
      }),
    ).resolves.toBeDefined();
  });
});
