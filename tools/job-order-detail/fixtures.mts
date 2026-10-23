import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { disposableTarget } from './safety.mjs';

// Validate before loading Prisma or anything that can connect to a database.
process.env.DATABASE_URL = disposableTarget(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
);
process.env.NODE_ENV = 'test';
const { prisma } = await import('../../apps/api/src/db/prisma.js');
const { createTestFactory, createTestSeason, createTestFinancialYear, createTestUserAndToken } =
  await import('../../apps/api/src/test/helpers.js');
const id = randomUUID;
const suffix = id().slice(0, 8).toUpperCase();
const password = randomBytes(24).toString('base64url');

try {
  for (const name of [
    'ADMIN',
    'FACTORY_USER',
    'QA_USER',
    'MERCHANDISER',
    'ACCOUNTANT',
    'SENIOR_MANAGEMENT',
  ]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { id: id(), name } });
  }
  const actors: Record<string, { token: string; userId: string; email: string; password: string }> =
    {};
  for (const role of [
    'ADMIN',
    'FACTORY_USER',
    'QA_USER',
    'MERCHANDISER',
    'ACCOUNTANT',
    'SENIOR_MANAGEMENT',
  ]) {
    const email = `batch1-${role}-${suffix}@test.local`.toLowerCase();
    actors[role] = {
      ...(await createTestUserAndToken({ email, password, roles: [role] })),
      email,
      password,
    };
  }
  const factory = await createTestFactory({
    name: 'Batch 1 Synthetic Factory with a deliberately long manufacturing and finishing department name',
  });
  const otherFactory = await createTestFactory();
  const unauthorized = await createTestUserAndToken({
    email: `other-factory-${suffix}@test.local`,
    password,
    roles: ['FACTORY_USER'],
  });
  for (const [userId, factoryId] of [
    [actors.FACTORY_USER!.userId, factory.id],
    [unauthorized.userId, otherFactory.id],
  ])
    await prisma.userFactory.create({ data: { id: id(), userId, factoryId } });
  const financialYear = await createTestFinancialYear();
  const season = await createTestSeason({
    code: `SS26-${suffix}`,
    name: 'Recorded Summer',
    financialYearId: financialYear.id,
  });
  const style = await prisma.style.create({
    data: {
      id: id(),
      styleNumber: `BATCH1-${suffix}`,
      styleName:
        'Synthetic Style with a deliberately long name for desktop gutter and responsive header verification',
      finalMrp: 100,
      seasonId: season.id,
    },
  });
  const size = await prisma.size.create({
    data: { id: id(), code: `S-${suffix}`, label: 'Small', sizeType: 'ALPHA', sortOrder: 1 },
  });
  const form = await prisma.qualityForm.create({
    data: {
      id: id(),
      code: `FINAL_${suffix}`,
      name: 'Final Inspection',
      versions: {
        create: {
          id: id(),
          versionNumber: 1,
          activityType: 'INSPECTION',
          executionScope: 'JOB_ORDER',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      },
    },
    include: { versions: true },
  });
  const flow = await prisma.processFlow.create({
    data: {
      id: id(),
      code: `B1-${suffix}`,
      name: 'Batch 1 Synthetic Flow',
      versions: { create: { id: id(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const production = await prisma.processFlowVersionStage.create({
    data: {
      id: id(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 1,
      name: 'Finishing',
      code: 'FINISHING',
    },
  });
  await prisma.processFlowVersionStage.create({
    data: {
      id: id(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 2,
      name: 'Final Inspection',
      code: 'FINAL',
      activityType: 'QUALITY',
      qualityFormVersionId: form.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: production.id,
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    },
  });
  async function order(
    status: 'DRAFT' | 'SENT_TO_FACTORY' | 'CONFIRMED_BY_FACTORY' | 'IN_PRODUCTION',
  ) {
    return prisma.jobOrder.create({
      data: {
        id: id(),
        jobOrderNumber: `BATCH1-${status}-${id()}`,
        factoryId: factory.id,
        processFlowVersionId: flow.versions[0]!.id,
        createdBy: actors.ADMIN!.userId,
        financialYearId: financialYear.id,
        unitPrice: 10,
        status,
        factoryConfirmationStatus: ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(status)
          ? 'CONFIRMED'
          : 'PENDING',
        disclaimerText:
          'Synthetic persisted commercial disclaimer. Read and acknowledge before confirmation.',
        disclaimerRevision: 1,
        productionStartedAt: status === 'IN_PRODUCTION' ? new Date() : null,
        requiredDeliveryDate: new Date('2020-01-01'),
        lines: {
          create: {
            id: id(),
            styleId: style.id,
            orderedQuantityTotal: 20,
            sizes: { create: { id: id(), sizeId: size.id, orderedQuantity: 20 } },
          },
        },
        seasonSnapshots: {
          create: {
            id: id(),
            seasonId: season.id,
            code: 'SS26',
            name: 'Recorded Summer',
            financialYear: '2026-27',
            displayName: 'SS26 Recorded Summer',
          },
        },
        ...(status === 'IN_PRODUCTION'
          ? {
              stageStatuses: {
                create: {
                  id: id(),
                  processFlowVersionStageId: production.id,
                  stageSequence: 1,
                  stageNameSnapshot: 'Finishing',
                  status: 'IN_PROGRESS',
                },
              },
            }
          : {}),
      },
      include: { lines: { include: { sizes: true } } },
    });
  }
  const draft = await order('DRAFT'),
    sent = await order('SENT_TO_FACTORY'),
    prepared = await order('IN_PRODUCTION');
  const missing = await order('DRAFT'),
    conflicting = await order('DRAFT');
  const qaReady = await order('IN_PRODUCTION');
  await prisma.jobOrder.update({ where: { id: qaReady.id }, data: { preparedQuantityTotal: 5 } });
  await prisma.jobOrderLine.update({
    where: { id: qaReady.lines[0]!.id },
    data: { preparedQuantityTotal: 5 },
  });
  await prisma.jobOrderLineSize.update({
    where: { id: qaReady.lines[0]!.sizes[0]!.id },
    data: { preparedQuantity: 5 },
  });

  // Batch 6 synthetic role/lifecycle scenarios: parallel pre-production gates,
  // an unrelated later gate, and the existing effective Inline PASS boundary.
  const actionFlow = await prisma.processFlow.create({
    data: {
      id: id(),
      code: `B6-${suffix}`,
      name: `Batch6 actions ${suffix}`,
      versions: { create: { id: id(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const actionVersionId = actionFlow.versions[0]!.id;
  const ppForm = await prisma.qualityForm.create({
    data: {
      id: id(),
      code: `PP_${suffix}`,
      name: 'PP Sample',
      versions: {
        create: {
          id: id(),
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
  const definitions: Record<string, { id: string; sequence: number; name: string }> = {};
  for (const [index, name] of [
    'PP Sample',
    'PPM',
    'Cutting',
    'Printing',
    'Sewing',
    'Inline QA',
    'Finishing',
    'Later gate',
  ].entries()) {
    const quality = ['PP Sample', 'PPM', 'Inline QA', 'Later gate'].includes(name);
    definitions[name] = await prisma.processFlowVersionStage.create({
      data: {
        id: id(),
        processFlowVersionId: actionVersionId,
        sequence: index + 1,
        name,
        activityType: quality ? 'QUALITY' : 'PRODUCTION',
        ...(quality
          ? {
              qualityFormVersionId:
                name === 'PP Sample' ? ppForm.versions[0]!.id : form.versions[0]!.id,
              qualityExecutionMode: name === 'Inline QA' ? 'IN_PROCESS' : 'SEQUENTIAL_GATE',
              qualityAvailabilityPolicy:
                name === 'Inline QA' ? 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' : null,
              associatedProductionActivityId: name === 'Inline QA' ? definitions.Sewing!.id : null,
              executionMultiplicity: 'SINGLE',
              gateSatisfactionRequirement: name === 'Inline QA' ? null : name === 'PPM' ? 'FINALIZED' : 'OUTCOME_PASS',
            }
          : {}),
      },
    });
  }
  async function actionOrder(state: 'preproduction' | 'cutting' | 'inlineFail' | 'inlinePass') {
    const job = await order(state === 'preproduction' ? 'CONFIRMED_BY_FACTORY' : 'IN_PRODUCTION');
    await prisma.jobOrderStageStatus.deleteMany({ where: { jobOrderId: job.id } });
    await prisma.jobOrder.update({
      where: { id: job.id },
      data: { processFlowVersionId: actionVersionId },
    });
    for (const name of ['Cutting', 'Printing', 'Sewing', 'Finishing']) {
      const definition = definitions[name]!;
      const status = state.startsWith('inline')
        ? name === 'Sewing'
          ? 'IN_PROGRESS'
          : ['Cutting', 'Printing'].includes(name)
            ? 'COMPLETED'
            : 'NOT_STARTED'
        : 'NOT_STARTED';
      await prisma.jobOrderStageStatus.create({
        data: {
          id: id(),
          jobOrderId: job.id,
          processFlowVersionStageId: definition.id,
          stageSequence: definition.sequence,
          stageNameSnapshot: name,
          status,
        },
      });
    }
    if (state !== 'preproduction') {
      for (const name of [
        'PP Sample',
        'PPM',
        ...(state.startsWith('inline') ? ['Inline QA'] : []),
      ]) {
        await prisma.qualityActivityExecution.create({
          data: {
            id: id(),
            jobOrderId: job.id,
            processFlowActivityId: definitions[name]!.id,
            qualityFormVersionId:
              name === 'PP Sample' ? ppForm.versions[0]!.id : form.versions[0]!.id,
            attemptNumber: 1,
            batchNumber: 1,
            status: 'FINALIZED',
            outcome: name === 'Inline QA' && state === 'inlineFail' ? 'FAIL' : 'PASS',
            startedById: actors.QA_USER!.userId,
            finalizedById: actors.QA_USER!.userId,
            finalizedAt: new Date(),
          },
        });
      }
    }
    return job.id;
  }
  const actions = {
    preproduction: await actionOrder('preproduction'),
    cutting: await actionOrder('cutting'),
    inlineFail: await actionOrder('inlineFail'),
    inlinePass: await actionOrder('inlinePass'),
    qaReady: qaReady.id,
  };
  await prisma.jobOrderSeasonSnapshot.deleteMany({ where: { jobOrderId: missing.id } });
  await prisma.jobOrderSeasonSnapshot.create({
    data: {
      id: id(),
      jobOrderId: conflicting.id,
      seasonId: null,
      code: 'AW25',
      name: 'Recorded Winter',
      financialYear: '2025-26',
      displayName: 'AW25 Recorded Winter',
    },
  });
  const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))('sharp');
  const marker = await sharp({
    create: { width: 512, height: 384, channels: 3, background: { r: 202, g: 18, b: 58 } },
  })
    .png()
    .toBuffer();
  await writeFile(
    process.env.BATCH1_FIXTURES!,
    JSON.stringify({
      actors,
      actions,
      styleId: style.id,
      marker: marker.toString('base64'),
      unauthorized,
      draft: draft.id,
      sent: sent.id,
      prepared: prepared.id,
      missing: missing.id,
      conflicting: conflicting.id,
      preparedSize: prepared.lines[0]!.sizes[0]!.id,
      sizeCode: size.code,
    }),
    { mode: 0o600 },
  );
  console.log('Created isolated synthetic Job Order fixtures');
} finally {
  await prisma.$disconnect();
}
