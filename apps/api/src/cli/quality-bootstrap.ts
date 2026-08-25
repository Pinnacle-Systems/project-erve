// Idempotent, production-safe installer/upgrader for the canonical Quality
// Forms (SAMPLE, PPM, INLINE, FINAL) and the ERVE_PRODUCTION_QUALITY Process
// Flow. Same architectural pattern as admin-bootstrap.ts/roles-bootstrap.ts:
// a pure core function that refuses to touch a production database without
// --confirm-production, wraps every write in one transaction, and never
// depends on any specific User/Role existing.
//
// Unlike the Quality Form / Process Flow HTTP-layer services (which require
// a CurrentUser actor purely to satisfy audit logging), this bootstrap has
// no authenticated actor to attribute changes to. It still records every
// real mutation via the same recordAuditLog()/action-name vocabulary the
// app itself uses, with actorId: null — AuditLog.actorId is nullable
// precisely to support a system-driven change like this one.
import { createId } from '@erve/shared';
import { prisma as defaultPrisma, type Prisma } from '../db/prisma.js';
import {
  qualityFormDefinitionSchema,
  type QualityFormDefinitionInput,
} from '../modules/quality-forms/quality-forms.validation.js';
import { canonicalActivityConfiguration } from '../modules/master-data/master-data.service.js';
import { assertProcessFlowRuntimeSupported } from '../modules/process-flow-runtime/process-flow-runtime-capability.js';
import { recordAuditLog, type AuditLogEntry } from '../audit/audit.service.js';
import { describeDatabaseTarget } from './describe-database-target.js';
import {
  CANONICAL_QUALITY_FORMS,
  CANONICAL_PROCESS_FLOW,
  type CanonicalQualityFormDefinition,
} from './quality-bootstrap-definitions.js';

export class QualityBootstrapError extends Error {}

type PrismaClientInstance = typeof defaultPrisma;

// Deliberately narrow (just $transaction) rather than a full fake-client
// interface: tests use it to force the entire real transaction to roll
// back after it has genuinely run to completion, proving atomicity without
// needing to hand-mock every table this bootstrap touches.
export interface QualityBootstrapPrismaClient {
  $transaction: PrismaClientInstance['$transaction'];
}

export interface QualityBootstrapOptions {
  nodeEnv: string;
  confirmProduction: boolean;
  dryRun?: boolean;
}

export interface QualityBootstrapDeps {
  prisma?: QualityBootstrapPrismaClient;
  databaseUrl: string;
}

// Lifecycle is monotonic: DRAFT -> PUBLISHED -> RETIRED, never backwards. A
// RETIRED (or DRAFT) version that happens to semantically match canonical is
// therefore never reused/republished/reactivated — only the currently
// PUBLISHED/ACTIVE version can produce 'unchanged'; anything else always
// mints a new max+1 version. See HistoricalMatch below for the
// diagnostics-only exception.
export type BootstrapAction = 'unchanged' | 'created_version';

export interface HistoricalMatch {
  versionNumber: number;
  status: 'DRAFT' | 'RETIRED';
}

export interface QualityFormBootstrapOutcome {
  code: string;
  qualityFormId: string;
  action: BootstrapAction;
  versionNumber: number;
  qualityFormVersionId: string;
  retiredVersionNumbers: number[];
  // Diagnostics only: a non-current (DRAFT/RETIRED) version whose content
  // already matches canonical. Never used to decide `action` — surfaced so
  // an operator can see e.g. "this is identical to the old retired v3".
  historicalMatch?: HistoricalMatch;
}

export interface ProcessFlowBootstrapStageOutcome {
  sequence: number;
  code: string;
  name: string;
  activityType: 'PRODUCTION' | 'QUALITY';
  qualityFormCode?: string;
  associatedProductionActivityCode?: string;
  qualityExecutionMode?: string;
  executionMultiplicity?: string;
  coverageTarget?: string;
  qualityAvailabilityPolicy?: string;
  gateSatisfactionRequirement?: string;
}

export interface ProcessFlowBootstrapOutcome {
  code: string;
  processFlowId: string;
  action: BootstrapAction;
  versionNumber: number;
  processFlowVersionId: string;
  retiredVersionNumbers: number[];
  stages: ProcessFlowBootstrapStageOutcome[];
  // Diagnostics only — see QualityFormBootstrapOutcome.historicalMatch.
  historicalMatch?: HistoricalMatch;
}

export interface QualityBootstrapResult {
  dryRun: boolean;
  forms: QualityFormBootstrapOutcome[];
  processFlow: ProcessFlowBootstrapOutcome;
}

// Recursively sorts object keys before JSON.stringify so a `config` JSON
// blob that round-trips through Postgres with reordered keys still compares
// equal to the literal canonical source — the plain-JSON.stringify pattern
// used elsewhere in the app (e.g. replaceProcessFlowVersionStages) doesn't
// guard against this.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function definitionSignature(
  semantics: { activityType: string; executionScope: string },
  sections: QualityFormDefinitionInput['sections'],
): string {
  return stableStringify({
    activityType: semantics.activityType,
    executionScope: semantics.executionScope,
    sections: sections.map((section) => ({
      title: section.title,
      description: section.description || null,
      components: section.components.map((component) => ({
        type: component.type,
        title: component.title,
        description: component.description || null,
        config: component.config,
      })),
    })),
  });
}

function existingDefinitionSignature(version: {
  activityType: string;
  executionScope: string;
  sections: Array<{
    title: string;
    description: string | null;
    components: Array<{ type: string; title: string; description: string | null; config: unknown }>;
  }>;
}): string {
  return stableStringify({
    activityType: version.activityType,
    executionScope: version.executionScope,
    sections: version.sections.map((section) => ({
      title: section.title,
      description: section.description,
      components: section.components.map((component) => ({
        type: component.type,
        title: component.title,
        description: component.description,
        config: component.config,
      })),
    })),
  });
}

function definitionCreate(sections: QualityFormDefinitionInput['sections']) {
  return {
    create: sections.map((section, sectionIndex) => ({
      id: createId(),
      sequence: sectionIndex + 1,
      title: section.title,
      description: section.description || null,
      components: {
        create: section.components.map((component, componentIndex) => ({
          id: createId(),
          sequence: componentIndex + 1,
          type: component.type,
          title: component.title,
          description: component.description || null,
          config: component.config as Prisma.InputJsonValue,
        })),
      },
    })),
  };
}

const qualityFormVersionInclude = {
  sections: {
    orderBy: { sequence: 'asc' as const },
    include: { components: { orderBy: { sequence: 'asc' as const } } },
  },
} satisfies Prisma.QualityFormVersionInclude;

async function resolveQualityForm(
  tx: Prisma.TransactionClient,
  definition: CanonicalQualityFormDefinition,
  parsedSections: QualityFormDefinitionInput['sections'],
  auditEntries: AuditLogEntry[],
): Promise<QualityFormBootstrapOutcome> {
  // Locked by code (not id): the QualityForm row may not exist yet, so an
  // id-keyed lock isn't available up front. Guarantees two concurrent
  // bootstrap runs can't both decide on the same "next version number" for
  // this form.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`quality_form:${definition.code}`}, 0))::text`;

  const form = await tx.qualityForm.upsert({
    where: { code: definition.code },
    update: {},
    create: { id: createId(), code: definition.code, name: definition.name, status: 'ACTIVE' },
  });

  const existingVersions = await tx.qualityFormVersion.findMany({
    where: { qualityFormId: form.id },
    orderBy: { versionNumber: 'desc' },
    include: qualityFormVersionInclude,
  });

  const canonicalSig = definitionSignature(
    { activityType: definition.activityType, executionScope: definition.executionScope },
    parsedSections,
  );

  // Only the currently PUBLISHED version (at most one, enforced by the
  // quality_form_versions_one_published partial unique index) is eligible
  // for reuse. A DRAFT/RETIRED version that happens to match is recorded as
  // a historicalMatch for diagnostics only — it is never republished.
  const currentlyPublished = existingVersions.filter((version) => version.status === 'PUBLISHED');
  const currentPublished = currentlyPublished[0];
  const currentMatches = currentPublished
    ? existingDefinitionSignature(currentPublished) === canonicalSig
    : false;
  const historicalMatch = existingVersions.find(
    (version) => version.status !== 'PUBLISHED' && existingDefinitionSignature(version) === canonicalSig,
  );

  let resolvedVersionId: string;
  let resolvedVersionNumber: number;
  let action: BootstrapAction;
  const retiredVersionNumbers: number[] = [];

  const retirePublished = async (replacedByVersionId: string, keepId?: string) => {
    for (const published of currentlyPublished) {
      if (published.id === keepId) continue;
      await tx.qualityFormVersion.update({ where: { id: published.id }, data: { status: 'RETIRED' } });
      retiredVersionNumbers.push(published.versionNumber);
      auditEntries.push({
        actorId: null,
        action: 'QUALITY_FORM_VERSION_RETIRED',
        entityType: 'QualityFormVersion',
        entityId: published.id,
        metadata: { qualityFormId: form.id, versionNumber: published.versionNumber, replacedByVersionId },
      });
    }
  };

  if (currentPublished && currentMatches) {
    action = 'unchanged';
    resolvedVersionId = currentPublished.id;
    resolvedVersionNumber = currentPublished.versionNumber;
    // Defensive: the partial unique index should make this a no-op, but
    // never leave more than one PUBLISHED row behind if one somehow exists.
    await retirePublished(currentPublished.id, currentPublished.id);
  } else {
    // A partial unique index (quality_form_versions_one_published) allows at
    // most one PUBLISHED row per form — the existing published version must
    // be retired before the replacement is inserted as PUBLISHED, not after.
    const nextVersionNumber = (existingVersions[0]?.versionNumber ?? 0) + 1;
    const pendingId = createId();
    await retirePublished(pendingId);
    const created = await tx.qualityFormVersion.create({
      data: {
        id: pendingId,
        qualityFormId: form.id,
        versionNumber: nextVersionNumber,
        activityType: definition.activityType,
        executionScope: definition.executionScope,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        sections: definitionCreate(parsedSections),
      },
    });
    action = 'created_version';
    resolvedVersionId = created.id;
    resolvedVersionNumber = created.versionNumber;
    auditEntries.push({
      actorId: null,
      action: 'QUALITY_FORM_VERSION_CREATED',
      entityType: 'QualityFormVersion',
      entityId: created.id,
      metadata: {
        qualityFormId: form.id,
        versionNumber: created.versionNumber,
        historicalMatchVersionNumber: historicalMatch?.versionNumber ?? null,
      },
    });
    auditEntries.push({
      actorId: null,
      action: 'QUALITY_FORM_VERSION_PUBLISHED',
      entityType: 'QualityFormVersion',
      entityId: created.id,
      metadata: { qualityFormId: form.id, versionNumber: created.versionNumber },
    });
  }

  return {
    code: definition.code,
    qualityFormId: form.id,
    action,
    versionNumber: resolvedVersionNumber,
    qualityFormVersionId: resolvedVersionId,
    retiredVersionNumbers,
    historicalMatch:
      action === 'created_version' && historicalMatch
        ? { versionNumber: historicalMatch.versionNumber, status: historicalMatch.status as 'DRAFT' | 'RETIRED' }
        : undefined,
  };
}

const processFlowVersionInclude = {
  stages: { orderBy: { sequence: 'asc' as const } },
} satisfies Prisma.ProcessFlowVersionInclude;

type FormDefinitionByCode = Map<
  string,
  { activityType: string; executionScope: string; sections: QualityFormDefinitionInput['sections'] }
>;

async function resolveProcessFlow(
  tx: Prisma.TransactionClient,
  formOutcomes: QualityFormBootstrapOutcome[],
  formDefinitionsByCode: FormDefinitionByCode,
  auditEntries: AuditLogEntry[],
): Promise<ProcessFlowBootstrapOutcome> {
  const formVersionByCode = new Map(formOutcomes.map((outcome) => [outcome.code, outcome.qualityFormVersionId]));

  for (const stage of CANONICAL_PROCESS_FLOW.stages) {
    if (stage.qualityFormCode && !formVersionByCode.get(stage.qualityFormCode)) {
      throw new QualityBootstrapError(
        `Canonical Process Flow stage ${stage.code} references Quality Form ${stage.qualityFormCode}, ` +
          'which was not resolved.',
      );
    }
  }

  // Stage ids are minted fresh every run purely to build this in-memory
  // shape; they are only ever persisted when action === 'created_version'
  // below. associatedProductionActivityId is resolved by matching stable
  // stage `code` (never a raw database id), so this is safe to recompute
  // every run regardless of whether a matching version already exists.
  const stageIds = new Map(CANONICAL_PROCESS_FLOW.stages.map((stage) => [stage.code, createId()]));
  const canonicalStages = CANONICAL_PROCESS_FLOW.stages.map((stage) => ({
    id: stageIds.get(stage.code)!,
    sequence: stage.sequence,
    name: stage.name,
    code: stage.code as string | null,
    status: 'ACTIVE' as const,
    activityType: stage.activityType,
    qualityFormVersionId: stage.qualityFormCode ? (formVersionByCode.get(stage.qualityFormCode) ?? null) : null,
    qualityExecutionMode: stage.qualityExecutionMode ?? null,
    associatedProductionActivityId: stage.associatedProductionActivityCode
      ? (stageIds.get(stage.associatedProductionActivityCode) ?? null)
      : null,
    qualityAvailabilityPolicy: stage.qualityAvailabilityPolicy ?? null,
    progressThresholdPercent: null as number | null,
    gateSatisfactionRequirement: stage.gateSatisfactionRequirement ?? null,
    executionMultiplicity: stage.executionMultiplicity ?? null,
    coverageTarget: stage.coverageTarget ?? null,
  }));

  // Fail fast, before any Process Flow database write, if the canonical
  // shape isn't one the runtime actually knows how to execute — reusing the
  // exact whitelist createJobOrderFromPO already gates on.
  const runtimeCheckStages = canonicalStages.map((stage) => {
    const formCode = CANONICAL_PROCESS_FLOW.stages.find((candidate) => candidate.code === stage.code)!
      .qualityFormCode;
    const formDefinition = formCode ? formDefinitionsByCode.get(formCode) : undefined;
    return {
      ...stage,
      qualityFormVersion: formDefinition
        ? {
            status: 'PUBLISHED',
            activityType: formDefinition.activityType,
            executionScope: formDefinition.executionScope,
            sections: formDefinition.sections,
          }
        : null,
    };
  });
  try {
    assertProcessFlowRuntimeSupported({ stages: runtimeCheckStages });
  } catch (error) {
    throw new QualityBootstrapError(
      `Canonical Process Flow definition is not compatible with the current runtime: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow_identity', 0))::text`;
  const processFlow = await tx.processFlow.upsert({
    where: { code: CANONICAL_PROCESS_FLOW.code },
    update: {},
    create: {
      id: createId(),
      code: CANONICAL_PROCESS_FLOW.code,
      name: CANONICAL_PROCESS_FLOW.name,
      description: CANONICAL_PROCESS_FLOW.description,
      status: 'ACTIVE',
    },
  });

  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`process_flow:${processFlow.id}`}, 0))::text`;

  const existingVersions = await tx.processFlowVersion.findMany({
    where: { processFlowId: processFlow.id },
    orderBy: { versionNumber: 'desc' },
    include: processFlowVersionInclude,
  });

  const canonicalSig = stableStringify(canonicalActivityConfiguration(canonicalStages));

  // Only the currently ACTIVE version (at most one, enforced by the
  // process_flow_versions_single_active_idx partial unique index) is
  // eligible for reuse. A DRAFT/RETIRED version that happens to match is
  // recorded as a historicalMatch for diagnostics only — a historical
  // Process Flow version must never become reassignable to new Job Orders
  // merely because its definition happens to match canonical again.
  const currentlyActive = existingVersions.filter((version) => version.status === 'ACTIVE');
  const currentActive = currentlyActive[0];
  const currentMatches = currentActive
    ? stableStringify(canonicalActivityConfiguration(currentActive.stages)) === canonicalSig
    : false;
  const historicalMatch = existingVersions.find(
    (version) =>
      version.status !== 'ACTIVE' && stableStringify(canonicalActivityConfiguration(version.stages)) === canonicalSig,
  );

  let resolvedVersionId: string;
  let resolvedVersionNumber: number;
  let action: BootstrapAction;
  const retiredVersionNumbers: number[] = [];

  const retireActive = async (replacedByVersionId: string, keepId?: string) => {
    for (const active of currentlyActive) {
      if (active.id === keepId) continue;
      await tx.processFlowVersion.update({ where: { id: active.id }, data: { status: 'RETIRED' } });
      retiredVersionNumbers.push(active.versionNumber);
      auditEntries.push({
        actorId: null,
        action: 'PROCESS_FLOW_VERSION_RETIRED',
        entityType: 'ProcessFlowVersion',
        entityId: active.id,
        metadata: { processFlowId: processFlow.id, replacedByVersionId },
      });
    }
  };

  if (currentActive && currentMatches) {
    action = 'unchanged';
    resolvedVersionId = currentActive.id;
    resolvedVersionNumber = currentActive.versionNumber;
    // Defensive: the partial unique index should make this a no-op, but
    // never leave more than one ACTIVE row behind if one somehow exists.
    await retireActive(currentActive.id, currentActive.id);
  } else {
    const nextVersionNumber = (existingVersions[0]?.versionNumber ?? 0) + 1;
    const versionId = createId();
    await tx.processFlowVersion.create({
      data: { id: versionId, processFlowId: processFlow.id, versionNumber: nextVersionNumber, status: 'DRAFT' },
    });
    await tx.processFlowVersionStage.createMany({
      data: canonicalStages.map((stage) => ({ ...stage, processFlowVersionId: versionId })),
    });
    auditEntries.push({
      actorId: null,
      action: 'PROCESS_FLOW_VERSION_CREATED',
      entityType: 'ProcessFlowVersion',
      entityId: versionId,
      metadata: {
        processFlowId: processFlow.id,
        versionNumber: nextVersionNumber,
        historicalMatchVersionNumber: historicalMatch?.versionNumber ?? null,
      },
    });
    action = 'created_version';
    resolvedVersionId = versionId;
    resolvedVersionNumber = nextVersionNumber;
    // A partial unique index (process_flow_versions_single_active_idx)
    // allows at most one ACTIVE row per flow — retire the current one
    // before activating the replacement, not after.
    await retireActive(versionId);
    await tx.processFlowVersion.update({
      where: { id: versionId },
      data: { status: 'ACTIVE', effectiveFrom: new Date() },
    });
    auditEntries.push({
      actorId: null,
      action: 'PROCESS_FLOW_VERSION_ACTIVATED',
      entityType: 'ProcessFlowVersion',
      entityId: versionId,
      metadata: { processFlowId: processFlow.id, versionNumber: nextVersionNumber },
    });
  }

  return {
    code: processFlow.code,
    processFlowId: processFlow.id,
    action,
    versionNumber: resolvedVersionNumber,
    processFlowVersionId: resolvedVersionId,
    retiredVersionNumbers,
    historicalMatch:
      action === 'created_version' && historicalMatch
        ? { versionNumber: historicalMatch.versionNumber, status: historicalMatch.status as 'DRAFT' | 'RETIRED' }
        : undefined,
    stages: CANONICAL_PROCESS_FLOW.stages.map((stage) => ({
      sequence: stage.sequence,
      code: stage.code,
      name: stage.name,
      activityType: stage.activityType,
      qualityFormCode: stage.qualityFormCode,
      associatedProductionActivityCode: stage.associatedProductionActivityCode,
      qualityExecutionMode: stage.qualityExecutionMode,
      executionMultiplicity: stage.executionMultiplicity,
      coverageTarget: stage.coverageTarget,
      qualityAvailabilityPolicy: stage.qualityAvailabilityPolicy,
      gateSatisfactionRequirement: stage.gateSatisfactionRequirement,
    })),
  };
}

// Rolls the entire (otherwise fully real) transaction back after computing
// a complete result — used only for --dry-run, so a dry run exercises
// exactly the same validation/comparison/write code path a real run would,
// and only ever differs from a real run in that nothing is committed.
class DryRunAbort extends Error {
  constructor(public readonly result: QualityBootstrapResult) {
    super('quality-bootstrap dry run: rolled back, no changes were written');
  }
}

export async function runQualityBootstrap(
  options: QualityBootstrapOptions,
  deps: QualityBootstrapDeps,
): Promise<QualityBootstrapResult> {
  const client: QualityBootstrapPrismaClient = deps.prisma ?? defaultPrisma;

  if (options.nodeEnv === 'production' && !options.confirmProduction) {
    throw new QualityBootstrapError(
      `Target database: ${describeDatabaseTarget(deps.databaseUrl)}\n` +
        'Production execution requires --confirm-production.',
    );
  }

  try {
    return await client.$transaction(
      async (tx) => {
        const auditEntries: AuditLogEntry[] = [];
        const formDefinitionsByCode: FormDefinitionByCode = new Map();
        const formOutcomes: QualityFormBootstrapOutcome[] = [];

        for (const definition of CANONICAL_QUALITY_FORMS) {
          const parsed = qualityFormDefinitionSchema.parse({ sections: definition.sections });
          formDefinitionsByCode.set(definition.code, {
            activityType: definition.activityType,
            executionScope: definition.executionScope,
            sections: parsed.sections,
          });
          formOutcomes.push(await resolveQualityForm(tx, definition, parsed.sections, auditEntries));
        }

        const processFlow = await resolveProcessFlow(tx, formOutcomes, formDefinitionsByCode, auditEntries);

        for (const entry of auditEntries) {
          await recordAuditLog(entry, tx);
        }

        const result: QualityBootstrapResult = {
          dryRun: Boolean(options.dryRun),
          forms: formOutcomes,
          processFlow,
        };

        if (options.dryRun) {
          throw new DryRunAbort(result);
        }
        return result;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof DryRunAbort) {
      return error.result;
    }
    throw error;
  }
}
