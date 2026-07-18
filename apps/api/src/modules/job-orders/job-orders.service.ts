import { createId } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import type { JobOrderStatus } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';

const jobOrderInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
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
  return user.roles.includes('FACTORY_USER') && user.factoryIds.includes(factoryId);
}

function assertJobOrderViewAccess(
  user: CurrentUser,
  jobOrder: { factoryId: string; status: JobOrderStatus },
): void {
  if (canViewAllJobOrders(user)) return;
  if (canFactoryManage(user, jobOrder.factoryId)) return;
  if (user.roles.includes('QA_USER') && jobOrder.status === 'READY_FOR_QA') return;
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
    completedAt: stage.completedAt,
    remarks: stage.remarks,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

function toJobOrderView(jobOrder: JobOrderRecord) {
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
    confirmedBy: jobOrder.confirmer,
    confirmedAt: jobOrder.confirmedAt,
    productionStartedAt: jobOrder.productionStartedAt,
    productionCompletedAt: jobOrder.productionCompletedAt,
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
    createdAt: jobOrder.createdAt,
    updatedAt: jobOrder.updatedAt,
  };
}

export async function generateJobOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JO-${year}-`;
  const last = await prisma.jobOrder.findFirst({
    where: { jobOrderNumber: { startsWith: prefix } },
    orderBy: { jobOrderNumber: 'desc' },
    select: { jobOrderNumber: true },
  });
  const lastSeq = last ? parseInt(last.jobOrderNumber.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;
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
      data: { status: nextStatus },
    });
  }
}

export async function getJobOrderList(
  user: CurrentUser,
  filters: { search?: string; status?: JobOrderStatus; factoryId?: string },
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
    orderBy: { createdAt: 'desc' },
  });
  return jobOrders.map(toJobOrderView);
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

  for (const line of input.lines) {
    const poLine = poLinesById.get(line.purchaseOrderLineId);
    if (!poLine) throw HttpError.badRequest('Line does not belong to the selected purchase order');
    if (seenLines.has(line.purchaseOrderLineId))
      throw HttpError.badRequest('Duplicate purchase order lines are not allowed');
    seenLines.add(line.purchaseOrderLineId);

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

  const jobOrderId = createId();
  const jobOrderNumber = await generateJobOrderNumber();

  await prisma.$transaction(async (tx) => {
    await tx.jobOrder.create({
      data: {
        id: jobOrderId,
        jobOrderNumber,
        purchaseOrderId: input.purchaseOrderId,
        factoryId: input.factoryId,
        processFlowVersionId: input.processFlowVersionId,
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
        await tx.distributorPurchaseOrderLineSize.update({
          where: { id: size.purchaseOrderLineSizeId },
          data: { jobOrderedQuantity: { increment: size.quantity } },
        });
      }
    }

    await updatePurchaseOrderJobOrderedStatus(tx, input.purchaseOrderId);
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'JOB_ORDER_CREATED',
    entityType: 'JobOrder',
    entityId: jobOrderId,
    metadata: {
      jobOrderNumber,
      purchaseOrderId: input.purchaseOrderId,
      factoryId: input.factoryId,
    },
  });

  return getJobOrderDetail(actor, jobOrderId);
}

export async function sendJobOrderToFactory(actor: CurrentUser, id: string) {
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: { factory: { select: { status: true } } },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  if (!canManageJobOrders(actor))
    throw HttpError.forbidden('Only admins and merchandisers can send job orders');
  if (jobOrder.status !== 'DRAFT')
    throw HttpError.badRequest('Only DRAFT job orders can be sent to factory');
  if (jobOrder.factory.status !== 'ACTIVE') {
    throw HttpError.conflict('An inactive factory cannot receive a job order');
  }

  await prisma.jobOrder.update({ where: { id }, data: { status: 'SENT_TO_FACTORY' } });
  await recordAuditLog({
    actorId: actor.id,
    action: 'JOB_ORDER_SENT_TO_FACTORY',
    entityType: 'JobOrder',
    entityId: id,
    metadata: { jobOrderNumber: jobOrder.jobOrderNumber },
  });
  return getJobOrderDetail(actor, id);
}

export async function confirmJobOrder(actor: CurrentUser, id: string) {
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: {
      processFlowVersion: {
        include: { stages: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' } } },
      },
    },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
  if (jobOrder.status !== 'SENT_TO_FACTORY')
    throw HttpError.badRequest('Only sent job orders can be confirmed');

  await prisma.$transaction(async (tx) => {
    await tx.jobOrder.update({
      where: { id },
      data: {
        status: 'CONFIRMED_BY_FACTORY',
        factoryConfirmationStatus: 'CONFIRMED',
        confirmedBy: actor.id,
        confirmedAt: new Date(),
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
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'JOB_ORDER_FACTORY_CONFIRMED',
    entityType: 'JobOrder',
    entityId: id,
    metadata: { jobOrderNumber: jobOrder.jobOrderNumber },
  });
  return getJobOrderDetail(actor, id);
}

export async function completeProductionStage(
  actor: CurrentUser,
  id: string,
  input: { stageStatusId: string; remarks?: string | null },
) {
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: { stageStatuses: { orderBy: { stageSequence: 'asc' } } },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
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
    await tx.jobOrderStageStatus.update({
      where: { id: input.stageStatusId },
      data: {
        status: 'COMPLETED',
        completedBy: actor.id,
        completedAt: now,
        remarks: input.remarks ?? null,
      },
    });
    await tx.jobOrder.update({
      where: { id },
      data: {
        status: isFinalStage ? 'PRODUCTION_COMPLETE' : 'IN_PRODUCTION',
        productionStartedAt: jobOrder.productionStartedAt ?? now,
        productionCompletedAt: isFinalStage ? now : undefined,
      },
    });
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'JOB_ORDER_STAGE_COMPLETED',
    entityType: 'JobOrder',
    entityId: id,
    metadata: { stageStatusId: input.stageStatusId, stageName: nextStage.stageNameSnapshot },
  });
  return getJobOrderDetail(actor, id);
}

export async function updatePreparedQuantity(
  actor: CurrentUser,
  id: string,
  input: { sizes: Array<{ jobOrderLineSizeId: string; preparedQuantity: number }> },
) {
  const jobOrder = await prisma.jobOrder.findUnique({
    where: { id },
    include: { lines: { include: { sizes: true } } },
  });
  if (!jobOrder) throw HttpError.notFound('Job order not found');
  assertJobOrderWorkflowAuthorization(actor, jobOrder.factoryId);
  await assertFactoryUserFactoryActive(actor, jobOrder.factoryId);
  if (jobOrder.status !== 'PRODUCTION_COMPLETE') {
    throw HttpError.badRequest(
      'Prepared quantity can only be updated after production is complete',
    );
  }

  const allowedSizeIds = new Set(
    jobOrder.lines.flatMap((line) => line.sizes.map((size) => size.id)),
  );
  for (const size of input.sizes) {
    if (!allowedSizeIds.has(size.jobOrderLineSizeId)) {
      throw HttpError.badRequest('Prepared quantity line size does not belong to this job order');
    }
  }

  await prisma.$transaction(async (tx) => {
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
    await tx.jobOrder.update({
      where: { id },
      data: { preparedQuantityTotal, status: 'READY_FOR_QA' },
    });
  });

  await recordAuditLog({
    actorId: actor.id,
    action: 'JOB_ORDER_PREPARED_QUANTITY_UPDATED',
    entityType: 'JobOrder',
    entityId: id,
  });
  return getJobOrderDetail(actor, id);
}

export async function getJobOrderStages(user: CurrentUser, id: string) {
  const detail = await getJobOrderDetail(user, id);
  return detail.stages;
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
