// Resolves and "pins" the Process Flow Version a historical import batch
// will reference — once per batch, not per record (H1 plan §6/§12).
//
// A Dev ProcessFlowVersion.id is not portable to Production (separate
// databases, separate primary keys) — so what's pinned here is the
// *logical* identity of the version (its Process Flow's stable code, the
// version number, and a structural fingerprint of its ordered stages),
// with the Dev row's id recorded alongside as this environment's
// resolution of that identity, never in place of it. H2 persists the Dev
// id into Dev's ImportBatch; before H3, Production independently resolves
// the same logical identity against its own master data and verifies the
// fingerprint matches, rather than reusing the Dev primary key.
import { createHash } from 'node:crypto';
import { Prisma, prisma } from '../../db/prisma.js';

type Client = Prisma.TransactionClient | typeof prisma;

export interface ProcessFlowVersionStageFingerprint {
  sequence: number;
  code: string | null;
  name: string;
  status: string;
  activityType: string;
  qualityFormCode: string | null;
  qualityFormVersionNumber: number | null;
  qualityExecutionMode: string | null;
  associatedProductionActivityCode: string | null;
  qualityAvailabilityPolicy: string | null;
  progressThresholdPercent: string | null;
  gateSatisfactionRequirement: string | null;
  executionMultiplicity: string | null;
  coverageTarget: string | null;
}

export interface ProcessFlowVersionLogicalIdentity {
  processFlowCode: string;
  processFlowName: string;
  versionNumber: number;
  stages: ProcessFlowVersionStageFingerprint[];
  /** sha256 of the canonicalized {processFlowCode, versionNumber, stages} — no DB IDs, no timestamps, deterministic stage ordering — so Dev and Production can produce the SAME fingerprint for a logically identical version. */
  fingerprint: string;
}

export interface ProcessFlowVersionPin {
  logicalIdentity: ProcessFlowVersionLogicalIdentity;
  /** This environment's (Dev's) resolution of the logical identity above — never reused as-is in another environment. */
  devProcessFlowVersionId: string;
}

export class ProcessFlowPinError extends Error {}

function canonicalizeStages(
  stages: Array<{
    sequence: number;
    code: string | null;
    name: string;
    status: string;
    activityType: string;
    qualityExecutionMode: string | null;
    qualityAvailabilityPolicy: string | null;
    progressThresholdPercent: Prisma.Decimal | null;
    gateSatisfactionRequirement: string | null;
    executionMultiplicity: string | null;
    coverageTarget: string | null;
    qualityFormVersion: { versionNumber: number; qualityForm: { code: string } } | null;
    associatedProductionActivity: { code: string | null } | null;
  }>,
): ProcessFlowVersionStageFingerprint[] {
  return [...stages]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage) => ({
      sequence: stage.sequence,
      code: stage.code,
      name: stage.name,
      status: stage.status,
      activityType: stage.activityType,
      qualityFormCode: stage.qualityFormVersion?.qualityForm.code ?? null,
      qualityFormVersionNumber: stage.qualityFormVersion?.versionNumber ?? null,
      qualityExecutionMode: stage.qualityExecutionMode,
      associatedProductionActivityCode: stage.associatedProductionActivity?.code ?? null,
      qualityAvailabilityPolicy: stage.qualityAvailabilityPolicy,
      progressThresholdPercent: stage.progressThresholdPercent?.toString() ?? null,
      gateSatisfactionRequirement: stage.gateSatisfactionRequirement,
      executionMultiplicity: stage.executionMultiplicity,
      coverageTarget: stage.coverageTarget,
    }));
}

function computeFingerprint(
  processFlowCode: string,
  versionNumber: number,
  stages: ProcessFlowVersionStageFingerprint[],
): string {
  // Deliberately explicit key order (not spread from an arbitrary source
  // object) so JSON.stringify's output — and therefore the hash — stays
  // stable across environments/runs.
  const canonical = {
    processFlowCode,
    versionNumber,
    stages: stages.map((s) => ({
      sequence: s.sequence,
      code: s.code,
      name: s.name,
      status: s.status,
      activityType: s.activityType,
      qualityFormCode: s.qualityFormCode,
      qualityFormVersionNumber: s.qualityFormVersionNumber,
      qualityExecutionMode: s.qualityExecutionMode,
      associatedProductionActivityCode: s.associatedProductionActivityCode,
      qualityAvailabilityPolicy: s.qualityAvailabilityPolicy,
      progressThresholdPercent: s.progressThresholdPercent,
      gateSatisfactionRequirement: s.gateSatisfactionRequirement,
      executionMultiplicity: s.executionMultiplicity,
      coverageTarget: s.coverageTarget,
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

const stageInclude = {
  qualityFormVersion: { select: { versionNumber: true, qualityForm: { select: { code: true } } } },
  associatedProductionActivity: { select: { code: true } },
} as const;

async function buildLogicalIdentity(
  client: Client,
  version: { id: string; versionNumber: number; processFlow: { code: string; name: string } },
): Promise<ProcessFlowVersionLogicalIdentity> {
  const stages = await client.processFlowVersionStage.findMany({
    where: { processFlowVersionId: version.id },
    include: stageInclude,
  });
  const canonicalStages = canonicalizeStages(stages);
  return {
    processFlowCode: version.processFlow.code,
    processFlowName: version.processFlow.name,
    versionNumber: version.versionNumber,
    stages: canonicalStages,
    fingerprint: computeFingerprint(version.processFlow.code, version.versionNumber, canonicalStages),
  };
}

/**
 * Resolves once per batch: if exactly one ProcessFlowVersion is ACTIVE
 * across all ProcessFlows, it's pinned automatically. If more than one
 * ProcessFlow has an active version, an explicit versionId is required —
 * this never guesses by deriving a version from a parent flow ID.
 */
export async function resolveProcessFlowVersionPin(
  client: Client,
  explicitVersionId?: string,
): Promise<ProcessFlowVersionPin> {
  if (explicitVersionId) {
    const version = await client.processFlowVersion.findUnique({
      where: { id: explicitVersionId },
      include: { processFlow: { select: { code: true, name: true } } },
    });
    if (!version) throw new ProcessFlowPinError(`Process Flow Version "${explicitVersionId}" not found`);
    if (version.status !== 'ACTIVE') {
      throw new ProcessFlowPinError(`Process Flow Version "${explicitVersionId}" is not ACTIVE (status: ${version.status})`);
    }
    return { logicalIdentity: await buildLogicalIdentity(client, version), devProcessFlowVersionId: version.id };
  }

  const activeVersions = await client.processFlowVersion.findMany({
    where: { status: 'ACTIVE' },
    include: { processFlow: { select: { code: true, name: true } } },
  });
  if (activeVersions.length === 0) {
    throw new ProcessFlowPinError('No ACTIVE Process Flow Version exists — cannot pin a Process Flow Version for this batch');
  }
  if (activeVersions.length > 1) {
    const names = activeVersions.map((v) => `${v.processFlow.code} v${v.versionNumber} (${v.id})`).join(', ');
    throw new ProcessFlowPinError(
      `Ambiguous: ${activeVersions.length} ProcessFlows each have an ACTIVE version [${names}] — pass --process-flow-version-id explicitly`,
    );
  }
  const version = activeVersions[0]!;
  return { logicalIdentity: await buildLogicalIdentity(client, version), devProcessFlowVersionId: version.id };
}
