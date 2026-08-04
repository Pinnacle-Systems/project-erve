import { canPerformQaOperation, createId } from '@erve/shared';
import { createHash } from 'node:crypto';
import {
  QA_QUEUE_STATUSES,
  type AssignedFactoryTaskSummary,
  type JobOrderDetail,
  type PaginatedResponse,
} from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import type { JobOrderStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { normalizeDisclaimerText } from './job-orders.validation.js';

const jobOrderInclude = {
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      status: true,
      requiredDeliveryDate: true,
      distributor: { select: { id: true, code: true, name: true } },
    },
  },
  factory: { select: { id: true, code: true, name: true } },
  processFlowVersion: {
    include: {
      processFlow: { select: { id: true, code: true, name: true } },
    },
  },
  creator: { select: { id: true, name: true, email: true } },
  confirmer: { select: { id: true, name: true, email: true } },
  lines: {
    include: {
      style: { select: { id: true, styleNumber: true, styleName: true } },
      purchaseOrderLine: { select: { id: true } },
      sizes: {
        include: { size: { select: { id: true, code: true, label: true, sortOrder: true } } },
        orderBy: { size: { sortOrder: 'asc' as const } },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  stageStatuses: {
    include: { completer: { select: { id: true, name: true, email: true } } },
    orderBy: { stageSequence: 'asc' as const },
  },
  acknowledgements: {
    include: { acknowledgedBy: { select: { id: true, name: true, email: true } } },
    orderBy: { acknowledgedAt: 'desc' as const },
  },
} satisfies Prisma.JobOrderInclude;

type JobOrderRecord = Prisma.JobOrderGetPayload<{ include: typeof jobOrderInclude }>;
type Tx = Prisma.TransactionClient;

function canManageJobOrders(user: CurrentUser): boolean {
  return user.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER');
}

function canViewAllJobOrders(user: CurrentUser): boolean {
  return user.roles.some(
    (role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT',
  );
}

function canFactoryManage(user: CurrentUser, factoryId: string): boolean {
  return (
    user.roles.includes('FACTORY_USER') &&
    user.factoryIds.length === 1 &&
    user.factoryIds[0] === factoryId
  );
}

function assertSoleFactoryMapping(user: CurrentUser): string {
  if (user.factoryIds.length === 0) throw HttpError.factoryMappingRequired();
  if (user.factoryIds.length > 1) throw HttpError.factoryMappingAmbiguous();
  return user.factoryIds[0]!;
}

function assertJobOrderViewAccess(
  user: CurrentUser,
  jobOrder: { factoryId: string; status: JobOrderStatus },
): void {
  if (canViewAllJobOrders(user)) return;
  if (canFactoryManage(user, jobOrder.factoryId) && jobOrder.status !== 'DRAFT') return;
  if (canPerformQaOperation(user) && QA_QUEUE_STATUSES.includes(jobOrder.status)) return;
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
// createJobOrderFromPO / sendJobOrderToFactory), not their ability to
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

function toJobOrderView(jobOrder: JobOrderRecord): JobOrderDetail {
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
  return {
    id: jobOrder.id,
    jobOrderNumber: jobOrder.jobOrderNumber,
    purchaseOrder: jobOrder.purchaseOrder,
    factory: jobOrder.factory,
    processFlowVersion: {
      id: jobOrder.processFlowVersion.id,
      versionNumber: jobOrder.processFlowVersion.versionNumber,
      status: jobOrder.processFlowVersion.status,
      processFlow: jobOrder.processFlowVersion.processFlow,
    },
    status: jobOrder.status,
    factoryConfirmationStatus: jobOrder.factoryConfirmationStatus,
    unitPrice: jobOrder.unitPrice?.toNumber() ?? null,
    confirmedBy: jobOrder.confirmer,
    confirmedAt: jobOrder.confirmedAt?.toISOString() ?? null,
    disclaimerText: jobOrder.disclaimerText,
    disclaimerRevision: jobOrder.disclaimerRevision,
    acknowledgement: acknowledgements[0] ?? null,
    acknowledgements,
    productionStartedAt: jobOrder.productionStartedAt?.toISOString() ?? null,
    productionCompletedAt: jobOrder.productionCompletedAt?.toISOString() ?? null,
    orderedQuantityTotal: totalOrdered(jobOrder),
    preparedQuantityTotal: jobOrder.preparedQuantityTotal,
    creator: jobOrder.creator,
    lines: jobOrder.lines.map((line) => ({
      id: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      styleId: line.styleId,
      styleNumber: line.style.styleNumber,
      styleName: line.style.styleName,
      orderedQuantityTotal: line.orderedQuantityTotal,
      preparedQuantityTotal: line.preparedQuantityTotal,
      status: line.status,
      sizes: line.sizes.map((size) => ({
        id: size.id,
        purchaseOrderLineSizeId: size.purchaseOrderLineSizeId,
        sizeId: size.sizeId,
        sizeCode: size.size.code,
        sizeLabel: size.size.label,
        orderedQuantity: size.orderedQuantity,
        preparedQuantity: size.preparedQuantity,
        varianceQuantity: size.preparedQuantity - size.orderedQuantity,
      })),
    })),
    stages: jobOrder.stageStatuses.map(toStageView),
    createdAt: jobOrder.createdAt.toISOString(),
    updatedAt: jobOrder.updatedAt.toISOString(),
    version: jobOrder.version,
  };
}

async function generateJobOrderNumber(client: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JO-${year}-`;
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-number-${year}`}))`;
  const last = await client.jobOrder.findFirst({
    where: { jobOrderNumber: { startsWith: prefix } },
    orderBy: { jobOrderNumber: 'desc' },
    select: { jobOrderNumber: true },
  });
  const lastSeq = last ? parseInt(last.jobOrderNumber.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;
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

export async function updatePurchaseOrderJobOrderedStatus(
  tx: Tx,
  purchaseOrderId: string,
): Promise<void> {
  const po = await tx.distributorPurchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: { include: { sizes: true } } },
  });
  if (!po) throw HttpError.notFound('Purchase order not found');
  if (po.status === 'CANCELLED' || po.status === 'CLOSED') return;

  const allSizes = po.lines.flatMap((line) => line.sizes);
  const ordered = allSizes.reduce((sum, size) => sum + size.orderedQuantity, 0);
  const jobOrdered = allSizes.reduce((sum, size) => sum + size.jobOrderedQuantity, 0);
  const nextStatus =
    jobOrdered >= ordered
      ? 'FULLY_JOB_ORDERED'
      : jobOrdered > 0
        ? 'PARTIALLY_JOB_ORDERED'
        : po.status;

  if (nextStatus !== po.status) {
    await tx.distributorPurchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: nextStatus, version: { increment: 1 } },
    });
  }
}

export async function getJobOrderList(
  user: CurrentUser,
  filters: {
    search?: string;
    status?: JobOrderStatus;
    factoryId?: string;
    cursor?: string;
    limit: number;
  },
) {
  if (user.roles.includes('DISTRIBUTOR') || user.roles.includes('ACCOUNTANT')) {
    throw HttpError.forbidden('You do not have access to job orders');
  }

  const where: Prisma.JobOrderWhereInput = {
    status: filters.status,
    factoryId: canViewAllJobOrders(user) ? filters.factoryId : { in: user.factoryIds },
    OR: filters.search
      ? [
          { jobOrderNumber: { contains: filters.search, mode: 'insensitive' } },
          { purchaseOrder: { poNumber: { contains: filters.search, mode: 'insensitive' } } },
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
  return {
    items: page.map(toJobOrderView),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getAssignedFactoryTasks(
  user: CurrentUser,
  filters: { search?: string; status?: JobOrderStatus; cursor?: string; limit: number },
): Promise<PaginatedResponse<AssignedFactoryTaskSummary>> {
  const factoryId = assertSoleFactoryMapping(user);
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
      OR: filters.search
        ? [
            { jobOrderNumber: { contains: filters.search, mode: 'insensitive' } },
            { purchaseOrder: { poNumber: { contains: filters.search, mode: 'insensitive' } } },
          ]
        : undefined,
    },
    select: {
      id: true,
      jobOrderNumber: true,
      status: true,
      version: true,
      updatedAt: true,
      preparedQuantityTotal: true,
      factory: { select: { id: true, code: true, name: true } },
      purchaseOrder: {
        select: {
          poNumber: true,
          requiredDeliveryDate: true,
          distributor: { select: { id: true, code: true, name: true } },
        },
      },
      lines: { select: { orderedQuantityTotal: true } },
      stageStatuses: {
        where: { status: { not: 'COMPLETED' } },
        orderBy: { stageSequence: 'asc' },
        take: 1,
        select: { id: true, stageSequence: true, stageNameSnapshot: true },
      },
    },
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map((record) => ({
      id: record.id,
      jobOrderNumber: record.jobOrderNumber,
      purchaseOrderNumber: record.purchaseOrder.poNumber,
      distributor: record.purchaseOrder.distributor,
      factory: record.factory,
      status: record.status,
      currentStage: record.stageStatuses[0]
        ? {
            id: record.stageStatuses[0].id,
            sequence: record.stageStatuses[0].stageSequence,
            name: record.stageStatuses[0].stageNameSnapshot,
          }
        : null,
      orderedQuantityTotal: record.lines.reduce((sum, line) => sum + line.orderedQuantityTotal, 0),
      preparedQuantityTotal: record.preparedQuantityTotal,
      requiredDeliveryDate: record.purchaseOrder.requiredDeliveryDate?.toISOString() ?? null,
      version: record.version,
      updatedAt: record.updatedAt.toISOString(),
      actionRequired: [
        'SENT_TO_FACTORY',
        'CONFIRMED_BY_FACTORY',
        'IN_PRODUCTION',
        'PRODUCTION_COMPLETE',
      ].includes(record.status),
    })),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function getJobOrderDetail(user: CurrentUser, id: string) {
  const jobOrder = await prisma.jobOrder.findUnique({ where: { id }, include: jobOrderInclude });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderViewAccess(user, jobOrder);
  return toJobOrderView(jobOrder);
}

export async function createJobOrderFromPO(
  actor: CurrentUser,
  input: {
    purchaseOrderId: string;
    factoryId: string;
    processFlowVersionId: string;
    unitPrice: string;
    disclaimerText?: string;
    lines: Array<{
      purchaseOrderLineId: string;
      sizes: Array<{ purchaseOrderLineSizeId: string; quantity: number }>;
    }>;
  },
) {
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can create job orders');

  const [po, factory, processFlowVersion] = await Promise.all([
    prisma.distributorPurchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { lines: { include: { sizes: true } } },
    }),
    prisma.factory.findUnique({ where: { id: input.factoryId } }),
    prisma.processFlowVersion.findUnique({
      where: { id: input.processFlowVersionId },
      include: { stages: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' } } },
    }),
  ]);

  if (!po) throw HttpError.badRequest('Purchase order not found');
  if (po.status === 'DRAFT')
    throw HttpError.badRequest('Purchase order must be submitted before job ordering');
  if (po.status === 'CANCELLED' || po.status === 'CLOSED') {
    throw HttpError.badRequest('Purchase order cannot be job ordered in its current status');
  }
  if (!factory) throw HttpError.badRequest('Factory not found');
  if (factory.status !== 'ACTIVE') throw HttpError.badRequest('Factory is not active');
  if (!processFlowVersion) throw HttpError.badRequest('Process flow version not found');
  if (processFlowVersion.status !== 'ACTIVE')
    throw HttpError.badRequest('Process flow version must be ACTIVE');

  const poLinesById = new Map(po.lines.map((line) => [line.id, line]));
  const poSizesById = new Map(
    po.lines.flatMap((line) => line.sizes.map((size) => [size.id, { ...size, line }])),
  );
  const seenLines = new Set<string>();
  const seenSizes = new Set<string>();
  const selectedStyleIds = new Set<string>();

  for (const line of input.lines) {
    const poLine = poLinesById.get(line.purchaseOrderLineId);
    if (!poLine) throw HttpError.badRequest('Line does not belong to the selected purchase order');
    if (seenLines.has(line.purchaseOrderLineId))
      throw HttpError.badRequest('Duplicate purchase order lines are not allowed');
    seenLines.add(line.purchaseOrderLineId);
    selectedStyleIds.add(poLine.styleId);

    for (const size of line.sizes) {
      const poSize = poSizesById.get(size.purchaseOrderLineSizeId);
      if (!poSize || poSize.purchaseOrderLineId !== line.purchaseOrderLineId) {
        throw HttpError.badRequest('Line size does not belong to the selected purchase order line');
      }
      if (seenSizes.has(size.purchaseOrderLineSizeId))
        throw HttpError.badRequest('Duplicate line sizes are not allowed');
      seenSizes.add(size.purchaseOrderLineSizeId);
      const remaining = poSize.orderedQuantity - poSize.jobOrderedQuantity;
      if (size.quantity > remaining)
        throw HttpError.badRequest('Job order quantity exceeds remaining purchase order balance');
    }
  }
  if (selectedStyleIds.size !== 1) {
    throw HttpError.badRequest('A job order must contain lines from exactly one style');
  }

  const jobOrderId = createId();
  let jobOrderNumber = '';

  await prisma.$transaction(async (tx) => {
    jobOrderNumber = await generateJobOrderNumber(tx);
    await tx.jobOrder.create({
      data: {
        id: jobOrderId,
        jobOrderNumber,
        purchaseOrderId: input.purchaseOrderId,
        factoryId: input.factoryId,
        processFlowVersionId: input.processFlowVersionId,
        unitPrice: new Prisma.Decimal(input.unitPrice),
        disclaimerText: input.disclaimerText || null,
        disclaimerRevision: input.disclaimerText ? 1 : 0,
        createdBy: actor.id,
      },
    });

    for (const line of input.lines) {
      const poLine = poLinesById.get(line.purchaseOrderLineId)!;
      const lineId = createId();
      const orderedQuantityTotal = line.sizes.reduce((sum, size) => sum + size.quantity, 0);
      await tx.jobOrderLine.create({
        data: {
          id: lineId,
          jobOrderId,
          purchaseOrderLineId: line.purchaseOrderLineId,
          styleId: poLine.styleId,
          orderedQuantityTotal,
          sizes: {
            create: line.sizes.map((size) => {
              const poSize = poSizesById.get(size.purchaseOrderLineSizeId)!;
              return {
                id: createId(),
                purchaseOrderLineSizeId: size.purchaseOrderLineSizeId,
                sizeId: poSize.sizeId,
                orderedQuantity: size.quantity,
              };
            }),
          },
        },
      });

      for (const size of line.sizes) {
        const snapshot = poSizesById.get(size.purchaseOrderLineSizeId)!;
        const allocated = await tx.distributorPurchaseOrderLineSize.updateMany({
          where: {
            id: size.purchaseOrderLineSizeId,
            jobOrderedQuantity: { lte: snapshot.orderedQuantity - size.quantity },
          },
          data: { jobOrderedQuantity: { increment: size.quantity } },
        });
        if (allocated.count !== 1) {
          throw HttpError.conflict('Purchase order balance changed; reload before allocating');
        }
      }
    }

    await updatePurchaseOrderJobOrderedStatus(tx, input.purchaseOrderId);
    await recordAuditLog(
      {
        actorId: actor.id,
        action: 'JOB_ORDER_CREATED',
        entityType: 'JobOrder',
        entityId: jobOrderId,
        metadata: {
          jobOrderNumber,
          purchaseOrderId: input.purchaseOrderId,
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
    throw HttpError.forbidden('Only the mapped factory user can acknowledge and confirm this job order');
  await assertFactoryUserFactoryActive(actor, initial.factoryId);
  const hash = requestHash(input);
  await prisma.$transaction(async (tx) => {
    if (await beginIdempotentOperation(tx, actor.id, id, 'CONFIRM', idempotencyKey, hash)) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const jobOrder = await tx.jobOrder.findUnique({
      where: { id },
      include: {
        processFlowVersion: {
          include: { stages: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' } } },
        },
        factory: { select: { status: true } },
      },
    });
    if (!jobOrder) throw HttpError.notFound('Job order not found');
    if (!canFactoryManage(actor, jobOrder.factoryId))
      throw HttpError.forbidden('Only the mapped factory user can acknowledge and confirm this job order');
    if (jobOrder.factory.status !== 'ACTIVE')
      throw HttpError.conflict('This factory is inactive and cannot perform new operational actions');
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
      data: jobOrder.processFlowVersion.stages.map((stage) => ({
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
    include: { stageStatuses: { orderBy: { stageSequence: 'asc' } } },
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

  const nextStage = jobOrder.stageStatuses.find((stage) => stage.status !== 'COMPLETED');
  if (!nextStage) throw HttpError.badRequest('All production stages are already completed');
  if (nextStage.id !== input.stageStatusId)
    throw HttpError.badRequest('Production stages must be completed in sequence');

  const isFinalStage =
    nextStage.stageSequence ===
    jobOrder.stageStatuses[jobOrder.stageStatuses.length - 1]?.stageSequence;
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
    include: { lines: { include: { sizes: true } } },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
  if (jobOrder.version !== input.expectedVersion) throw HttpError.staleVersion(jobOrder.version);
  if (jobOrder.status !== 'PRODUCTION_COMPLETE') {
    throw HttpError.badRequest(
      'Prepared quantity can only be updated after production is complete',
    );
  }

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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-order-${id}`}))`;
    const currentVersion = await tx.jobOrder.findUnique({
      where: { id },
      select: { version: true },
    });
    if (!currentVersion) throw HttpError.notFound('Job order not found');
    if (currentVersion.version !== input.expectedVersion)
      throw HttpError.staleVersion(currentVersion.version);
    for (const size of input.sizes) {
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
        data: { preparedQuantityTotal, status: 'READY_FOR_QA' },
      });
    }

    const freshLines = await tx.jobOrderLine.findMany({ where: { jobOrderId: id } });
    const preparedQuantityTotal = freshLines.reduce(
      (sum, line) => sum + line.preparedQuantityTotal,
      0,
    );
    const updated = await tx.jobOrder.update({
      where: { id },
      data: { preparedQuantityTotal, status: 'READY_FOR_QA', version: { increment: 1 } },
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
  return prisma.auditLog.findMany({
    where: { entityType: 'JobOrder', entityId: id },
    select: {
      id: true,
      action: true,
      createdAt: true,
      metadata: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
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
