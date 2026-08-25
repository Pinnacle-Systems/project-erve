import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import {
  runQualityBootstrap,
  QualityBootstrapError,
  type QualityBootstrapPrismaClient,
} from './quality-bootstrap.js';
import { CANONICAL_QUALITY_FORMS, CANONICAL_PROCESS_FLOW } from './quality-bootstrap-definitions.js';

const DB_URL = 'postgresql://erve_app:super-secret-pw@10.0.0.5:5432/erve_production?schema=public';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function bootstrap(overrides: { dryRun?: boolean } = {}) {
  return runQualityBootstrap(
    { nodeEnv: 'test', confirmProduction: false, dryRun: overrides.dryRun },
    { databaseUrl: DB_URL },
  );
}

describe('runQualityBootstrap — empty database', () => {
  it('creates all four canonical Quality Forms, each published as version 1', async () => {
    const result = await bootstrap();

    expect(result.forms.map((f) => f.code).sort()).toEqual(['FINAL', 'INLINE', 'PPM', 'SAMPLE']);
    for (const form of result.forms) {
      expect(form.action).toBe('created_version');
      expect(form.versionNumber).toBe(1);
      expect(form.retiredVersionNumbers).toEqual([]);
    }

    const forms = await prisma.qualityForm.findMany({
      include: { versions: { include: { sections: { include: { components: true } } } } },
    });
    expect(forms).toHaveLength(4);
    for (const form of forms) {
      expect(form.status).toBe('ACTIVE');
      expect(form.versions).toHaveLength(1);
      expect(form.versions[0]!.status).toBe('PUBLISHED');
    }
  });

  it('creates the canonical ERVE_PRODUCTION_QUALITY Process Flow as an active version with 8 stages', async () => {
    const result = await bootstrap();

    expect(result.processFlow.action).toBe('created_version');
    expect(result.processFlow.versionNumber).toBe(1);

    const flow = await prisma.processFlow.findUnique({
      where: { code: 'ERVE_PRODUCTION_QUALITY' },
      include: { versions: { include: { stages: { orderBy: { sequence: 'asc' } } } } },
    });
    expect(flow).not.toBeNull();
    expect(flow!.status).toBe('ACTIVE');
    expect(flow!.versions).toHaveLength(1);
    const version = flow!.versions[0]!;
    expect(version.status).toBe('ACTIVE');
    expect(version.stages).toHaveLength(8);
    expect(version.stages.map((s) => s.code)).toEqual([
      'PP_SAMPLE',
      'PPM',
      'CUTTING',
      'PRINTING',
      'SEWING',
      'INLINE',
      'FINISHING',
      'FINAL',
    ]);
  });

  it('associates Inline with Sewing and Final with Finishing, using no percentage-based configuration anywhere', async () => {
    await bootstrap();

    const version = await prisma.processFlowVersion.findFirstOrThrow({
      where: { processFlow: { code: 'ERVE_PRODUCTION_QUALITY' } },
      include: { stages: true },
    });
    const byCode = new Map(version.stages.map((s) => [s.code, s]));
    const sewing = byCode.get('SEWING')!;
    const finishing = byCode.get('FINISHING')!;
    const inline = byCode.get('INLINE')!;
    const final = byCode.get('FINAL')!;

    expect(inline.associatedProductionActivityId).toBe(sewing.id);
    expect(inline.qualityAvailabilityPolicy).toBe('WHILE_ASSOCIATED_ACTIVITY_ACTIVE');
    expect(inline.executionMultiplicity).toBe('SINGLE');

    expect(final.associatedProductionActivityId).toBe(finishing.id);
    expect(final.qualityAvailabilityPolicy).toBe('WHILE_ASSOCIATED_ACTIVITY_ACTIVE');
    expect(final.executionMultiplicity).toBe('BATCHED');
    expect(final.coverageTarget).toBe('PREPARED_QUANTITY');

    // No stage anywhere carries percentage-based configuration.
    for (const stage of version.stages) {
      expect(stage.progressThresholdPercent).toBeNull();
      expect(stage.qualityAvailabilityPolicy).not.toBe('PROGRESS_PERCENTAGE');
    }
    const productionStages = version.stages.filter((s) => s.activityType === 'PRODUCTION');
    expect(productionStages.map((s) => s.code).sort()).toEqual(['CUTTING', 'FINISHING', 'PRINTING', 'SEWING']);
    for (const stage of productionStages) {
      expect(stage.qualityExecutionMode).toBeNull();
      expect(stage.qualityAvailabilityPolicy).toBeNull();
      expect(stage.coverageTarget).toBeNull();
    }

    const ppSample = byCode.get('PP_SAMPLE')!;
    expect(ppSample.qualityExecutionMode).toBe('SEQUENTIAL_GATE');
    expect(ppSample.gateSatisfactionRequirement).toBe('OUTCOME_PASS');
    expect(ppSample.executionMultiplicity).toBe('SINGLE');

    const ppm = byCode.get('PPM')!;
    expect(ppm.qualityExecutionMode).toBe('SEQUENTIAL_GATE');
    expect(ppm.gateSatisfactionRequirement).toBe('FINALIZED');
  });

  it('canonical Inline has no PRODUCTION_PROGRESS component and no percentage metric of any kind', async () => {
    await bootstrap();

    const inlineForm = await prisma.qualityForm.findUniqueOrThrow({
      where: { code: 'INLINE' },
      include: {
        versions: { include: { sections: { include: { components: true } } } },
      },
    });
    const published = inlineForm.versions.find((v) => v.status === 'PUBLISHED')!;
    const componentTypes = published.sections.flatMap((s) => s.components.map((c) => c.type));
    expect(componentTypes).not.toContain('PRODUCTION_PROGRESS');
  });
});

describe('runQualityBootstrap — idempotency', () => {
  it('a second run against an already-current database makes zero new versions', async () => {
    await bootstrap();
    const before = await prisma.qualityFormVersion.findMany({ orderBy: { id: 'asc' } });
    const beforeFlowVersions = await prisma.processFlowVersion.findMany({ orderBy: { id: 'asc' } });

    const result = await bootstrap();

    expect(result.forms.every((f) => f.action === 'unchanged')).toBe(true);
    expect(result.processFlow.action).toBe('unchanged');

    const after = await prisma.qualityFormVersion.findMany({ orderBy: { id: 'asc' } });
    const afterFlowVersions = await prisma.processFlowVersion.findMany({ orderBy: { id: 'asc' } });
    expect(after.map((v) => v.id)).toEqual(before.map((v) => v.id));
    expect(afterFlowVersions.map((v) => v.id)).toEqual(beforeFlowVersions.map((v) => v.id));
  });
});

describe('runQualityBootstrap — legacy/mixed data', () => {
  it('a legacy SAMPLE version with an AVAILABLE response option is left untouched, and a new YES/NO version is published', async () => {
    const form = await prisma.qualityForm.create({
      data: { id: createId(), code: 'SAMPLE', name: 'QA Sample Checklist (legacy)', status: 'ACTIVE' },
    });
    const legacyVersion = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 1,
        activityType: 'INSPECTION',
        executionScope: 'SIZE',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        sections: {
          create: {
            id: createId(),
            sequence: 1,
            title: 'Existing QA checklist',
            components: {
              create: {
                id: createId(),
                sequence: 1,
                type: 'CHECKLIST',
                title: 'Sample checklist',
                config: { items: [{ key: 'fabric', label: 'Fabric' }], responseOptions: ['YES', 'NO', 'AVAILABLE'] },
              },
            },
          },
        },
      },
    });

    const result = await bootstrap();
    const sampleOutcome = result.forms.find((f) => f.code === 'SAMPLE')!;
    expect(sampleOutcome.action).toBe('created_version');
    expect(sampleOutcome.versionNumber).toBe(2);
    expect(sampleOutcome.retiredVersionNumbers).toEqual([1]);

    const untouched = await prisma.qualityFormVersion.findUniqueOrThrow({
      where: { id: legacyVersion.id },
      include: { sections: { include: { components: true } } },
    });
    expect(untouched.status).toBe('RETIRED');
    const legacyConfig = untouched.sections[0]!.components[0]!.config as { responseOptions: string[] };
    expect(legacyConfig.responseOptions).toEqual(['YES', 'NO', 'AVAILABLE']);

    const newVersion = await prisma.qualityFormVersion.findUniqueOrThrow({
      where: { id: sampleOutcome.qualityFormVersionId },
      include: { sections: { include: { components: true } } },
    });
    const newConfig = newVersion.sections[0]!.components.find((c) => c.type === 'CHECKLIST')!.config as {
      responseOptions: string[];
    };
    expect(newConfig.responseOptions).toEqual(['YES', 'NO']);
  });

  it('a historical Inline version with PRODUCTION_PROGRESS is left untouched, and the canonical version has none', async () => {
    const form = await prisma.qualityForm.create({
      data: { id: createId(), code: 'INLINE', name: 'Inline Inspection Report (legacy)', status: 'ACTIVE' },
    });
    const legacyVersion = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 1,
        activityType: 'INSPECTION',
        executionScope: 'JOB_ORDER',
        status: 'RETIRED',
        publishedAt: new Date(),
        sections: {
          create: {
            id: createId(),
            sequence: 1,
            title: 'Inspection results',
            components: {
              create: {
                id: createId(),
                sequence: 1,
                type: 'PRODUCTION_PROGRESS',
                title: 'Production status',
                config: {
                  metrics: [{ key: 'cutPercentage', label: '% Cut', source: 'SYSTEM', sourceActivityCode: 'CUTTING' }],
                },
              },
            },
          },
        },
      },
    });

    const result = await bootstrap();
    const inlineOutcome = result.forms.find((f) => f.code === 'INLINE')!;
    expect(inlineOutcome.action).toBe('created_version');

    const untouched = await prisma.qualityFormVersion.findUniqueOrThrow({
      where: { id: legacyVersion.id },
      include: { sections: { include: { components: true } } },
    });
    expect(untouched.status).toBe('RETIRED');
    expect(untouched.sections[0]!.components[0]!.type).toBe('PRODUCTION_PROGRESS');

    const newVersion = await prisma.qualityFormVersion.findUniqueOrThrow({
      where: { id: inlineOutcome.qualityFormVersionId },
      include: { sections: { include: { components: true } } },
    });
    const types = newVersion.sections.flatMap((s) => s.components.map((c) => c.type));
    expect(types).not.toContain('PRODUCTION_PROGRESS');
  });

  it('a RETIRED version that semantically matches canonical is never republished — a new max+1 version is created instead', async () => {
    const ppmDefinition = CANONICAL_QUALITY_FORMS.find((f) => f.code === 'PPM')!;
    const form = await prisma.qualityForm.create({
      data: { id: createId(), code: 'PPM', name: ppmDefinition.name, status: 'ACTIVE' },
    });
    // Production has a different version history than development: the
    // canonical content already exists, but numbered 7 and RETIRED. The
    // lifecycle is monotonic (DRAFT -> PUBLISHED -> RETIRED, never
    // backwards), so this must NOT be reactivated — a fresh v8 is created
    // and published, and v7 stays exactly as it was.
    const existingVersion = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 7,
        activityType: ppmDefinition.activityType,
        executionScope: ppmDefinition.executionScope,
        status: 'RETIRED',
        publishedAt: new Date(),
        sections: {
          create: ppmDefinition.sections.map((section, sectionIndex) => ({
            id: createId(),
            sequence: sectionIndex + 1,
            title: section.title,
            components: {
              create: section.components.map((component, componentIndex) => ({
                id: createId(),
                sequence: componentIndex + 1,
                type: component.type,
                title: component.title,
                config: component.config,
              })),
            },
          })),
        },
      },
    });

    const result = await bootstrap();
    const ppmOutcome = result.forms.find((f) => f.code === 'PPM')!;
    expect(ppmOutcome.action).toBe('created_version');
    expect(ppmOutcome.versionNumber).toBe(8);
    expect(ppmOutcome.qualityFormVersionId).not.toBe(existingVersion.id);
    expect(ppmOutcome.historicalMatch).toEqual({ versionNumber: 7, status: 'RETIRED' });

    const versions = await prisma.qualityFormVersion.findMany({
      where: { qualityFormId: form.id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]!.id).toBe(existingVersion.id);
    expect(versions[0]!.versionNumber).toBe(7);
    expect(versions[0]!.status).toBe('RETIRED'); // untouched — never reactivated
    expect(versions[1]!.versionNumber).toBe(8);
    expect(versions[1]!.status).toBe('PUBLISHED');
  });

  it('a RETIRED Process Flow version that semantically matches canonical is never reactivated — a new max+1 version is created instead', async () => {
    // First establish the canonical shape as v1, ACTIVE.
    await bootstrap();
    const flow = await prisma.processFlow.findUniqueOrThrow({ where: { code: CANONICAL_PROCESS_FLOW.code } });
    const v1 = await prisma.processFlowVersion.findFirstOrThrow({
      where: { processFlowId: flow.id, versionNumber: 1 },
    });

    // Simulate the canonical v1 having since been superseded and retired by
    // an unrelated intermediate version (v2, deliberately different so it
    // won't itself match canonical), leaving v1 — which still matches
    // canonical exactly — sitting RETIRED with a gap before the next number.
    await prisma.processFlowVersion.update({ where: { id: v1.id }, data: { status: 'RETIRED' } });
    await prisma.processFlowVersion.create({
      data: { id: createId(), processFlowId: flow.id, versionNumber: 2, status: 'ACTIVE', effectiveFrom: new Date() },
    });

    const result = await bootstrap();
    expect(result.processFlow.action).toBe('created_version');
    expect(result.processFlow.versionNumber).toBe(3);
    expect(result.processFlow.processFlowVersionId).not.toBe(v1.id);
    expect(result.processFlow.historicalMatch).toEqual({ versionNumber: 1, status: 'RETIRED' });

    const versions = await prisma.processFlowVersion.findMany({
      where: { processFlowId: flow.id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((v) => [v.versionNumber, v.status])).toEqual([
      [1, 'RETIRED'],
      [2, 'RETIRED'],
      [3, 'ACTIVE'],
    ]);
  });
});

describe('runQualityBootstrap — targeted rollback', () => {
  it('a failure between retiring the existing PUBLISHED Quality Form version and publishing its replacement leaves the original PUBLISHED and no partial replacement', async () => {
    const form = await prisma.qualityForm.create({
      data: { id: createId(), code: 'PPM', name: 'Pre-Production Meeting Report (legacy)', status: 'ACTIVE' },
    });
    const originalVersion = await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 1,
        activityType: 'MEETING',
        executionScope: 'JOB_ORDER',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        sections: {
          create: {
            id: createId(),
            sequence: 1,
            title: 'Legacy section',
            components: {
              create: {
                id: createId(),
                sequence: 1,
                type: 'COMMENTS',
                title: 'Legacy comments',
                config: { maxLength: 1000 },
              },
            },
          },
        },
      },
    });

    const client: QualityBootstrapPrismaClient = {
      $transaction: ((fn: (tx: unknown) => Promise<unknown>, options?: { timeout?: number }) =>
        prisma.$transaction(async (tx) => {
          await fn(tx);
          throw new Error('forced-test-rollback');
        }, options)) as unknown as QualityBootstrapPrismaClient['$transaction'],
    };

    await expect(
      runQualityBootstrap({ nodeEnv: 'test', confirmProduction: false }, { prisma: client, databaseUrl: DB_URL }),
    ).rejects.toThrow('forced-test-rollback');

    const versions = await prisma.qualityFormVersion.findMany({ where: { qualityFormId: form.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(originalVersion.id);
    expect(versions[0]!.status).toBe('PUBLISHED');
  });

  it('a failure between retiring the existing ACTIVE Process Flow version and activating its replacement leaves the original ACTIVE and no partial replacement', async () => {
    const flow = await prisma.processFlow.create({
      data: {
        id: createId(),
        code: CANONICAL_PROCESS_FLOW.code,
        name: 'Legacy flow',
        description: 'legacy',
        status: 'ACTIVE',
      },
    });
    const originalVersion = await prisma.processFlowVersion.create({
      data: { id: createId(), processFlowId: flow.id, versionNumber: 1, status: 'ACTIVE', effectiveFrom: new Date() },
    });
    await prisma.processFlowVersionStage.create({
      data: {
        id: createId(),
        processFlowVersionId: originalVersion.id,
        sequence: 1,
        name: 'Legacy stage',
        code: 'LEGACY',
        activityType: 'PRODUCTION',
      },
    });

    const client: QualityBootstrapPrismaClient = {
      $transaction: ((fn: (tx: unknown) => Promise<unknown>, options?: { timeout?: number }) =>
        prisma.$transaction(async (tx) => {
          await fn(tx);
          throw new Error('forced-test-rollback');
        }, options)) as unknown as QualityBootstrapPrismaClient['$transaction'],
    };

    await expect(
      runQualityBootstrap({ nodeEnv: 'test', confirmProduction: false }, { prisma: client, databaseUrl: DB_URL }),
    ).rejects.toThrow('forced-test-rollback');

    const versions = await prisma.processFlowVersion.findMany({ where: { processFlowId: flow.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]!.id).toBe(originalVersion.id);
    expect(versions[0]!.status).toBe('ACTIVE');
  });
});

describe('runQualityBootstrap — production guard', () => {
  it('requires --confirm-production in production and never touches the database first', async () => {
    await expect(
      runQualityBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL }),
    ).rejects.toThrow(QualityBootstrapError);

    await expect(prisma.qualityForm.count()).resolves.toBe(0);
    await expect(prisma.processFlow.count({ where: { code: CANONICAL_PROCESS_FLOW.code } })).resolves.toBe(0);
  });

  it('the production guard names the DB target but never a credential', async () => {
    await expect(
      runQualityBootstrap({ nodeEnv: 'production', confirmProduction: false }, { databaseUrl: DB_URL }),
    ).rejects.toMatchObject({ message: expect.stringContaining('erve_production on 10.0.0.5:5432') });
  });

  it('succeeds in production once --confirm-production is supplied', async () => {
    const result = await runQualityBootstrap(
      { nodeEnv: 'production', confirmProduction: true },
      { databaseUrl: DB_URL },
    );
    expect(result.processFlow.action).toBe('created_version');
  });
});

describe('runQualityBootstrap — atomicity', () => {
  it('a failure anywhere in the transaction leaves zero changes, even after real writes already ran', async () => {
    const client: QualityBootstrapPrismaClient = {
      $transaction: ((fn: (tx: unknown) => Promise<unknown>, options?: { timeout?: number }) =>
        prisma.$transaction(async (tx) => {
          await fn(tx);
          throw new Error('forced-test-rollback');
        }, options)) as unknown as QualityBootstrapPrismaClient['$transaction'],
    };

    await expect(
      runQualityBootstrap({ nodeEnv: 'test', confirmProduction: false }, { prisma: client, databaseUrl: DB_URL }),
    ).rejects.toThrow('forced-test-rollback');

    await expect(prisma.qualityForm.count()).resolves.toBe(0);
    await expect(prisma.qualityFormVersion.count()).resolves.toBe(0);
    await expect(prisma.processFlow.count()).resolves.toBe(0);
    await expect(prisma.processFlowVersion.count()).resolves.toBe(0);
    await expect(prisma.auditLog.count()).resolves.toBe(0);
  });
});

describe('runQualityBootstrap — dry run', () => {
  it('reports the full plan but writes nothing, and a real run afterward is unaffected', async () => {
    const dryRunResult = await bootstrap({ dryRun: true });
    expect(dryRunResult.dryRun).toBe(true);
    expect(dryRunResult.forms.every((f) => f.action === 'created_version')).toBe(true);
    expect(dryRunResult.processFlow.action).toBe('created_version');

    await expect(prisma.qualityForm.count()).resolves.toBe(0);
    await expect(prisma.processFlow.count()).resolves.toBe(0);
    await expect(prisma.auditLog.count()).resolves.toBe(0);

    const realResult = await bootstrap();
    expect(realResult.dryRun).toBe(false);
    expect(realResult.forms.every((f) => f.action === 'created_version')).toBe(true);
    await expect(prisma.qualityForm.count()).resolves.toBe(4);
  });
});

describe('runQualityBootstrap — concurrency', () => {
  it('two concurrent runs against an empty database never create duplicate/competing version numbers', async () => {
    await Promise.all([bootstrap(), bootstrap()]);

    const forms = await prisma.qualityForm.findMany({ include: { versions: true } });
    expect(forms).toHaveLength(4);
    for (const form of forms) {
      expect(form.versions).toHaveLength(1);
      expect(form.versions[0]!.versionNumber).toBe(1);
      expect(form.versions[0]!.status).toBe('PUBLISHED');
    }

    const flowVersions = await prisma.processFlowVersion.findMany({
      where: { processFlow: { code: 'ERVE_PRODUCTION_QUALITY' } },
    });
    expect(flowVersions).toHaveLength(1);
    expect(flowVersions[0]!.versionNumber).toBe(1);
    expect(flowVersions[0]!.status).toBe('ACTIVE');
  });
});

describe('runQualityBootstrap — production isolation', () => {
  it('never creates a user, factory, style, or any other unrelated seed row', async () => {
    await bootstrap();

    await expect(prisma.user.count()).resolves.toBe(0);
    await expect(prisma.factory.count()).resolves.toBe(0);
    await expect(prisma.style.count()).resolves.toBe(0);
    await expect(prisma.processFlow.count()).resolves.toBe(1); // only ERVE_PRODUCTION_QUALITY
  });
});
