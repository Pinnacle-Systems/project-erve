import { canPerformQaOperation, createId } from '@erve/shared';
import { createHash } from 'node:crypto';
import {
  type AssignedFactoryTaskSummary,
  type JobOrderDetail,
  type PaginatedResponse,
} from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import type { JobOrderStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { getSoleFactoryId } from '../../auth/access.js';
import { HttpError } from '../../errors/http-error.js';
import { normalizeDisclaimerText } from './job-orders.validation.js';
import { evaluateProcessFlowRuntimeSupport } from '../process-flow-runtime/process-flow-runtime-capability.js';
import { deriveJobOrderOperationalState } from './job-order-operational-state.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../master-data/document-number.util.js';
import { toBusinessCalendarDate } from '../master-data/financial-year.util.js';
import { getActiveStyleSizeIds } from '../master-data/style-size.util.js';
import { isOrderSheetEligibleForJobOrder } from '../purchase-orders/purchase-order-eligibility.js';

const jobOrderInclude = {
  seasonSnapshots: { orderBy: [{ financialYear: 'asc' as const }, { name: 'asc' as const }] },
  financialYear: { select: { id: true, code: true } },
  // Always fetched (cheap: at most a handful of rows per Job Order) — the
  // role-aware trim happens in toJobOrderView, not here, so a single query
  // shape serves every viewer without an N+1 lookup.
  orderSheets: {
    select: {
      id: true,
      poNumber: true,
      purchaseMode: true,
      requiredDeliveryDate: true,
      distributor: { select: { id: true, code: true, name: true } },
      lines: {
        select: {
          styleId: true,
          sizes: {
            select: {
              sizeId: true,
              orderedQuantity: true,
              size: { select: { code: true, label: true, sortOrder: true } },
            },
          },
        },
      },
    },
  },
  factory: { select: { id: true, code: true, name: true } },
  processFlowVersion: {
    include: {
      processFlow: { select: { id: true, code: true, name: true } },
      stages: {
        include: {
          qualityFormVersion: {
            include: { qualityForm: { select: { id: true, code: true, name: true } } },
          },
          associatedProductionActivity: { select: { id: true, name: true } },
        },
        orderBy: { sequence: 'asc' as const },
      },
    },
  },
  creator: { select: { id: true, name: true, email: true } },
  confirmer: { select: { id: true, name: true, email: true } },
  lines: {
    include: {
      style: { select: { id: true, styleNumber: true, styleName: true } },
      sizes: {
        include: { size: { select: { id: true, code: true, label: true, sortOrder: true } } },
        orderBy: { size: { sortOrder: 'asc' as const } },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  stageStatuses: {
    include: {
      completer: { select: { id: true, name: true, email: true } },
      processFlowVersionStage: { select: { activityType: true } },
    },
    orderBy: { stageSequence: 'asc' as const },
  },
  acknowledgements: {
    include: { acknowledgedBy: { select: { id: true, name: true, email: true } } },
    orderBy: { acknowledgedAt: 'desc' as const },
  },
  qaReworkTasks: {
    include: {
      sourceLine: {
        include: {
          session: { include: { inspector: { select: { id: true, name: true, email: true } } } },
          evidence: { include: { file: true } },
        },
      },
      acknowledgedBy: { select: { id: true, name: true, email: true } },
      readyBy: { select: { id: true, name: true, email: true } },
      reinspections: { select: { finalizedAt: true }, orderBy: { createdAt: 'desc' as const } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  qualityExecutions: {
    select: {
      id: true,
      processFlowActivityId: true,
      attemptNumber: true,
      batchNumber: true,
      inspectedQuantity: true,
      sampleJobOrderLineSizeId: true,
      sampleQuantity: true,
      status: true,
      version: true,
      outcome: true,
      startedAt: true,
      finalizedAt: true,
      finalQualityBatchId: true,
      startedBy: { select: { id: true, name: true, email: true } },
      finalizedBy: { select: { id: true, name: true, email: true } },
      ppSampleSession: {
        select: {
          id: true,
          forms: {
            select: {
              id: true,
              jobOrderLineSize: { select: { size: { select: { code: true, label: true } } } },
            },
          },
        },
      },
    },
    orderBy: [{ attemptNumber: 'desc' as const }, { batchNumber: 'desc' as const }],
  },
  finalQualityBatches: {
    include: {
      allocations: { include: { jobOrderLineSize: { include: { size: true } } } },
      executions: {
        select: {
          id: true,
          attemptNumber: true,
          inspectedQuantity: true,
          status: true,
          outcome: true,
          outcomeRemarks: true,
          finalizedAt: true,
        },
        orderBy: { attemptNumber: 'asc' as const },
      },
      release: { include: { lines: true } },
      reworks: {
        orderBy: { cycleNumber: 'asc' as const },
        include: {
          acknowledgedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          failedQualityExecution: { select: { id: true, attemptNumber: true } },
        },
      },
    },
    orderBy: { batchNumber: 'asc' as const },
  },
} satisfies Prisma.JobOrderInclude;

type JobOrderRecord = Prisma.JobOrderGetPayload<{ include: typeof jobOrderInclude }>;
type Tx = Prisma.TransactionClient;

function isProcessFlowFinalActivity(activity: {
  status: string;
  activityType: string;
  qualityExecutionMode: string | null;
  executionMultiplicity: string | null;
  coverageTarget: string | null;
  qualityFormVersion: { activityType: string; executionScope: string } | null;
}) {
  return (
    activity.status === 'ACTIVE' &&
    activity.activityType === 'QUALITY' &&
    activity.qualityExecutionMode === 'IN_PROCESS' &&
    activity.executionMultiplicity === 'BATCHED' &&
    activity.coverageTarget === 'PREPARED_QUANTITY' &&
    activity.qualityFormVersion?.activityType === 'INSPECTION' &&
    activity.qualityFormVersion.executionScope === 'JOB_ORDER'
  );
}

function isPreparedQuantityEntryAvailable(
  associated: { status: string } | undefined,
): boolean {
  return associated?.status === 'IN_PROGRESS' || associated?.status === 'COMPLETED';
}

function canManageJobOrders(user: CurrentUser): boolean {
  return user.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER');
}

function canViewAllJobOrders(user: CurrentUser): boolean {
  return user.roles.some(
    (role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT',
  );
}

// Order Sheet <-> Job Order provenance (source Order Sheets, their
// Distributor/Purchase Mode, per-source forecast) is a Merchandising
// planning concern (Order Sheet Phase 2 §4/§23/§24) — Factory and QA must
// never see it, even though they can otherwise view the Job Order itself.
// Reuses the same role set as canViewAllJobOrders: exactly the non-
// operational roles.
const canViewOrderSheetProvenance = canViewAllJobOrders;

function canFactoryManage(user: CurrentUser, factoryId: string): boolean {
  return (
    user.roles.includes('FACTORY_USER') &&
    user.factoryIds.length === 1 &&
    user.factoryIds[0] === factoryId
  );
}

function assertJobOrderViewAccess(
  user: CurrentUser,
  jobOrder: { factoryId: string; status: JobOrderStatus },
): void {
  if (canViewAllJobOrders(user)) return;
  // QA has global Job Order visibility under the established authorization
  // matrix because configured Quality activities are interwoven with Production.
  if (canPerformQaOperation(user)) return;
  if (canFactoryManage(user, jobOrder.factoryId) && jobOrder.status !== 'DRAFT') return;
  throw HttpError.forbidden('You do not have access to this job order');
}

// Ordinary role authorization for mutating an existing job order's
// factory-side workflow (confirm / complete-stage / update-prepared-quantity):
// admins and merchandisers may always act, in line with their normal
// oversight permissions; a factory user only for their own mapped factory.
// This carries no factory-status opinion — that is a separate concern,
// checked below only for the factory-user path.
function assertJobOrderWorkflowAuthorization(user: CurrentUser, factoryId: string): void {
  if (!canManageJobOrders(user) && !canFactoryManage(user, factoryId)) {
    throw HttpError.forbidden('You cannot update this factory job order');
  }
}

// Active-factory requirement for factory-user workflow mutations. A factory
// user loses the ability to advance production at their factory the moment
// it is deactivated — reactivation restores it immediately, since factory
// status is read fresh on every call. Admins and merchandisers are exempt:
// deactivation blocks new assignments to the factory (see
// createJobOrder / sendJobOrderToFactory), not their ability to
// administratively resolve work that already exists there.
async function assertFactoryUserFactoryActive(user: CurrentUser, factoryId: string): Promise<void> {
  if (canManageJobOrders(user)) return;
  const factory = await prisma.factory.findUnique({
    where: { id: factoryId },
    select: { status: true },
  });
  if (!factory || factory.status !== 'ACTIVE') {
    throw HttpError.conflict('This factory is inactive and cannot perform new operational actions');
  }
}

function totalOrdered(jobOrder: JobOrderRecord): number {
  return jobOrder.lines.reduce((sum, line) => sum + line.orderedQuantityTotal, 0);
}

function toStageView(stage: JobOrderRecord['stageStatuses'][number]) {
  return {
    id: stage.id,
    processFlowVersionStageId: stage.processFlowVersionStageId,
    stageSequence: stage.stageSequence,
    stageNameSnapshot: stage.stageNameSnapshot,
    status: stage.status,
    completedBy: stage.completer,
    completedAt: stage.completedAt?.toISOString() ?? null,
    remarks: stage.remarks,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
  };
}

function decimalHundredths(value: Prisma.Decimal): bigint {
  const [whole, fraction = ''] = value.toFixed(2).split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function isProgressThresholdMet(
  completedQuantity: number,
  plannedQuantity: number,
  threshold: Prisma.Decimal,
): boolean {
  if (plannedQuantity <= 0) return false;
  return (
    BigInt(completedQuantity) * 10_000n >= BigInt(plannedQuantity) * decimalHundredths(threshold)
  );
}

function mapFinalBatchReworks(reworks: JobOrderRecord['finalQualityBatches'][number]['reworks']) {
  return reworks.map((rework) => ({
    id: rework.id,
    cycleNumber: rework.cycleNumber,
    status: rework.status,
    failedQualityExecutionId: rework.failedQualityExecutionId,
    failedAttemptNumber: rework.failedQualityExecution.attemptNumber,
    notes: rework.notes,
    acknowledgedBy: rework.acknowledgedBy,
    acknowledgedAt: rework.acknowledgedAt?.toISOString() ?? null,
    startedBy: rework.startedBy,
    startedAt: rework.startedAt?.toISOString() ?? null,
    completedBy: rework.completedBy,
    completedAt: rework.completedAt?.toISOString() ?? null,
    version: rework.version,
    createdAt: rework.createdAt.toISOString(),
    updatedAt: rework.updatedAt.toISOString(),
  }));
}

function toQualityActivityViews(jobOrder: JobOrderRecord) {
  const runtimeByDefinitionId = new Map(
    jobOrder.stageStatuses.map((runtime) => [runtime.processFlowVersionStageId, runtime]),
  );
  const definitions = jobOrder.processFlowVersion.stages;
  return definitions
    .filter((activity) => activity.status === 'ACTIVE' && activity.activityType === 'QUALITY')
    .map((activity) => {
      const executions = jobOrder.qualityExecutions.filter(
        (item) => item.processFlowActivityId === activity.id && item.status !== 'CANCELLED',
      );
      const execution = executions[0];
      const associated = activity.associatedProductionActivityId
        ? runtimeByDefinitionId.get(activity.associatedProductionActivityId)
        : undefined;
      const previous = [...definitions]
        .reverse()
        .find(
          (candidate) =>
            candidate.sequence < activity.sequence &&
            candidate.status === 'ACTIVE' &&
            (candidate.activityType === 'PRODUCTION' ||
              candidate.qualityExecutionMode === 'SEQUENTIAL_GATE'),
        );
      const previousRuntime = previous ? runtimeByDefinitionId.get(previous.id) : undefined;
      let eligible = false;
      if (activity.qualityAvailabilityPolicy === 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE') {
        eligible =
          associated?.status === 'IN_PROGRESS' ||
          (isProcessFlowFinalActivity(activity) && associated?.status === 'COMPLETED');
      } else if (activity.qualityAvailabilityPolicy === 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES') {
        eligible = associated?.status === 'COMPLETED';
      } else if (
        activity.qualityAvailabilityPolicy === 'PROGRESS_PERCENTAGE' &&
        associated &&
        associated.completedQuantity !== null &&
        activity.progressThresholdPercent
      ) {
        eligible = isProgressThresholdMet(
          associated.completedQuantity,
          totalOrdered(jobOrder),
          activity.progressThresholdPercent,
        );
      } else if (activity.qualityExecutionMode === 'SEQUENTIAL_GATE') {
        eligible = previous
          ? previous.activityType === 'PRODUCTION'
            ? previousRuntime?.status === 'COMPLETED'
            : previous.gateSatisfactionRequirement === 'OUTCOME_PASS'
              ? jobOrder.qualityExecutions.some(
                  (candidate) =>
                    candidate.processFlowActivityId === previous.id &&
                    candidate.status === 'FINALIZED' &&
                    candidate.outcome === 'PASS',
                )
              : jobOrder.qualityExecutions.some(
                  (candidate) =>
                    candidate.processFlowActivityId === previous.id &&
                    candidate.status === 'FINALIZED',
                )
          : jobOrder.factoryConfirmationStatus === 'CONFIRMED';
      }
      const physicalBatches = jobOrder.finalQualityBatches.filter(
        (batch) => batch.processFlowActivityId === activity.id && batch.disposition !== 'CANCELLED',
      );
      const inspectionActivityQuantity = physicalBatches
        .flatMap((batch) => batch.executions)
        .filter((attempt) => attempt.status === 'FINALIZED')
        .reduce((sum, attempt) => sum + (attempt.inspectedQuantity ?? 0), 0);
      const reservedForFinalQuantity = physicalBatches.reduce(
        (sum, batch) => sum + batch.physicalQuantity,
        0,
      );
      const inspectedPhysicalCoverage = physicalBatches
        .filter((batch) => batch.executions.some((attempt) => attempt.status === 'FINALIZED'))
        .reduce((sum, batch) => sum + batch.physicalQuantity, 0);
      const resolvedPhysicalCoverage = physicalBatches
        .filter((batch) => ['RELEASED', 'PERMANENTLY_REJECTED'].includes(batch.disposition))
        .reduce((sum, batch) => sum + batch.physicalQuantity, 0);
      const preparedQuantityAuthoritative = jobOrder.preparedQuantityTotal > 0;
      const reconciliationConflict =
        preparedQuantityAuthoritative && reservedForFinalQuantity > jobOrder.preparedQuantityTotal;
      const coverageCompleteSoFar =
        preparedQuantityAuthoritative &&
        resolvedPhysicalCoverage === jobOrder.preparedQuantityTotal;
      const releasedQuantity = physicalBatches.reduce(
        (sum, batch) =>
          sum + (batch.release?.lines.reduce((lineSum, line) => lineSum + line.quantity, 0) ?? 0),
        0,
      );
      const permanentlyRejectedQuantity = physicalBatches
        .filter((batch) => batch.disposition === 'PERMANENTLY_REJECTED')
        .reduce((sum, batch) => sum + batch.physicalQuantity, 0);
      const awaitingReinspectionQuantity = physicalBatches
        .filter((batch) => batch.disposition === 'AWAITING_REINSPECTION')
        .reduce((sum, batch) => sum + batch.physicalQuantity, 0);
      const finalQaComplete =
        jobOrder.productionCompletedAt !== null &&
        coverageCompleteSoFar &&
        awaitingReinspectionQuantity === 0 &&
        physicalBatches.every((batch) =>
          ['RELEASED', 'PERMANENTLY_REJECTED'].includes(batch.disposition),
        );
      const passedBatches = physicalBatches.filter(
        (batch) => batch.disposition === 'RELEASED',
      ).length;
      const failedBatches = physicalBatches.filter((batch) =>
        batch.executions.some(
          (attempt) => attempt.status === 'FINALIZED' && attempt.outcome === 'FAIL',
        ),
      ).length;
      const missed =
        executions.length === 0 &&
        activity.qualityAvailabilityPolicy === 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' &&
        associated?.status === 'COMPLETED' &&
        !isProcessFlowFinalActivity(activity);
      const formVersion = activity.qualityFormVersion!;
      return {
        processFlowVersionStageId: activity.id,
        sequence: activity.sequence,
        name: activity.name,
        status: execution
          ? execution.status === 'DRAFT'
            ? ('IN_PROGRESS' as const)
            : activity.gateSatisfactionRequirement === 'OUTCOME_PASS' &&
                execution.outcome !== 'PASS'
              ? ('FAILED' as const)
              : activity.executionMultiplicity === 'BATCHED' && !finalQaComplete
                ? ('IN_PROGRESS' as const)
                : ('COMPLETED' as const)
          : missed
            ? ('MISSED' as const)
            : eligible
              ? ('AVAILABLE' as const)
              : ('NOT_AVAILABLE' as const),
        eligible,
        qualityForm: { ...formVersion.qualityForm, executionScope: formVersion.executionScope },
        qualityFormVersion: { id: formVersion.id, versionNumber: formVersion.versionNumber },
        executionMode: activity.qualityExecutionMode!,
        associatedProductionActivity: activity.associatedProductionActivity,
        availabilityPolicy:
          activity.qualityExecutionMode === 'SEQUENTIAL_GATE'
            ? ('SEQUENTIAL_PREDECESSOR_COMPLETED' as const)
            : activity.qualityAvailabilityPolicy!,
        progressThresholdPercent: activity.progressThresholdPercent?.toFixed(2) ?? null,
        gateSatisfactionRequirement: activity.gateSatisfactionRequirement,
        executionMultiplicity: activity.executionMultiplicity!,
        coverageTarget: activity.coverageTarget,
        coverage:
          activity.executionMultiplicity === 'BATCHED'
            ? {
                preparedQuantityAuthoritative,
                preparedQuantity: preparedQuantityAuthoritative
                  ? jobOrder.preparedQuantityTotal
                  : null,
                inspectedQuantity: inspectionActivityQuantity,
                inspectionActivityQuantity,
                reservedForFinalQuantity,
                inspectedPhysicalCoverage,
                resolvedPhysicalCoverage,
                physicalFinalCoverage: inspectedPhysicalCoverage,
                releasedQuantity,
                permanentlyRejectedQuantity,
                awaitingReinspectionQuantity,
                remainingQuantity: preparedQuantityAuthoritative
                  ? Math.max(0, jobOrder.preparedQuantityTotal - resolvedPhysicalCoverage)
                  : null,
                availableForNewFinalBatch: preparedQuantityAuthoritative
                  ? Math.max(0, jobOrder.preparedQuantityTotal - reservedForFinalQuantity)
                  : null,
                complete: coverageCompleteSoFar,
                coverageCompleteSoFar,
                finalQaComplete,
                reconciliationConflict,
                state: reconciliationConflict
                  ? ('CONFLICT' as const)
                  : coverageCompleteSoFar
                    ? ('COMPLETE' as const)
                    : preparedQuantityAuthoritative
                      ? ('IN_PROGRESS' as const)
                      : ('UNKNOWN' as const),
                passedBatches,
                failedBatches,
                hasFailedBatches: failedBatches > 0,
                availableBySize: jobOrder.lines.flatMap((line) =>
                  line.sizes.map((size) => {
                    const allocated = physicalBatches
                      .flatMap((batch) => batch.allocations)
                      .filter((allocation) => allocation.jobOrderLineSizeId === size.id)
                      .reduce((sum, allocation) => sum + allocation.quantity, 0);
                    return {
                      jobOrderLineSizeId: size.id,
                      sizeCode: size.size.code,
                      sizeLabel: size.size.label,
                      preparedQuantity: size.preparedQuantity,
                      allocatedQuantity: allocated,
                      availableQuantity: Math.max(0, size.preparedQuantity - allocated),
                    };
                  }),
                ),
                batches: physicalBatches.map((batch) => ({
                  id: batch.id,
                  batchNumber: batch.batchNumber,
                  physicalQuantity: batch.physicalQuantity,
                  inspectedQuantity: batch.executions.some(
                    (attempt) => attempt.status === 'FINALIZED',
                  )
                    ? batch.physicalQuantity
                    : 0,
                  disposition: batch.disposition,
                  status: batch.executions.some((attempt) => attempt.status === 'DRAFT')
                    ? ('DRAFT' as const)
                    : ('FINALIZED' as const),
                  outcome:
                    batch.executions.filter((attempt) => attempt.status === 'FINALIZED').at(-1)
                      ?.outcome ?? null,
                  finalizedAt:
                    batch.executions
                      .filter((attempt) => attempt.status === 'FINALIZED')
                      .at(-1)
                      ?.finalizedAt?.toISOString() ?? null,
                  allocations: batch.allocations.map((allocation) => ({
                    jobOrderLineSizeId: allocation.jobOrderLineSizeId,
                    quantity: allocation.quantity,
                  })),
                  attemptCount: batch.executions.length,
                  reworks: mapFinalBatchReworks(batch.reworks),
                })),
              }
            : null,
        execution: execution
          ? {
              id: execution.id,
              attemptNumber: execution.attemptNumber,
              batchNumber: execution.batchNumber,
              inspectedQuantity: execution.inspectedQuantity,
              status: execution.status,
              version: execution.version,
              outcome: execution.outcome,
              startedAt: execution.startedAt.toISOString(),
              finalizedAt: execution.finalizedAt?.toISOString() ?? null,
            }
          : null,
        executionHistory: executions.map((candidate) => ({
          id: candidate.id,
          attemptNumber: candidate.attemptNumber,
          batchNumber: candidate.batchNumber,
          inspectedQuantity: candidate.inspectedQuantity,
          sampleJobOrderLineSizeId: candidate.sampleJobOrderLineSizeId,
          sampleQuantity: candidate.sampleQuantity,
          sampleSizeCode: candidate.ppSampleSession?.forms[0]?.jobOrderLineSize.size.code ?? null,
          sampleSizeLabel: candidate.ppSampleSession?.forms[0]?.jobOrderLineSize.size.label ?? null,
          ppSampleSessionId: candidate.ppSampleSession?.id ?? null,
          ppSampleFormId: candidate.ppSampleSession?.forms[0]?.id ?? null,
          status: candidate.status,
          outcome: candidate.outcome,
          startedBy: candidate.startedBy,
          finalizedBy: candidate.finalizedBy,
          startedAt: candidate.startedAt.toISOString(),
          finalizedAt: candidate.finalizedAt?.toISOString() ?? null,
        })),
      };
    });
}

function toJobOrderView(
  jobOrder: JobOrderRecord,
  options: { includeSourceOrderSheets: boolean },
): JobOrderDetail {
  const plannedQuantity = totalOrdered(jobOrder);
  const stages = jobOrder.stageStatuses
    .filter((stage) => stage.processFlowVersionStage.activityType === 'PRODUCTION')
    .map((stage) => toStageView(stage));
  const qualityActivities = toQualityActivityViews(jobOrder);
  const processFlowFinal = qualityActivities.find(
    (activity) =>
      activity.executionMultiplicity === 'BATCHED' &&
      activity.coverageTarget === 'PREPARED_QUANTITY',
  );
  const processFlowFinalDefinition = processFlowFinal
    ? jobOrder.processFlowVersion.stages.find(
        (stage) => stage.id === processFlowFinal.processFlowVersionStageId,
      )
    : undefined;
  const preparedAssociatedRuntime = processFlowFinalDefinition?.associatedProductionActivityId
    ? jobOrder.stageStatuses.find(
        (stage) =>
          stage.processFlowVersionStageId ===
          processFlowFinalDefinition.associatedProductionActivityId,
      )
    : undefined;
  const acknowledgements = jobOrder.acknowledgements.map((acknowledgement) => ({
    id: acknowledgement.id,
    jobOrderVersion: acknowledgement.jobOrderVersion,
    disclaimerRevision: acknowledgement.disclaimerRevision,
    disclaimerTextSnapshot: acknowledgement.disclaimerTextSnapshot,
    disclaimerSha256: acknowledgement.disclaimerSha256,
    factoryIdSnapshot: acknowledgement.factoryIdSnapshot,
    acknowledgedBy: acknowledgement.acknowledgedBy,
    acknowledgedByRole: acknowledgement.acknowledgedByRole,
    acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
    invalidatedAt: acknowledgement.invalidatedAt?.toISOString() ?? null,
    invalidatedByUserId: acknowledgement.invalidatedByUserId,
    invalidationReason: acknowledgement.invalidationReason,
    invalidationMetadata: acknowledgement.invalidationMetadata,
  }));
  // Combined forecast: sum of every source Order Sheet's per-size demand,
  // keyed by sizeId. Purely informational (§8/§10) — never used to
  // constrain jobOrder.lines' own quantities.
  const forecastBySizeId = new Map<
    string,
    { sizeId: string; sizeCode: string; sizeLabel: string; forecastQuantity: number }
  >();
  for (const orderSheet of jobOrder.orderSheets) {
    for (const line of orderSheet.lines) {
      for (const size of line.sizes) {
        const existing = forecastBySizeId.get(size.sizeId);
        if (existing) {
          existing.forecastQuantity += size.orderedQuantity;
        } else {
          forecastBySizeId.set(size.sizeId, {
            sizeId: size.sizeId,
            sizeCode: size.size.code,
            sizeLabel: size.size.label,
            forecastQuantity: size.orderedQuantity,
          });
        }
      }
    }
  }
  return {
    id: jobOrder.id,
    jobOrderNumber: jobOrder.jobOrderNumber,
    financialYear: jobOrder.financialYear,
    factory: jobOrder.factory,
    processFlowVersion: {
      id: jobOrder.processFlowVersion.id,
      versionNumber: jobOrder.processFlowVersion.versionNumber,
      status: jobOrder.processFlowVersion.status,
      processFlow: jobOrder.processFlowVersion.processFlow,
    },
    status: jobOrder.status,
    preparedQuantityEntry: {
      available: processFlowFinalDefinition
        ? isPreparedQuantityEntryAvailable(preparedAssociatedRuntime)
        : false,
      processFlowActivityId: processFlowFinal?.processFlowVersionStageId ?? null,
      associatedProductionActivity: processFlowFinal?.associatedProductionActivity ?? null,
    },
    operationalState: deriveJobOrderOperationalState({
      status: jobOrder.status,
      factoryConfirmationStatus: jobOrder.factoryConfirmationStatus,
      stages,
      qualityActivities,
    }),
    factoryConfirmationStatus: jobOrder.factoryConfirmationStatus,
    requiredDeliveryDate: jobOrder.requiredDeliveryDate?.toISOString() ?? null,
    deliveryDateLocked: jobOrder.factoryConfirmationStatus === 'CONFIRMED',
    sourceOrderSheetCount: jobOrder.orderSheets.length,
    unitPrice: jobOrder.unitPrice.toNumber(),
    seasonSnapshots: jobOrder.seasonSnapshots.map((season) => ({
      seasonId: season.seasonId,
      code: season.code,
      name: season.name,
      financialYear: season.financialYear,
      displayName: season.displayName,
    })),
    confirmedBy: jobOrder.confirmer,
    confirmedAt: jobOrder.confirmedAt?.toISOString() ?? null,
    disclaimerText: jobOrder.disclaimerText,
    disclaimerRevision: jobOrder.disclaimerRevision,
    acknowledgement: acknowledgements[0] ?? null,
    acknowledgements,
    productionStartedAt: jobOrder.productionStartedAt?.toISOString() ?? null,
    productionCompletedAt: jobOrder.productionCompletedAt?.toISOString() ?? null,
    orderedQuantityTotal: plannedQuantity,
    preparedQuantityTotal: jobOrder.preparedQuantityTotal,
    creator: jobOrder.creator,
    sourceOrderSheets: options.includeSourceOrderSheets
      ? jobOrder.orderSheets.map((orderSheet) => {
          const line = orderSheet.lines[0];
          const forecastBySize = (line?.sizes ?? []).map((size) => ({
            sizeId: size.sizeId,
            sizeCode: size.size.code,
            sizeLabel: size.size.label,
            orderedQuantity: size.orderedQuantity,
          }));
          return {
            id: orderSheet.id,
            poNumber: orderSheet.poNumber,
            distributor: orderSheet.distributor,
            purchaseMode: orderSheet.purchaseMode,
            requiredDeliveryDate: orderSheet.requiredDeliveryDate?.toISOString() ?? null,
            styleId: line?.styleId ?? '',
            forecastBySize,
            forecastTotal: forecastBySize.reduce((sum, size) => sum + size.orderedQuantity, 0),
          };
        })
      : undefined,
    combinedForecast: options.includeSourceOrderSheets
      ? [...forecastBySizeId.values()]
      : undefined,
    lines: jobOrder.lines.map((line) => ({
      id: line.id,
      styleId: line.styleId,
      styleNumber: line.style.styleNumber,
      styleName: line.style.styleName,
      orderedQuantityTotal: line.orderedQuantityTotal,
      preparedQuantityTotal: line.preparedQuantityTotal,
      status: line.status,
      sizes: line.sizes.map((size) => ({
        id: size.id,
        sizeId: size.sizeId,
        sizeCode: size.size.code,
        sizeLabel: size.size.label,
        orderedQuantity: size.orderedQuantity,
        preparedQuantity: size.preparedQuantity,
        varianceQuantity: size.preparedQuantity - size.orderedQuantity,
      })),
    })),
    stages,
    qualityActivities,
    reworkTasks: jobOrder.qaReworkTasks.map((task) => {
      const context = jobOrder.lines
        .flatMap((line) => line.sizes.map((size) => ({ line, size })))
        .find(({ size }) => size.id === task.jobOrderLineSizeId)!;
      return {
        id: task.id,
        jobOrderId: jobOrder.id,
        jobOrderNumber: jobOrder.jobOrderNumber,
        jobOrderLineSizeId: task.jobOrderLineSizeId,
        styleNumber: context.line.style.styleNumber,
        styleName: context.line.style.styleName,
        sizeCode: context.size.size.code,
        sizeLabel: context.size.size.label,
        assignedQuantity: task.assignedQuantity,
        attemptNumber: task.attemptNumber,
        status: task.status,
        defectCategory: task.sourceLine.defectCategory,
        otherDefectDetails: task.sourceLine.otherDefectDetails,
        defectNotes: task.sourceLine.defectNotes,
        qaRemarks: task.sourceLine.inspectionRemarks,
        qaEvidence: task.sourceLine.evidence.map((evidence) => ({
          id: evidence.id,
          inspectionLineId: evidence.inspectionLineId,
          fileName: evidence.file.fileName,
          contentType: evidence.file.mimeType,
          sizeBytes: evidence.file.sizeBytes,
          createdAt: evidence.createdAt.toISOString(),
        })),
        requestedBy: task.sourceLine.session.inspector,
        requestedAt: (task.sourceLine.finalizedAt ?? task.createdAt).toISOString(),
        factoryNotes: task.notes,
        acknowledgedBy: task.acknowledgedBy,
        acknowledgedAt: task.acknowledgedAt?.toISOString() ?? null,
        readyBy: task.readyBy,
        readyAt: task.readyAt?.toISOString() ?? null,
        reinspectedAt: task.reinspections[0]?.finalizedAt?.toISOString() ?? null,
        version: task.version,
        updatedAt: task.updatedAt.toISOString(),
      };
    }),
    finalBatchReworks: jobOrder.finalQualityBatches
      .filter((batch) => batch.disposition === 'AWAITING_REINSPECTION' && batch.reworks.length > 0)
      .map((batch) => {
        const cycles = mapFinalBatchReworks(batch.reworks);
        const current = cycles[cycles.length - 1]!;
        const failedAttempt = batch.executions
          .filter((attempt) => attempt.status === 'FINALIZED')
          .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
        const activity = jobOrder.processFlowVersion.stages.find(
          (stage) => stage.id === batch.processFlowActivityId,
        );
        return {
          id: current.id,
          finalQualityBatchId: batch.id,
          jobOrderId: jobOrder.id,
          jobOrderNumber: jobOrder.jobOrderNumber,
          processFlowActivityId: batch.processFlowActivityId,
          activityName: activity?.name ?? '',
          batchNumber: batch.batchNumber,
          physicalQuantity: batch.physicalQuantity,
          allocations: batch.allocations.map((allocation) => ({
            jobOrderLineSizeId: allocation.jobOrderLineSizeId,
            sizeCode: allocation.jobOrderLineSize.size.code,
            sizeLabel: allocation.jobOrderLineSize.size.label,
            quantity: allocation.quantity,
          })),
          cycleNumber: current.cycleNumber,
          status: current.status,
          failedAttemptNumber: current.failedAttemptNumber,
          failedAt: failedAttempt?.finalizedAt?.toISOString() ?? null,
          qaRemarks: failedAttempt?.outcomeRemarks ?? null,
          notes: current.notes,
          acknowledgedBy: current.acknowledgedBy,
          acknowledgedAt: current.acknowledgedAt,
          startedBy: current.startedBy,
          startedAt: current.startedAt,
          completedBy: current.completedBy,
          completedAt: current.completedAt,
          previousCycles: cycles.slice(0, -1),
          version: current.version,
          updatedAt: current.updatedAt,
        };
      }),
    createdAt: jobOrder.createdAt.toISOString(),
    updatedAt: jobOrder.updatedAt.toISOString(),
    version: jobOrder.version,
  };
}

// The JO's Financial Year is derived from its own createdAt (it has no
// separate document-date field) — never inherited from its parent Purchase
// Order. Serial comes from the FY-scoped DocumentSequence high-water mark.
async function generateJobOrderNumber(
  client: Tx,
  financialYear: { id: string; code: string },
): Promise<{ jobOrderNumber: string; jobOrderSerial: number }> {
  const jobOrderSerial = await allocateDocumentSerial(client, 'JOB_ORDER', financialYear.id);
  return {
    jobOrderNumber: formatDocumentNumber(DOCUMENT_PREFIXES.JOB_ORDER, financialYear.code, jobOrderSerial),
    jobOrderSerial,
  };
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function disclaimerSha256(disclaimerText: string): string {
  return createHash('sha256').update(disclaimerText, 'utf8').digest('hex');
}

async function beginIdempotentOperation(
  tx: Tx,
  actorId: string,
  jobOrderId: string,
  operation: string,
  idempotencyKey: string,
  hash: string,
): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actorId}:${operation}:${idempotencyKey}`}))`;
  const existing = await tx.jobOrderIdempotencyRecord.findUnique({
    where: { actorId_operation_idempotencyKey: { actorId, operation, idempotencyKey } },
  });
  if (!existing) return false;
  if (existing.jobOrderId !== jobOrderId || existing.requestHash !== hash) {
    throw HttpError.idempotencyKeyReused();
  }
  return true;
}

async function finishIdempotentOperation(
  tx: Tx,
  actorId: string,
  jobOrderId: string,
  operation: string,
  idempotencyKey: string,
  hash: string,
  resultVersion: number,
): Promise<void> {
  await tx.jobOrderIdempotencyRecord.create({
    data: {
      id: createId(),
      actorId,
      jobOrderId,
      operation,
      idempotencyKey,
      requestHash: hash,
      resultVersion,
    },
  });
}

// updatePurchaseOrderJobOrderedStatus (retired): PARTIALLY_JOB_ORDERED/
// FULLY_JOB_ORDERED status rollup no longer applies — an Order Sheet's
// "included in Job Order" state is now the DistributorPurchaseOrder.jobOrderId
// claim above, not a status transition (see createJobOrder).

export async function getJobOrderList(
  user: CurrentUser,
  filters: {
    search?: string;
    status?: JobOrderStatus;
    factoryId?: string;
    financialYearId?: string;
    cursor?: string;
    limit: number;
  },
) {
  if (user.roles.includes('DISTRIBUTOR') || user.roles.includes('ACCOUNTANT')) {
    throw HttpError.forbidden('You do not have access to job orders');
  }

  const where: Prisma.JobOrderWhereInput = {
    status: filters.status,
    factoryId:
      canViewAllJobOrders(user) || canPerformQaOperation(user)
        ? filters.factoryId
        : { in: user.factoryIds },
    // This JO's own Financial Year — never any source Order Sheet's.
    financialYearId: filters.financialYearId,
    // Order Sheet number search stays available to every viewer who can
    // list job orders — it's a filter predicate, not response data, so it
    // carries no provenance leak even for Factory/QA (see
    // canViewOrderSheetProvenance, which gates response *content* only).
    OR: filters.search
      ? [
          { jobOrderNumber: { contains: filters.search, mode: 'insensitive' } },
          { orderSheets: { some: { poNumber: { contains: filters.search, mode: 'insensitive' } } } },
        ]
      : undefined,
  };

  const jobOrders = await prisma.jobOrder.findMany({
    where,
    include: jobOrderInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = jobOrders.length > filters.limit;
  const page = hasMore ? jobOrders.slice(0, filters.limit) : jobOrders;
  const includeSourceOrderSheets = canViewOrderSheetProvenance(user);
  return {
    items: page.map((record) => toJobOrderView(record, { includeSourceOrderSheets })),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getAssignedFactoryTasks(
  user: CurrentUser,
  filters: { search?: string; status?: JobOrderStatus; cursor?: string; limit: number },
): Promise<PaginatedResponse<AssignedFactoryTaskSummary>> {
  const factoryId = getSoleFactoryId(user);
  const operationalStatuses: JobOrderStatus[] = [
    'SENT_TO_FACTORY',
    'CONFIRMED_BY_FACTORY',
    'IN_PRODUCTION',
    'PRODUCTION_COMPLETE',
    'READY_FOR_QA',
    'QA_IN_PROGRESS',
    'QA_PASSED',
    'PARTIALLY_QA_PASSED',
    'CLOSED',
    'CANCELLED',
  ];
  const visibleStatuses = filters.status
    ? operationalStatuses.includes(filters.status)
      ? [filters.status]
      : []
    : operationalStatuses;
  const records = await prisma.jobOrder.findMany({
    where: {
      factoryId,
      status: { in: visibleStatuses },
      // Factory identifies work by Job Order Number only — no Order Sheet/
      // Purchase Order provenance is exposed to this role (§22), so search
      // matches only that.
      OR: filters.search
        ? [{ jobOrderNumber: { contains: filters.search, mode: 'insensitive' } }]
        : undefined,
    },
    include: jobOrderInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map((record) => {
      // Factory never receives Order Sheet/Distributor planning provenance
      // (§22) — includeSourceOrderSheets: false here regardless of the
      // caller's own role, since this whole endpoint is Factory-only.
      const view = toJobOrderView(record, { includeSourceOrderSheets: false });
      const currentStage = view.stages.find((stage) => stage.status !== 'COMPLETED');
      return {
        id: record.id,
        jobOrderNumber: record.jobOrderNumber,
        factory: record.factory,
        status: record.status,
        operationalState: view.operationalState,
        currentStage: currentStage
          ? {
              id: currentStage.id,
              sequence: currentStage.stageSequence,
              name: currentStage.stageNameSnapshot,
            }
          : null,
        orderedQuantityTotal: record.lines.reduce(
          (sum, line) => sum + line.orderedQuantityTotal,
          0,
        ),
        preparedQuantityTotal: record.preparedQuantityTotal,
        requiredDeliveryDate: record.requiredDeliveryDate?.toISOString() ?? null,
        version: record.version,
        updatedAt: record.updatedAt.toISOString(),
        actionRequired: [
          'SENT_TO_FACTORY',
          'CONFIRMED_BY_FACTORY',
          'IN_PRODUCTION',
          'PRODUCTION_COMPLETE',
        ].includes(record.status),
        finalBatchReworkRequired: view.finalBatchReworks.some(
          (item) => item.status !== 'COMPLETED',
        ),
      };
    }),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getJobOrderDetail(user: CurrentUser, id: string) {
  const jobOrder = await prisma.jobOrder.findUnique({ where: { id }, include: jobOrderInclude });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderViewAccess(user, jobOrder);
  return toJobOrderView(jobOrder, { includeSourceOrderSheets: canViewOrderSheetProvenance(user) });
}

export async function getProcessFlowQualityWork(user: CurrentUser) {
  if (!canPerformQaOperation(user))
    throw HttpError.forbidden('Only QA operations users may view QA work');
  const jobs = await prisma.jobOrder.findMany({
    where: {
      factoryConfirmationStatus: 'CONFIRMED',
      processFlowVersion: {
        stages: { some: { status: 'ACTIVE', activityType: 'QUALITY' } },
      },
    },
    include: jobOrderInclude,
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return jobs.flatMap((job) =>
    toQualityActivityViews(job)
      .filter(
        (activity) =>
          activity.status !== 'NOT_AVAILABLE' || activity.coverage?.reconciliationConflict === true,
      )
      .map((activity) => ({
        jobOrderId: job.id,
        jobOrderNumber: job.jobOrderNumber,
        factory: job.factory,
        activity,
      })),
  );
}

// Resolves and validates the set of source Order Sheets shared by
// createJobOrder and updateDraftJobOrderSources: every id must exist, be
// eligible (not cancelled, not already mapped), have exactly one Style
// line (structurally guaranteed by the Order Sheet model, checked
// defensively), and share one Style across the whole set (existingStyleId,
// when given, is folded into that check — used by the DRAFT edit path,
// where the Job Order's Style is already fixed by its existing lines).
async function loadAndValidateOrderSheetSources(
  tx: Tx,
  orderSheetIds: string[],
  existingStyleId?: string,
) {
  if (new Set(orderSheetIds).size !== orderSheetIds.length) {
    throw HttpError.badRequest('Duplicate Order Sheets are not allowed');
  }
  const orderSheets = await tx.distributorPurchaseOrder.findMany({
    where: { id: { in: orderSheetIds } },
    include: { lines: { include: { sizes: true, seasonSnapshots: true } } },
  });
  if (orderSheets.length !== orderSheetIds.length) {
    throw HttpError.badRequest('One or more Order Sheets were not found');
  }
  for (const orderSheet of orderSheets) {
    if (!isOrderSheetEligibleForJobOrder(orderSheet.status)) {
      throw HttpError.badRequest(
        `Order Sheet ${orderSheet.poNumber} cannot be job ordered in its current status`,
      );
    }
    if (orderSheet.jobOrderId) {
      throw HttpError.badRequest(
        `Order Sheet ${orderSheet.poNumber} is already linked to a Job Order`,
      );
    }
    if (orderSheet.lines.length !== 1) {
      throw HttpError.badRequest(`Order Sheet ${orderSheet.poNumber} must have exactly one Style line`);
    }
  }
  const styleIds = new Set([
    ...(existingStyleId ? [existingStyleId] : []),
    ...orderSheets.map((orderSheet) => orderSheet.lines[0]!.styleId),
  ]);
  if (styleIds.size !== 1) {
    throw HttpError.badRequest('All source Order Sheets (and the Job Order) must share one Style');
  }
  return orderSheets;
}

// The Job Order's Production Plan validator (Phase 2.1) — shared by
// createJobOrder and updateDraftJobOrderPlan. Sizes are validated against
// the Style's own canonical valid-size set (getActiveStyleSizeIds), never
// against any source Order Sheet's forecast — the production plan is fully
// independent of Order Sheet provenance (§1/§4/§6).
//
// `existingSizes`, when given (updateDraftJobOrderPlan only), carries the
// Job Order's current JobOrderLineSize rows. A size that is no longer in
// the Style's active set but already exists there is allowed through
// UNCHANGED (same quantity) — see the inactive-existing-size handling
// below — never as a route to silently changing or newly adding an
// inactive size.
async function validateProductionPlanSizes(
  tx: Tx,
  styleId: string,
  sizes: Array<{ sizeId: string; quantity: number }>,
  existingSizes?: Array<{ sizeId: string; sizeCode: string; orderedQuantity: number }>,
): Promise<void> {
  if (sizes.length === 0) {
    throw HttpError.badRequest('The Production Plan must include at least one size');
  }
  const seen = new Set<string>();
  for (const size of sizes) {
    if (!Number.isInteger(size.quantity) || size.quantity < 0) {
      throw HttpError.badRequest('Production Plan quantities must be non-negative whole numbers');
    }
    if (seen.has(size.sizeId)) {
      throw HttpError.badRequest('Duplicate sizes are not allowed in the Production Plan');
    }
    seen.add(size.sizeId);
  }
  const activeSizeIds = await getActiveStyleSizeIds(tx, styleId);
  const existingBySizeId = new Map((existingSizes ?? []).map((size) => [size.sizeId, size]));
  for (const size of sizes) {
    if (activeSizeIds.has(size.sizeId)) continue;
    const existing = existingBySizeId.get(size.sizeId);
    if (!existing) {
      throw HttpError.badRequest('Size is not valid for this Style');
    }
    if (existing.orderedQuantity !== size.quantity) {
      throw HttpError.badRequest(
        `Size ${existing.sizeCode} is no longer active for this Style; its existing quantity of ${existing.orderedQuantity} cannot be changed here`,
      );
    }
  }
  const total = sizes.reduce((sum, size) => sum + size.quantity, 0);
  if (total <= 0) {
    throw HttpError.badRequest('The Production Plan must include at least one size with a quantity greater than 0');
  }
}

// Creates the Job Order's single production-plan line (Phase 2.1: exactly
// one JobOrderLine per Job Order, independent of source Order Sheet count —
// see JobOrderLine's schema comment).
async function createJobOrderLine(
  tx: Tx,
  jobOrderId: string,
  styleId: string,
  sizes: Array<{ sizeId: string; quantity: number }>,
) {
  await validateProductionPlanSizes(tx, styleId, sizes);
  const orderedQuantityTotal = sizes.reduce((sum, size) => sum + size.quantity, 0);
  await tx.jobOrderLine.create({
    data: {
      id: createId(),
      jobOrderId,
      styleId,
      orderedQuantityTotal,
      sizes: {
        create: sizes.map((size) => ({
          id: createId(),
          sizeId: size.sizeId,
          orderedQuantity: size.quantity,
        })),
      },
    },
  });
}

export async function createJobOrder(
  actor: CurrentUser,
  input: {
    orderSheetIds: string[];
    factoryId: string;
    processFlowVersionId: string;
    unitPrice: string;
    disclaimerText?: string;
    requiredDeliveryDate?: string | null;
    sizes: Array<{ sizeId: string; quantity: number }>;
  },
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can create job orders');

  const orderSheetIds = input.orderSheetIds;
  if (orderSheetIds.length === 0) {
    throw HttpError.badRequest('At least one Order Sheet is required');
  }

  const [factory, processFlowVersion] = await Promise.all([
    prisma.factory.findUnique({ where: { id: input.factoryId } }),
    prisma.processFlowVersion.findUnique({
      where: { id: input.processFlowVersionId },
      include: {
        stages: {
          include: {
            qualityFormVersion: {
              include: { sections: { include: { components: true } } },
            },
          },
        },
      },
    }),
  ]);
  if (!factory) throw HttpError.badRequest('Factory not found');
  if (factory.status !== 'ACTIVE') throw HttpError.badRequest('Factory is not active');
  if (!processFlowVersion) throw HttpError.badRequest('Process flow version not found');
  if (processFlowVersion.status !== 'ACTIVE')
    throw HttpError.badRequest('Process flow version must be ACTIVE');
  const runtimeSupport = evaluateProcessFlowRuntimeSupport(processFlowVersion);
  if (!runtimeSupport.supported)
    throw HttpError.badRequest(
      `Process Flow version is not supported by the Job Order runtime: ${runtimeSupport.reasons.join(' ')}`,
    );

  const jobOrderId = createId();
  let jobOrderNumber = '';

  await prisma.$transaction(async (tx) => {
    const orderSheets = await loadAndValidateOrderSheetSources(tx, orderSheetIds);
    const sharedStyleId = orderSheets[0]!.lines[0]!.styleId;

    // Delivery date: an explicit value always wins; otherwise every
    // selected Order Sheet must agree on one date (§7) — no invented
    // earliest/latest/average when they don't.
    let requiredDeliveryDate: Date | null;
    if (input.requiredDeliveryDate) {
      requiredDeliveryDate = new Date(input.requiredDeliveryDate);
    } else {
      const distinctDates = new Set(
        orderSheets.map((orderSheet) => orderSheet.requiredDeliveryDate?.toISOString().slice(0, 10) ?? ''),
      );
      if (distinctDates.size === 1) {
        const only = orderSheets[0]!.requiredDeliveryDate;
        requiredDeliveryDate = only ?? null;
      } else {
        throw HttpError.badRequest(
          'Selected Order Sheets have different Required Delivery Dates; specify the Job Order delivery date explicitly',
        );
      }
    }

    // Job Order has no separate business/document date — capture one
    // timestamp and use that exact value for both the persisted createdAt
    // and Financial Year resolution, so the two can never disagree. The JO
    // never inherits any source Order Sheet's Financial Year.
    const createdAt = new Date();
    const financialYear = await ensureFinancialYear(tx, toBusinessCalendarDate(createdAt));
    const generated = await generateJobOrderNumber(tx, financialYear);
    jobOrderNumber = generated.jobOrderNumber;
    await tx.jobOrder.create({
      data: {
        id: jobOrderId,
        jobOrderNumber,
        factoryId: input.factoryId,
        processFlowVersionId: input.processFlowVersionId,
        unitPrice: new Prisma.Decimal(input.unitPrice),
        disclaimerText: input.disclaimerText || null,
        disclaimerRevision: input.disclaimerText ? 1 : 0,
        requiredDeliveryDate,
        createdBy: actor.id,
        createdAt,
        financialYearId: financialYear.id,
        jobOrderSerial: generated.jobOrderSerial,
        seasonSnapshots: {
          create: [
            ...new Map(
              orderSheets.flatMap((orderSheet) =>
                orderSheet.lines[0]!.seasonSnapshots.map((season) => [
                  season.seasonId ?? season.id,
                  {
                    id: createId(),
                    seasonId: season.seasonId,
                    code: season.code,
                    name: season.name,
                    financialYear: season.financialYear,
                    displayName: season.displayName,
                  },
                ]),
              ),
            ).values(),
          ],
        },
      },
    });

    // Atomically claim every selected Order Sheet: only succeeds if all of
    // them are still unmapped (jobOrderId == null) at this instant. If any
    // one lost the race to a concurrent Job Order creation, claimed.count
    // falls short and the whole transaction rolls back — no partial
    // mapping (§12).
    const claimed = await tx.distributorPurchaseOrder.updateMany({
      where: { id: { in: orderSheetIds }, jobOrderId: null },
      data: { jobOrderId },
    });
    if (claimed.count !== orderSheetIds.length) {
      throw HttpError.conflict(
        'One or more selected Order Sheets were just linked to another Job Order; reload and try again',
      );
    }

    await createJobOrderLine(tx, jobOrderId, sharedStyleId, input.sizes);

    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_CREATED',
        entityType: 'JobOrder',
        entityId: jobOrderId,
        metadata: {
          jobOrderNumber,
          orderSheetNumbers: orderSheets.map((orderSheet) => orderSheet.poNumber),
          factoryId: input.factoryId,
          disclaimerRevision: input.disclaimerText ? 1 : 0,
          disclaimerSha256: input.disclaimerText ? disclaimerSha256(input.disclaimerText) : null,
        },
      },
      tx,
    );
  });

  return getJobOrderDetail(actor, jobOrderId);
}

// Order Sheet Phase 2/2.1 §14: the source Order Sheet set is editable while
// the Job Order is DRAFT (freezes at SENT_TO_FACTORY, enforced below by the
// `status !== 'DRAFT'` check). Adds and removes are applied atomically in
// one transaction and are PURE planning-provenance changes (Phase 2.1) —
// they only ever mutate DistributorPurchaseOrder.jobOrderId, never the Job
// Order's own JobOrderLine/JobOrderLineSize production plan, which this
// function does not touch at all (§8/§9/§15: source edits never change
// production quantities).
export async function updateDraftJobOrderSources(
  actor: CurrentUser,
  id: string,
  input: {
    expectedVersion: number;
    add: string[];
    remove: string[];
  },
  idempotencyKey: string,
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can edit job order source Order Sheets');
  if (input.add.length === 0 && input.remove.length === 0) {
    throw HttpError.badRequest('At least one Order Sheet addition or removal is required');
  }
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'UPDATE_SOURCES', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({
      where: { id },
      include: {
        orderSheets: { select: { id: true, poNumber: true } },
        lines: { select: { styleId: true } },
      },
    });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
    if (jobOrder.status !== 'DRAFT') {
      throw HttpError.conflict(
        'Source Order Sheets can only be changed while the job order is a draft; the mapping is frozen once it is sent to factory',
      );
    }

    const currentOrderSheetIds = new Set(jobOrder.orderSheets.map((orderSheet) => orderSheet.id));
    const addIds = input.add;
    for (const removeId of input.remove) {
      if (!currentOrderSheetIds.has(removeId)) {
        throw HttpError.badRequest('Order Sheet is not currently mapped to this Job Order');
      }
    }
    if (new Set([...input.remove]).size !== input.remove.length) {
      throw HttpError.badRequest('Duplicate Order Sheets are not allowed');
    }
    for (const addId of addIds) {
      if (currentOrderSheetIds.has(addId)) {
        throw HttpError.badRequest('Order Sheet is already mapped to this Job Order');
      }
    }
    const resultingCount = currentOrderSheetIds.size - input.remove.length + addIds.length;
    if (resultingCount < 1) {
      throw HttpError.badRequest('A Job Order must retain at least one source Order Sheet');
    }

    // Every added source must share the Job Order's own, already-
    // authoritative Style (never merely "agree with each other") — the Job
    // Order's Style/production plan is never touched or reinterpreted by a
    // source-mapping change.
    const existingStyleId = jobOrder.lines[0]?.styleId;
    const addedOrderSheets = addIds.length
      ? await loadAndValidateOrderSheetSources(tx, addIds, existingStyleId)
      : [];

    if (input.remove.length) {
      const released = await tx.distributorPurchaseOrder.updateMany({
        where: { id: { in: input.remove }, jobOrderId: id },
        data: { jobOrderId: null },
      });
      if (released.count !== input.remove.length) {
        throw HttpError.conflict('Failed to release one or more Order Sheets; reload and try again');
      }
    }

    if (addIds.length) {
      const claimed = await tx.distributorPurchaseOrder.updateMany({
        where: { id: { in: addIds }, jobOrderId: null },
        data: { jobOrderId: id },
      });
      if (claimed.count !== addIds.length) {
        throw HttpError.conflict(
          'One or more Order Sheets were just linked to another Job Order; reload and try again',
        );
      }
    }

    const updated = await tx.jobOrder.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_SOURCES_UPDATED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: {
          addedOrderSheetNumbers: addedOrderSheets.map((orderSheet) => orderSheet.poNumber),
          removedOrderSheetNumbers: jobOrder.orderSheets
            .filter((orderSheet) => input.remove.includes(orderSheet.id))
            .map((orderSheet) => orderSheet.poNumber),
        },
      },
      tx,
    );
    await finishIdempotentOperation(tx, actor.id, id, 'UPDATE_SOURCES', idempotencyKey, hash, updated.version);
  });
  return getJobOrderDetail(actor, id);
}

// Phase 2.1: the sole way to set/change the Job Order's own production-plan
// quantities once created. DRAFT-only. Fully replaces the size set each
// call — safe because DRAFT necessarily precedes factory confirmation, so
// no JobOrderLineSize can yet carry a prepared quantity or a Final QA
// allocation — except for sizes that have since become invalid for the
// Style (removeStyleSize is a hard delete with no usage guard, or the
// underlying Size was deactivated): those are preserved unless the caller
// tries to change their quantity (see validateProductionPlanSizes).
export async function updateDraftJobOrderPlan(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; sizes: Array<{ sizeId: string; quantity: number }> },
  idempotencyKey: string,
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can edit the job order production plan');
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'UPDATE_PRODUCTION_PLAN', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({
      where: { id },
      include: {
        lines: { include: { sizes: { include: { size: true } } } },
      },
    });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
    if (jobOrder.status !== 'DRAFT') {
      throw HttpError.conflict('The production plan can only be changed while the job order is a draft');
    }
    const line = jobOrder.lines[0];
    if (!line) throw HttpError.conflict('Job order has no production line');

    const existingSizes = line.sizes.map((size) => ({
      sizeId: size.sizeId,
      sizeCode: size.size.code,
      orderedQuantity: size.orderedQuantity,
    }));
    await validateProductionPlanSizes(tx, line.styleId, input.sizes, existingSizes);

    const before = existingSizes.map((size) => ({
      sizeId: size.sizeId,
      sizeCode: size.sizeCode,
      quantity: size.orderedQuantity,
    }));

    const existingSizeIds = new Set(line.sizes.map((size) => size.sizeId));
    const inputSizeIds = new Set(input.sizes.map((size) => size.sizeId));
    const activeSizeIds = await getActiveStyleSizeIds(tx, line.styleId);

    // Delete sizes that are active but no longer in the submitted plan.
    // Inactive existing sizes omitted from the input are left untouched
    // (see validateProductionPlanSizes's inactive-size carve-out).
    const toDelete = line.sizes.filter(
      (size) => !inputSizeIds.has(size.sizeId) && activeSizeIds.has(size.sizeId),
    );
    if (toDelete.length) {
      await tx.jobOrderLineSize.deleteMany({ where: { id: { in: toDelete.map((size) => size.id) } } });
    }

    for (const size of input.sizes) {
      if (existingSizeIds.has(size.sizeId)) {
        await tx.jobOrderLineSize.update({
          where: { jobOrderLineId_sizeId: { jobOrderLineId: line.id, sizeId: size.sizeId } },
          data: { orderedQuantity: size.quantity },
        });
      } else {
        await tx.jobOrderLineSize.create({
          data: { id: createId(), jobOrderLineId: line.id, sizeId: size.sizeId, orderedQuantity: size.quantity },
        });
      }
    }

    const freshSizes = await tx.jobOrderLineSize.findMany({
      where: { jobOrderLineId: line.id },
      include: { size: true },
    });
    const orderedQuantityTotal = freshSizes.reduce((sum, size) => sum + size.orderedQuantity, 0);
    await tx.jobOrderLine.update({ where: { id: line.id }, data: { orderedQuantityTotal } });

    const updated = await tx.jobOrder.update({ where: { id }, data: { version: { increment: 1 } } });

    const after = freshSizes.map((size) => ({
      sizeId: size.sizeId,
      sizeCode: size.size.code,
      quantity: size.orderedQuantity,
    }));
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_PRODUCTION_PLAN_UPDATED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: { before, after },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'UPDATE_PRODUCTION_PLAN',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function updateJobOrderDeliveryDate(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; requiredDeliveryDate: string | null },
  idempotencyKey: string,
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can edit the job order delivery date');
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'UPDATE_DELIVERY_DATE', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({ where: { id } });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
    // Delivery date locks at factory confirmation — a separate, later
    // lifecycle point from the source Order Sheet mapping freeze at
    // SENT_TO_FACTORY (§16).
    if (jobOrder.factoryConfirmationStatus === 'CONFIRMED') {
      throw HttpError.conflict('The delivery date is locked once the factory has confirmed this job order');
    }
    const updated = await tx.jobOrder.update({
      where: { id },
      data: {
        requiredDeliveryDate: input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null,
        version: { increment: 1 },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_DELIVERY_DATE_CHANGED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: { requiredDeliveryDate: input.requiredDeliveryDate },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'UPDATE_DELIVERY_DATE',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function updateDraftJobOrderDisclaimer(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; disclaimerText: string },
  idempotencyKey: string,
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can edit a job order disclaimer');
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'UPDATE_DISCLAIMER', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({ where: { id } });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
    if (jobOrder.status !== 'DRAFT')
      throw HttpError.conflict('The disclaimer can only be changed while the job order is a draft');
    const disclaimerText = input.disclaimerText;
    const priorText = jobOrder.disclaimerText ?? '';
    const changed = disclaimerText !== priorText;
    const updated = await tx.jobOrder.update({
      where: { id },
      data: {
        disclaimerText: disclaimerText || null,
        disclaimerRevision: changed ? { increment: 1 } : undefined,
        version: { increment: 1 },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: priorText ? 'JOB_ORDER_DISCLAIMER_CHANGED' : 'JOB_ORDER_DISCLAIMER_SET',
        entityType: 'JobOrder',
        entityId: id,
        metadata: {
          disclaimerRevision: updated.disclaimerRevision,
          changed,
          disclaimerSha256: disclaimerText ? disclaimerSha256(disclaimerText) : null,
        },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'UPDATE_DISCLAIMER',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function sendJobOrderToFactory(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number },
  idempotencyKey: string,
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can send job orders');
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'SEND_TO_FACTORY', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({
      where: { id },
      include: { factory: { select: { status: true } } },
    });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
    if (jobOrder.status !== 'DRAFT')
      throw HttpError.badRequest('Only DRAFT job orders can be sent to factory');
    const normalizedDisclaimer = jobOrder.disclaimerText
      ? normalizeDisclaimerText(jobOrder.disclaimerText)
      : '';
    if (!normalizedDisclaimer) throw HttpError.disclaimerRequired();
    if (jobOrder.factory.status !== 'ACTIVE')
      throw HttpError.conflict('An inactive factory cannot receive a job order');
    const updated = await tx.jobOrder.update({
      where: { id },
      data: { status: 'SENT_TO_FACTORY', version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_SENT_TO_FACTORY',
        entityType: 'JobOrder',
        entityId: id,
        metadata: {
          jobOrderNumber: jobOrder.jobOrderNumber,
          disclaimerRevision: jobOrder.disclaimerRevision,
          disclaimerSha256: disclaimerSha256(normalizedDisclaimer),
        },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'SEND_TO_FACTORY',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function confirmJobOrder(
  actor: CurrentUser,
  id: string,
  input: {
    expectedVersion: number;
    expectedDisclaimerRevision: number;
    acknowledgeDisclaimer?: boolean;
  },
  idempotencyKey: string,
) {
  const initial = await prisma.jobOrder.findUnique({ where: { id }, select: { factoryId: true } });
  if (!initial) throw HttpError.notFound('Job order not found');
  if (!canFactoryManage(actor, initial.factoryId))
    throw HttpError.forbidden(
      'Only the mapped factory user can acknowledge and confirm this job order',
    );
  await assertFactoryUserFactoryActive(actor, initial.factoryId);
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'CONFIRM', idempotencyKey, hash)) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({
      where: { id },
      include: {
        processFlowVersion: {
          include: {
            stages: {
              where: { status: 'ACTIVE', activityType: 'PRODUCTION' },
              orderBy: { sequence: 'asc' },
            },
          },
        },
        factory: { select: { status: true } },
      },
    });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (!canFactoryManage(actor, jobOrder.factoryId))
      throw HttpError.forbidden(
        'Only the mapped factory user can acknowledge and confirm this job order',
      );
    if (jobOrder.factory.status !== 'ACTIVE')
      throw HttpError.conflict(
        'This factory is inactive and cannot perform new operational actions',
      );
    if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
    if (jobOrder.status !== 'SENT_TO_FACTORY')
      throw HttpError.badRequest('Only sent job orders can be confirmed');
    if (jobOrder.disclaimerRevision !== input.expectedDisclaimerRevision)
      throw HttpError.staleDisclaimerRevision(jobOrder.disclaimerRevision);
    if (input.acknowledgeDisclaimer !== true) throw HttpError.acknowledgementRequired();
    const normalizedDisclaimer = jobOrder.disclaimerText
      ? normalizeDisclaimerText(jobOrder.disclaimerText)
      : '';
    if (!normalizedDisclaimer) throw HttpError.disclaimerRequired();
    const acknowledgementId = createId();
    const acknowledgedAt = new Date();
    const disclaimerHash = disclaimerSha256(normalizedDisclaimer);
    await tx.jobOrderAcknowledgement.create({
      data: {
        id: acknowledgementId,
        jobOrderId: id,
        jobOrderVersion: jobOrder.version,
        disclaimerRevision: jobOrder.disclaimerRevision,
        disclaimerTextSnapshot: normalizedDisclaimer,
        disclaimerSha256: disclaimerHash,
        factoryIdSnapshot: jobOrder.factoryId,
        acknowledgedByUserId: actor.id,
        acknowledgedByRole: 'FACTORY_USER',
        acknowledgedAt,
      },
    });
    const updated = await tx.jobOrder.update({
      where: { id },
      data: {
        status: 'CONFIRMED_BY_FACTORY',
        factoryConfirmationStatus: 'CONFIRMED',
        confirmedBy: actor.id,
        confirmedAt: acknowledgedAt,
        version: { increment: 1 },
      },
    });
    await tx.jobOrderStageStatus.createMany({
      data: jobOrder.processFlowVersion.stages
        .filter((stage) => stage.activityType === 'PRODUCTION')
        .map((stage) => ({
          id: createId(),
          jobOrderId: id,
          processFlowVersionStageId: stage.id,
          stageSequence: stage.sequence,
          stageNameSnapshot: stage.name,
        })),
      skipDuplicates: true,
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_DISCLAIMER_ACKNOWLEDGED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: {
          acknowledgementId,
          jobOrderVersion: jobOrder.version,
          disclaimerRevision: jobOrder.disclaimerRevision,
          disclaimerSha256: disclaimerHash,
          factoryId: jobOrder.factoryId,
          acknowledgedByRole: 'FACTORY_USER',
        },
      },
      tx,
    );
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_FACTORY_CONFIRMED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: { jobOrderNumber: jobOrder.jobOrderNumber, acknowledgementId },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'CONFIRM',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function completeProductionStage(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; stageStatusId: string; remarks?: string | null },
  idempotencyKey: string,
) {
  const hash = requestHash(input);
  const replay = await prisma.jobOrderIdempotencyRecord.findUnique({
    where: {
      actorId_operation_idempotencyKey: {
        actorId: actor.id,
        operation: 'COMPLETE_STAGE',
        idempotencyKey,
      },
    },
  });
  if (replay) {
    if (replay.jobOrderId !== id || replay.requestHash !== hash)
      throw HttpError.idempotencyKeyReused();
    return getJobOrderDetail(actor, id);
  }
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: {
      stageStatuses: {
        include: { processFlowVersionStage: true },
        orderBy: { stageSequence: 'asc' },
      },
      lines: { select: { orderedQuantityTotal: true } },
      processFlowVersion: { include: { stages: true } },
      qualityExecutions: {
        select: { processFlowActivityId: true, status: true, outcome: true },
      },
    },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
  if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
  if (!['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status)) {
    throw HttpError.badRequest(
      'Production stages can only be completed after factory confirmation',
    );
  }

  const blockingStages = jobOrder.stageStatuses;
  const nextStage = blockingStages.find((stage) => stage.status !== 'COMPLETED');
  if (!nextStage) throw HttpError.badRequest('All production stages are already completed');
  const unsatisfiedGate = jobOrder.processFlowVersion.stages.find(
    (stage) =>
      stage.status === 'ACTIVE' &&
      stage.qualityExecutionMode === 'SEQUENTIAL_GATE' &&
      stage.sequence < nextStage.stageSequence &&
      !jobOrder.qualityExecutions.some(
        (execution) =>
          execution.processFlowActivityId === stage.id &&
          execution.status === 'FINALIZED' &&
          (stage.gateSatisfactionRequirement === 'FINALIZED' || execution.outcome === 'PASS'),
      ),
  );
  if (unsatisfiedGate)
    throw HttpError.conflict(
      'Production is locked pending completion of the pre-production Quality gate',
    );
  if (nextStage.id !== input.stageStatusId)
    throw HttpError.badRequest('Production stages must be completed in sequence');
  if (nextStage.status !== 'IN_PROGRESS')
    throw HttpError.badRequest('Production stage must be started before it can be completed');
  const isFinalStage = nextStage.id === blockingStages[blockingStages.length - 1]?.id;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'COMPLETE_STAGE', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const currentVersion = await tx.jobOrder.findUnique({
      where: { id },
      select: { version: true },
    });
    if (!currentVersion) throw HttpError.notFound('Job order not found');
    if (currentVersion.version !== input.expectedVersion)
      throw HttpError.staleVersion(currentVersion.version);
    const stageUpdated = await tx.jobOrderStageStatus.updateMany({
      where: { id: input.stageStatusId, status: { not: 'COMPLETED' } },
      data: {
        status: 'COMPLETED',
        completedBy: actor.id,
        completedAt: now,
        remarks: input.remarks ?? null,
      },
    });
    if (stageUpdated.count !== 1) throw HttpError.staleVersion(jobOrder.version);
    const updated = await tx.jobOrder.update({
      where: { id },
      data: {
        status: isFinalStage ? 'PRODUCTION_COMPLETE' : 'IN_PRODUCTION',
        productionStartedAt: jobOrder.productionStartedAt ?? now,
        productionCompletedAt: isFinalStage ? now : undefined,
        version: { increment: 1 },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_STAGE_COMPLETED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: {
          stageStatusId: input.stageStatusId,
          processFlowVersionStageId: nextStage.processFlowVersionStageId,
          stageSequence: nextStage.stageSequence,
          stageName: nextStage.stageNameSnapshot,
        },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'COMPLETE_STAGE',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function startProductionStage(
  actor: CurrentUser,
  id: string,
  input: { expectedVersion: number; stageStatusId: string },
  idempotencyKey: string,
) {
  const hash = requestHash(input);
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: {
      stageStatuses: {
        include: { processFlowVersionStage: true },
        orderBy: { stageSequence: 'asc' },
      },
      processFlowVersion: { include: { stages: true } },
      qualityExecutions: {
        select: { processFlowActivityId: true, status: true, outcome: true },
      },
    },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
  if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
  if (!['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status))
    throw HttpError.badRequest('Production stages can only be started after factory confirmation');
  const nextStage = jobOrder.stageStatuses.find((stage) => stage.status !== 'COMPLETED');
  if (!nextStage) throw HttpError.badRequest('All production stages are already completed');
  const unsatisfiedGate = jobOrder.processFlowVersion.stages.find(
    (stage) =>
      stage.status === 'ACTIVE' &&
      stage.qualityExecutionMode === 'SEQUENTIAL_GATE' &&
      stage.sequence < nextStage.stageSequence &&
      !jobOrder.qualityExecutions.some(
        (execution) =>
          execution.processFlowActivityId === stage.id &&
          execution.status === 'FINALIZED' &&
          (stage.gateSatisfactionRequirement === 'FINALIZED' || execution.outcome === 'PASS'),
      ),
  );
  if (unsatisfiedGate)
    throw HttpError.conflict(
      'Production is locked pending completion of the pre-production Quality gate',
    );
  if (nextStage.id !== input.stageStatusId)
    throw HttpError.badRequest('Production stages must be started in sequence');

  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'START_STAGE', idempotencyKey, hash))
      return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const current = await tx.jobOrder.findUnique({ where: { id }, select: { version: true } });
    if (!current) throw HttpError.notFound('Job order not found');
    if (current.version !== input.expectedVersion) throw HttpError.staleVersion(current.version);
    const runtime = await tx.jobOrderStageStatus.findUniqueOrThrow({
      where: { id: input.stageStatusId },
    });
    if (runtime.jobOrderId !== id)
      throw HttpError.badRequest('Production stage does not belong to this job order');
    if (runtime.status === 'IN_PROGRESS') {
      await finishIdempotentOperation(
        tx,
        actor.id,
        id,
        'START_STAGE',
        idempotencyKey,
        hash,
        current.version,
      );
      return;
    }
    if (runtime.status !== 'NOT_STARTED')
      throw HttpError.badRequest('Production stage cannot be started');
    const now = new Date();
    await tx.jobOrderStageStatus.update({
      where: { id: runtime.id },
      data: { status: 'IN_PROGRESS' },
    });
    const updated = await tx.jobOrder.update({
      where: { id },
      data: {
        status: 'IN_PRODUCTION',
        productionStartedAt: jobOrder.productionStartedAt ?? now,
        version: { increment: 1 },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_STAGE_STARTED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: {
          stageStatusId: runtime.id,
          processFlowVersionStageId: runtime.processFlowVersionStageId,
          stageSequence: runtime.stageSequence,
          stageName: runtime.stageNameSnapshot,
        },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'START_STAGE',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function updatePreparedQuantity(
  actor: CurrentUser,
  id: string,
  input: {
    expectedVersion: number;
    sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }>;
  },
  idempotencyKey: string,
) {
  const hash = requestHash(input);
  const replay = await prisma.jobOrderIdempotencyRecord.findUnique({
    where: {
      actorId_operation_idempotencyKey: {
        actorId: actor.id,
        operation: 'UPDATE_PREPARED_QUANTITY',
        idempotencyKey,
      },
    },
  });
  if (replay) {
    if (replay.jobOrderId !== id || replay.requestHash !== hash)
      throw HttpError.idempotencyKeyReused();
    return getJobOrderDetail(actor, id);
  }
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: {
      lines: { include: { sizes: true } },
      stageStatuses: true,
      processFlowVersion: {
        include: {
          stages: {
            include: { qualityFormVersion: true },
          },
        },
      },
    },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
  if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
  const finalActivity = jobOrder.processFlowVersion.stages.find(isProcessFlowFinalActivity);
  if (!finalActivity)
    throw HttpError.conflict('The Job Order Process Flow has no supported Final activity');
  const associated = jobOrder.stageStatuses.find(
    (stage) => stage.processFlowVersionStageId === finalActivity.associatedProductionActivityId,
  );
  if (!isPreparedQuantityEntryAvailable(associated))
    throw HttpError.conflict(
      'Prepared quantity becomes available when the configured Final-associated Production activity starts',
    );

  const allowedSizeIds = new Set(
    jobOrder.lines.flatMap((line) => line.sizes.map((size) => size.id)),
  );
  const seenSizeIds = new Set<string>();
  for (const size of input.sizes) {
    if (!allowedSizeIds.has(size.jobOrderLineSizeId)) {
      throw HttpError.badRequest('Prepared quantity line size does not belong to this job order');
    }
    if (seenSizeIds.has(size.jobOrderLineSizeId)) {
      throw HttpError.badRequest('Duplicate prepared quantity sizes are not allowed');
    }
    seenSizeIds.add(size.jobOrderLineSizeId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa-accounting:${id}`}))`;
    if (
      await beginIdempotentOperation(
        tx,
        actor.id,
        id,
        'UPDATE_PREPARED_QUANTITY',
        idempotencyKey,
        hash,
      )
    )
      return;
    const currentVersion = await tx.jobOrder.findUnique({
      where: { id },
      include: {
        lines: { include: { sizes: { include: { size: true } } } },
        finalQualityBatches: {
          where: { disposition: { not: 'CANCELLED' } },
          include: { allocations: true },
        },
      },
    });
    if (!currentVersion) throw HttpError.notFound('Job order not found');
    if (currentVersion.version !== input.expectedVersion)
      throw HttpError.staleVersion(currentVersion.version);
    const committedBySize = new Map<string, number>();
    for (const allocation of currentVersion.finalQualityBatches.flatMap(
      (batch) => batch.allocations,
    ))
      committedBySize.set(
        allocation.jobOrderLineSizeId,
        (committedBySize.get(allocation.jobOrderLineSizeId) ?? 0) + allocation.quantity,
      );
    for (const size of input.sizes) {
      const authoritativeSize = currentVersion.lines
        .flatMap((line) => line.sizes)
        .find((candidate) => candidate.id === size.jobOrderLineSizeId)!;
      const committed = committedBySize.get(size.jobOrderLineSizeId) ?? 0;
      if (size.preparedQuantity < committed)
        throw HttpError.conflict(
          `Prepared quantity for size ${authoritativeSize.size.code} cannot be reduced below ${committed} units already reserved for Final inspection.`,
        );
      if (size.preparedQuantity > authoritativeSize.orderedQuantity)
        throw HttpError.badRequest(
          `Prepared quantity for size ${authoritativeSize.size.code} cannot exceed the Job Order quantity of ${authoritativeSize.orderedQuantity}.`,
        );
      await tx.jobOrderLineSize.update({
        where: { id: size.jobOrderLineSizeId },
        data: { preparedQuantity: size.preparedQuantity },
      });
    }

    for (const line of jobOrder.lines) {
      const freshSizes = await tx.jobOrderLineSize.findMany({ where: { jobOrderLineId: line.id } });
      const preparedQuantityTotal = freshSizes.reduce(
        (sum, size) => sum + size.preparedQuantity,
        0,
      );
      await tx.jobOrderLine.update({
        where: { id: line.id },
        data: {
          preparedQuantityTotal,
          status: line.status,
        },
      });
    }

    const freshLines = await tx.jobOrderLine.findMany({ where: { jobOrderId: id } });
    const preparedQuantityTotal = freshLines.reduce(
      (sum, line) => sum + line.preparedQuantityTotal,
      0,
    );
    const updated = await tx.jobOrder.update({
      where: { id },
      data: {
        preparedQuantityTotal,
        status: currentVersion.status,
        version: { increment: 1 },
      },
    });
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_PREPARED_QUANTITY_UPDATED',
        entityType: 'JobOrder',
        entityId: id,
        metadata: { sizes: input.sizes },
      },
      tx,
    );
    await finishIdempotentOperation(
      tx,
      actor.id,
      id,
      'UPDATE_PREPARED_QUANTITY',
      idempotencyKey,
      hash,
      updated.version,
    );
  });
  return getJobOrderDetail(actor, id);
}

export async function getJobOrderStages(user: CurrentUser, id: string) {
  const detail = await getJobOrderDetail(user, id);
  return detail.stages;
}

export async function getJobOrderAuditHistory(user: CurrentUser, id: string) {
  await getJobOrderDetail(user, id);

  const qualityExecutions = await prisma.qualityActivityExecution.findMany({
    where: { jobOrderId: id },
    select: {
      id: true,
      attemptNumber: true,
      batchNumber: true,
      processFlowActivity: { select: { name: true } },
    },
  });
  const qualityExecutionById = new Map(
    qualityExecutions.map((execution) => [execution.id, execution]),
  );

  const history = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'JobOrder', entityId: id },
        {
          entityType: 'QualityActivityExecution',
          entityId: { in: [...qualityExecutionById.keys()] },
        },
      ],
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      metadata: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return history.map(({ entityType, entityId, metadata, ...entry }) => {
    const execution =
      entityType === 'QualityActivityExecution' ? qualityExecutionById.get(entityId) : undefined;
    if (!execution) return { ...entry, metadata };

    const auditMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      ...entry,
      metadata: {
        ...auditMetadata,
        activityName: auditMetadata.activityName ?? execution.processFlowActivity.name,
        attemptNumber: auditMetadata.attemptNumber ?? execution.attemptNumber,
        batchNumber: auditMetadata.batchNumber ?? execution.batchNumber,
      },
    };
  });
}

export async function calculateVariance(user: CurrentUser, id: string) {
  const detail = await getJobOrderDetail(user, id);
  const lines = detail.lines.map((line) => ({
    jobOrderLineId: line.id,
    styleNumber: line.styleNumber,
    styleName: line.styleName,
    orderedQuantityTotal: line.orderedQuantityTotal,
    preparedQuantityTotal: line.preparedQuantityTotal,
    varianceQuantity: line.preparedQuantityTotal - line.orderedQuantityTotal,
    sizes: line.sizes.map((size) => ({
      jobOrderLineSizeId: size.id,
      sizeCode: size.sizeCode,
      orderedQuantity: size.orderedQuantity,
      preparedQuantity: size.preparedQuantity,
      varianceQuantity: size.preparedQuantity - size.orderedQuantity,
    })),
  }));
  const orderedQuantityTotal = detail.orderedQuantityTotal;
  const preparedQuantityTotal = detail.preparedQuantityTotal;
  return {
    jobOrderId: detail.id,
    jobOrderNumber: detail.jobOrderNumber,
    orderedQuantityTotal,
    preparedQuantityTotal,
    varianceQuantity: preparedQuantityTotal - orderedQuantityTotal,
    lines,
  };
}
