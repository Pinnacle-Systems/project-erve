import { createHash } from 'node:crypto';
import { canPerformQaOperation, createId } from '@erve/shared';
import type {
  PaginatedResponse,
  QaInspectionDetail,
  QaQueueSummary,
  QaReworkTaskView,
  SaveQaInspectionInput,
} from '@erve/types';
import { QA_INSPECTION_START_STATUSES, QA_QUEUE_STATUSES } from '@erve/types';
import type { CurrentUser } from '../../auth/current-user.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { HttpError } from '../../errors/http-error.js';
import { Prisma, prisma } from '../../db/prisma.js';

type Tx = Prisma.TransactionClient;

function isSupervisor(user: CurrentUser) {
  return canPerformQaOperation(user) || user.roles.includes('MERCHANDISER');
}
function isReadSupervisor(user: CurrentUser) {
  return isSupervisor(user) || user.roles.includes('SENIOR_MANAGEMENT');
}
function assertQaMutation(user: CurrentUser, _factoryId: string) {
  if (isSupervisor(user)) return;
  throw HttpError.forbidden('You cannot inspect this job order');
}
function assertQaView(user: CurrentUser, _factoryId: string) {
  if (isReadSupervisor(user)) return;
  if (canPerformQaOperation(user)) return;
  throw HttpError.forbidden('You cannot view this QA record');
}
function assertFactoryMutation(user: CurrentUser, factoryId: string) {
  if (isSupervisor(user)) return;
  if (
    !user.roles.includes('FACTORY_USER') ||
    user.factoryIds.length !== 1 ||
    user.factoryIds[0] !== factoryId
  ) {
    throw HttpError.forbidden('You cannot update this rework task');
  }
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function replayOrLock(
  tx: Tx,
  actorId: string,
  jobOrderId: string,
  operation: string,
  key: string,
  requestHash: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actorId}:${operation}:${key}`}))`;
  const prior = await tx.jobOrderIdempotencyRecord.findUnique({
    where: { actorId_operation_idempotencyKey: { actorId, operation, idempotencyKey: key } },
  });
  if (!prior) return false;
  if (prior.jobOrderId !== jobOrderId || prior.requestHash !== requestHash) {
    throw HttpError.idempotencyKeyReused();
  }
  return true;
}
async function finish(
  tx: Tx,
  actorId: string,
  jobOrderId: string,
  operation: string,
  key: string,
  requestHash: string,
  resultVersion: number,
) {
  await tx.jobOrderIdempotencyRecord.create({
    data: {
      id: createId(),
      actorId,
      jobOrderId,
      operation,
      idempotencyKey: key,
      requestHash,
      resultVersion,
    },
  });
}

const detailInclude = {
  factory: { select: { id: true, code: true, name: true } },
  purchaseOrder: { select: { poNumber: true } },
  lines: {
    include: {
      style: { select: { styleNumber: true, styleName: true } },
      sizes: { include: { size: { select: { code: true, label: true, sortOrder: true } } } },
    },
  },
  qaInspections: {
    include: {
      inspector: { select: { id: true, name: true, email: true } },
      lines: true,
      evidence: { include: { file: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  qaReworkTasks: { include: { sourceLine: true } },
} satisfies Prisma.JobOrderInclude;
type DetailRecord = Prisma.JobOrderGetPayload<{ include: typeof detailInclude }>;

function derive(record: DetailRecord) {
  const activeSessions = record.qaInspections.filter(
    (session) => session.status !== 'REOPENED' && session.status !== 'VOIDED',
  );
  const finalizedLines = activeSessions
    .filter((s) => s.status === 'FINALIZED')
    .flatMap((s) => s.lines);
  const reservedFirstPass = activeSessions
    .flatMap((s) => s.lines)
    .filter((line) => !line.sourceReworkTaskId);
  const accepted = finalizedLines.reduce((n, line) => n + line.acceptedQuantity, 0);
  const rejected = finalizedLines.reduce((n, line) => n + line.permanentlyRejectedQuantity, 0);
  const rework = finalizedLines.reduce((n, line) => n + line.reworkQuantity, 0);
  const awaiting = record.qaReworkTasks
    .filter((task) => task.status !== 'CLOSED')
    .reduce((n, task) => n + task.assignedQuantity, 0);
  const prepared = record.preparedQuantityTotal;
  const firstPassReserved = reservedFirstPass.reduce((n, line) => n + line.inspectedQuantity, 0);
  return {
    prepared,
    availableToInspect: Math.max(0, prepared - firstPassReserved),
    accepted,
    rework,
    awaitingReinspection: awaiting,
    permanentlyRejected: rejected,
    finalApproved: record.status === 'QA_APPROVED' ? accepted : 0,
  };
}
function toRework(
  record: DetailRecord,
  task: DetailRecord['qaReworkTasks'][number],
): QaReworkTaskView {
  const size = record.lines
    .flatMap((l) => l.sizes.map((s) => ({ l, s })))
    .find(({ s }) => s.id === task.jobOrderLineSizeId)!;
  return {
    id: task.id,
    jobOrderId: record.id,
    jobOrderNumber: record.jobOrderNumber,
    jobOrderLineSizeId: task.jobOrderLineSizeId,
    styleNumber: size.l.style.styleNumber,
    sizeCode: size.s.size.code,
    assignedQuantity: task.assignedQuantity,
    attemptNumber: task.attemptNumber,
    status: task.status,
    defectCategory: task.sourceLine.defectCategory,
    defectNotes: task.sourceLine.defectNotes,
    version: task.version,
    updatedAt: task.updatedAt.toISOString(),
  };
}
function toDetail(record: DetailRecord): QaInspectionDetail {
  const lineFacts = new Map<
    string,
    { accepted: number; rework: number; rejected: number; reserved: number; awaiting: number }
  >();
  for (const line of record.lines.flatMap((l) => l.sizes))
    lineFacts.set(line.id, { accepted: 0, rework: 0, rejected: 0, reserved: 0, awaiting: 0 });
  for (const session of record.qaInspections.filter(
    (s) => !['REOPENED', 'VOIDED'].includes(s.status),
  )) {
    for (const line of session.lines) {
      const fact = lineFacts.get(line.jobOrderLineSizeId)!;
      if (!line.sourceReworkTaskId) fact.reserved += line.inspectedQuantity;
      if (session.status === 'FINALIZED') {
        fact.accepted += line.acceptedQuantity;
        fact.rework += line.reworkQuantity;
        fact.rejected += line.permanentlyRejectedQuantity;
      }
    }
  }
  for (const task of record.qaReworkTasks.filter((t) => t.status !== 'CLOSED'))
    lineFacts.get(task.jobOrderLineSizeId)!.awaiting += task.assignedQuantity;
  return {
    id: record.id,
    jobOrderNumber: record.jobOrderNumber,
    purchaseOrderNumber: record.purchaseOrder.poNumber,
    factory: record.factory,
    status: record.status,
    totals: derive(record),
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
    lines: record.lines.flatMap((line) =>
      line.sizes.map((size) => {
        const fact = lineFacts.get(size.id)!;
        return {
          jobOrderLineSizeId: size.id,
          styleNumber: line.style.styleNumber,
          styleName: line.style.styleName,
          sizeCode: size.size.code,
          sizeLabel: size.size.label,
          preparedQuantity: size.preparedQuantity,
          availableToInspect: Math.max(0, size.preparedQuantity - fact.reserved),
          acceptedQuantity: fact.accepted,
          reworkQuantity: fact.rework,
          awaitingReinspectionQuantity: fact.awaiting,
          permanentlyRejectedQuantity: fact.rejected,
        };
      }),
    ),
    sessions: record.qaInspections.map((session) => ({
      id: session.id,
      cycleNumber: session.cycleNumber,
      status: session.status,
      inspector: session.inspector,
      notes: session.notes,
      finalizedAt: session.finalizedAt?.toISOString() ?? null,
      reopenedAt: session.reopenedAt?.toISOString() ?? null,
      reopenReason: session.reopenReason,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      version: session.version,
      lines: session.lines.map((line) => {
        const size = record.lines
          .flatMap((l) => l.sizes.map((s) => ({ l, s })))
          .find(({ s }) => s.id === line.jobOrderLineSizeId)!;
        return {
          id: line.id,
          jobOrderLineSizeId: line.jobOrderLineSizeId,
          sourceReworkTaskId: line.sourceReworkTaskId,
          styleNumber: size.l.style.styleNumber,
          styleName: size.l.style.styleName,
          sizeCode: size.s.size.code,
          sizeLabel: size.s.size.label,
          preparedQuantity: size.s.preparedQuantity,
          inspectedQuantity: line.inspectedQuantity,
          acceptedQuantity: line.acceptedQuantity,
          reworkQuantity: line.reworkQuantity,
          permanentlyRejectedQuantity: line.permanentlyRejectedQuantity,
          defectCategory: line.defectCategory,
          defectNotes: line.defectNotes,
        };
      }),
      evidence: session.evidence.map((e) => ({
        id: e.id,
        inspectionLineId: e.inspectionLineId,
        fileName: e.file.fileName,
        contentType: e.file.mimeType,
        sizeBytes: e.file.sizeBytes,
        createdAt: e.createdAt.toISOString(),
      })),
    })),
    reworkTasks: record.qaReworkTasks.map((task) => toRework(record, task)),
  };
}
async function load(id: string) {
  const record = await prisma.jobOrder.findUnique({ where: { id }, include: detailInclude });
  if (!record) throw HttpError.notFound('Job order not found');
  return record;
}
export async function getDetail(user: CurrentUser, id: string) {
  const record = await load(id);
  assertQaView(user, record.factoryId);
  return toDetail(record);
}
export async function getQueue(
  _user: CurrentUser,
  filters: {
    filter?: string;
    factoryId?: string;
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    cursor?: string;
    limit: number;
  },
): Promise<PaginatedResponse<QaQueueSummary>> {
  const scopedFactory = filters.factoryId;
  const statuses =
    filters.filter === 'AWAITING_FIRST_INSPECTION'
      ? ['READY_FOR_QA']
      : filters.filter === 'IN_PROGRESS'
        ? ['QA_IN_PROGRESS']
        : filters.filter === 'REWORK_REQUIRED'
          ? ['REWORK_REQUIRED']
          : filters.filter === 'READY_FOR_REINSPECTION'
            ? ['READY_FOR_REINSPECTION']
            : filters.filter === 'COMPLETED'
              ? ['QA_APPROVED']
              : [...QA_QUEUE_STATUSES];
  const records = await prisma.jobOrder.findMany({
    where: {
      factoryId: scopedFactory,
      status: { in: statuses as never[] },
      updatedAt: { gte: filters.dateFrom, lte: filters.dateTo },
      OR: filters.search
        ? [
            { jobOrderNumber: { contains: filters.search, mode: 'insensitive' } },
            { purchaseOrder: { poNumber: { contains: filters.search, mode: 'insensitive' } } },
          ]
        : undefined,
    },
    include: detailInclude,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    cursor: filters.cursor ? { id: filters.cursor } : undefined,
    skip: filters.cursor ? 1 : undefined,
  });
  const hasMore = records.length > filters.limit;
  const page = hasMore ? records.slice(0, filters.limit) : records;
  return {
    items: page.map((r) => {
      const d = toDetail(r);
      return {
        id: d.id,
        jobOrderNumber: d.jobOrderNumber,
        purchaseOrderNumber: d.purchaseOrderNumber,
        factory: d.factory,
        status: d.status,
        totals: d.totals,
        version: d.version,
        updatedAt: d.updatedAt,
      };
    }),
    pageInfo: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)!.id : null },
  };
}

export async function startInspection(
  user: CurrentUser,
  jobOrderId: string,
  input: { expectedVersion: number; sourceReworkTaskIds: string[] },
  key: string,
) {
  const requestHash = hash(input);
  let sessionId = '';
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_START', key, requestHash)) return;
    const job = await tx.jobOrder.findUnique({
      where: { id: jobOrderId },
      include: {
        qaInspections: { select: { id: true, cycleNumber: true, status: true } },
        qaReworkTasks: true,
      },
    });
    if (!job) throw HttpError.notFound('Job order not found');
    assertQaMutation(user, job.factoryId);
    if (job.version !== input.expectedVersion) throw HttpError.staleVersion(job.version);
    if (!QA_INSPECTION_START_STATUSES.includes(job.status))
      throw HttpError.conflict('Job order is not available for inspection');
    const activeDraft =
      job.status === 'QA_IN_PROGRESS'
        ? job.qaInspections.find((session) => session.status === 'DRAFT')
        : undefined;
    if (activeDraft) {
      sessionId = activeDraft.id;
      return;
    }
    const selected = job.qaReworkTasks.filter((t) => input.sourceReworkTaskIds.includes(t.id));
    if (
      selected.length !== input.sourceReworkTaskIds.length ||
      selected.some((t) => t.status !== 'READY_FOR_REINSPECTION')
    )
      throw HttpError.conflict('Rework is not ready for reinspection');
    sessionId = createId();
    await tx.qaInspectionSession.create({
      data: {
        id: sessionId,
        jobOrderId,
        inspectorId: user.id,
        cycleNumber: Math.max(0, ...job.qaInspections.map((s) => s.cycleNumber)) + 1,
      },
    });
    const updated = await tx.jobOrder.update({
      where: { id: jobOrderId },
      data: { status: 'QA_IN_PROGRESS', version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_INSPECTION_STARTED',
        entityType: 'JobOrder',
        entityId: jobOrderId,
        metadata: { sessionId, sourceReworkTaskIds: input.sourceReworkTaskIds },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_START', key, requestHash, updated.version);
  });
  return getDetail(user, jobOrderId);
}

export async function saveInspection(
  user: CurrentUser,
  sessionId: string,
  input: SaveQaInspectionInput,
  key: string,
) {
  const requestHash = hash(input);
  let jobOrderId = '';
  await prisma.$transaction(async (tx) => {
    const snapshot = await tx.qaInspectionSession.findUnique({
      where: { id: sessionId },
      select: { jobOrderId: true },
    });
    if (!snapshot) throw HttpError.notFound('Inspection session not found');
    jobOrderId = snapshot.jobOrderId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_SAVE', key, requestHash)) return;
    const session = await tx.qaInspectionSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { jobOrder: true },
    });
    assertQaMutation(user, session.jobOrder.factoryId);
    if (session.inspectorId !== user.id && !isSupervisor(user))
      throw HttpError.forbidden('Only the inspector can edit this draft');
    if (session.status !== 'DRAFT') throw HttpError.conflict('Inspection is already finalized');
    if (session.version !== input.expectedVersion) throw HttpError.staleVersion(session.version);
    if (
      new Set(input.lines.map((l) => `${l.jobOrderLineSizeId}:${l.sourceReworkTaskId ?? ''}`))
        .size !== input.lines.length
    )
      throw HttpError.badRequest('Duplicate inspection lines are not allowed');
    const jobSizes = await tx.jobOrderLineSize.findMany({
      where: { jobOrderLine: { jobOrderId } },
    });
    const sizeMap = new Map(jobSizes.map((s) => [s.id, s]));
    const otherLines = await tx.qaInspectionLine.findMany({
      where: {
        session: { jobOrderId, status: { in: ['DRAFT', 'FINALIZED'] } },
        inspectionSessionId: { not: sessionId },
      },
    });
    for (const line of input.lines) {
      const size = sizeMap.get(line.jobOrderLineSizeId);
      if (!size) throw HttpError.badRequest('Inspection line does not belong to the job order');
      if (line.sourceReworkTaskId) {
        const task = await tx.qaReworkTask.findUnique({ where: { id: line.sourceReworkTaskId } });
        if (
          !task ||
          task.jobOrderLineSizeId !== line.jobOrderLineSizeId ||
          task.status !== 'READY_FOR_REINSPECTION'
        )
          throw HttpError.conflict('Rework is not ready for this reinspection');
        const consumed = otherLines
          .filter((l) => l.sourceReworkTaskId === task.id)
          .reduce((n, l) => n + l.inspectedQuantity, 0);
        if (line.inspectedQuantity + consumed > task.assignedQuantity)
          throw HttpError.conflict('Reinspection exceeds the quantity sent for rework');
      } else {
        const consumed = otherLines
          .filter((l) => l.jobOrderLineSizeId === line.jobOrderLineSizeId && !l.sourceReworkTaskId)
          .reduce((n, l) => n + l.inspectedQuantity, 0);
        if (line.inspectedQuantity + consumed > size.preparedQuantity)
          throw HttpError.conflict('Inspection exceeds prepared quantity available');
      }
    }
    await tx.qaInspectionLine.deleteMany({ where: { inspectionSessionId: sessionId } });
    for (const line of input.lines) {
      await tx.qaInspectionLine.create({
        data: {
          id: createId(),
          inspectionSessionId: sessionId,
          jobOrderLineSizeId: line.jobOrderLineSizeId,
          sourceReworkTaskId: line.sourceReworkTaskId,
          inspectedQuantity: line.inspectedQuantity,
          acceptedQuantity: line.acceptedQuantity,
          reworkQuantity: line.reworkQuantity,
          permanentlyRejectedQuantity: line.permanentlyRejectedQuantity,
          defectCategory: line.defectCategory,
          defectNotes: line.defectNotes,
        },
      });
    }
    const updated = await tx.qaInspectionSession.update({
      where: { id: sessionId },
      data: { notes: input.notes, version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_INSPECTION_SAVED',
        entityType: 'QaInspectionSession',
        entityId: sessionId,
        metadata: { jobOrderId, lineCount: input.lines.length },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_SAVE', key, requestHash, updated.version);
  });
  return getDetail(user, jobOrderId);
}

export async function finalizeInspection(
  user: CurrentUser,
  sessionId: string,
  input: { expectedVersion: number },
  key: string,
) {
  const requestHash = hash(input);
  let jobOrderId = '';
  await prisma.$transaction(async (tx) => {
    const snapshot = await tx.qaInspectionSession.findUnique({
      where: { id: sessionId },
      select: { jobOrderId: true },
    });
    if (!snapshot) throw HttpError.notFound('Inspection session not found');
    jobOrderId = snapshot.jobOrderId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_FINALIZE', key, requestHash)) return;
    const session = await tx.qaInspectionSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { jobOrder: true, lines: true },
    });
    assertQaMutation(user, session.jobOrder.factoryId);
    if (session.inspectorId !== user.id && !isSupervisor(user))
      throw HttpError.forbidden('Only the inspector can finalize this draft');
    if (session.status !== 'DRAFT' || session.lines.length === 0)
      throw HttpError.conflict('Inspection has no finalizable draft');
    if (session.version !== input.expectedVersion) throw HttpError.staleVersion(session.version);
    const rejectedLines = session.lines.filter((l) => l.permanentlyRejectedQuantity > 0);
    if (rejectedLines.length) {
      const evidenced = await tx.qaEvidence.findMany({
        where: { inspectionSessionId: sessionId },
        select: { inspectionLineId: true },
      });
      const evidenceIds = new Set(evidenced.map((e) => e.inspectionLineId));
      if (rejectedLines.some((l) => !evidenceIds.has(l.id)))
        throw HttpError.badRequest('Photo evidence is required for permanent rejection');
    }
    for (const line of session.lines.filter((l) => l.reworkQuantity > 0)) {
      const attempt =
        (await tx.qaReworkTask.count({ where: { jobOrderLineSizeId: line.jobOrderLineSizeId } })) +
        1;
      await tx.qaReworkTask.create({
        data: {
          id: createId(),
          jobOrderId,
          jobOrderLineSizeId: line.jobOrderLineSizeId,
          sourceLineId: line.id,
          attemptNumber: attempt,
          assignedQuantity: line.reworkQuantity,
        },
      });
    }
    for (const line of session.lines.filter((l) => l.sourceReworkTaskId))
      await tx.qaReworkTask.update({
        where: { id: line.sourceReworkTaskId! },
        data: { status: 'CLOSED', version: { increment: 1 } },
      });
    const updatedSession = await tx.qaInspectionSession.update({
      where: { id: sessionId },
      data: { status: 'FINALIZED', finalizedAt: new Date(), version: { increment: 1 } },
    });
    const openRework = await tx.qaReworkTask.count({
      where: { jobOrderId, status: { not: 'CLOSED' } },
    });
    const nextStatus = openRework ? 'REWORK_REQUIRED' : 'QA_IN_PROGRESS';
    const updated = await tx.jobOrder.update({
      where: { id: jobOrderId },
      data: { status: nextStatus, version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_INSPECTION_FINALIZED',
        entityType: 'QaInspectionSession',
        entityId: sessionId,
        metadata: { jobOrderId, resultVersion: updatedSession.version },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_FINALIZE', key, requestHash, updated.version);
  });
  return getDetail(user, jobOrderId);
}

export async function approve(
  user: CurrentUser,
  jobOrderId: string,
  input: { expectedVersion: number },
  key: string,
) {
  const requestHash = hash(input);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_APPROVE', key, requestHash)) return;
    const job = await tx.jobOrder.findUnique({
      where: { id: jobOrderId },
      include: {
        lines: { include: { sizes: true } },
        qaInspections: { where: { status: 'FINALIZED' }, include: { lines: true } },
        qaReworkTasks: true,
      },
    });
    if (!job) throw HttpError.notFound('Job order not found');
    assertQaMutation(user, job.factoryId);
    if (job.version !== input.expectedVersion) throw HttpError.staleVersion(job.version);
    if (job.qaReworkTasks.some((t) => t.status !== 'CLOSED'))
      throw HttpError.conflict('Rework remains outstanding');
    const initial = job.qaInspections
      .flatMap((s) => s.lines)
      .filter((l) => !l.sourceReworkTaskId)
      .reduce((n, l) => n + l.inspectedQuantity, 0);
    if (initial !== job.preparedQuantityTotal)
      throw HttpError.conflict('Prepared quantities have not been fully inspected');
    const terminal = job.qaInspections
      .flatMap((s) => s.lines)
      .reduce((n, l) => n + l.acceptedQuantity + l.permanentlyRejectedQuantity, 0);
    if (terminal !== job.preparedQuantityTotal)
      throw HttpError.conflict('QA quantities do not reconcile to prepared quantity');
    const acceptedBySize = new Map<string, number>();
    for (const line of job.qaInspections.flatMap((s) => s.lines))
      acceptedBySize.set(
        line.jobOrderLineSizeId,
        (acceptedBySize.get(line.jobOrderLineSizeId) ?? 0) + line.acceptedQuantity,
      );
    for (const size of job.lines.flatMap((l) => l.sizes))
      await tx.distributorPurchaseOrderLineSize.update({
        where: { id: size.purchaseOrderLineSizeId },
        data: { qaPassedQuantity: { increment: acceptedBySize.get(size.id) ?? 0 } },
      });
    const updated = await tx.jobOrder.update({
      where: { id: jobOrderId },
      data: { status: 'QA_APPROVED', version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_APPROVED',
        entityType: 'JobOrder',
        entityId: jobOrderId,
        metadata: { approvedQuantity: [...acceptedBySize.values()].reduce((a, b) => a + b, 0) },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_APPROVE', key, requestHash, updated.version);
  });
  return getDetail(user, jobOrderId);
}

export async function updateRework(
  user: CurrentUser,
  taskId: string,
  action: 'ACKNOWLEDGE' | 'READY',
  input: { expectedVersion: number; notes?: string | null },
  key: string,
) {
  const requestHash = hash(input);
  let jobOrderId = '';
  await prisma.$transaction(async (tx) => {
    const snapshot = await tx.qaReworkTask.findUnique({
      where: { id: taskId },
      select: { jobOrderId: true },
    });
    if (!snapshot) throw HttpError.notFound('Rework task not found');
    jobOrderId = snapshot.jobOrderId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, `QA_REWORK_${action}`, key, requestHash))
      return;
    const task = await tx.qaReworkTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { jobOrder: { include: { factory: true } } },
    });
    assertFactoryMutation(user, task.jobOrder.factoryId);
    if (!isSupervisor(user) && task.jobOrder.factory.status !== 'ACTIVE')
      throw HttpError.conflict('This factory is inactive and cannot perform rework actions');
    if (task.version !== input.expectedVersion) throw HttpError.staleVersion(task.version);
    const expected = action === 'ACKNOWLEDGE' ? 'PENDING_ACKNOWLEDGEMENT' : 'ACKNOWLEDGED';
    if (task.status !== expected)
      throw HttpError.conflict(
        `Rework cannot be marked ${action.toLowerCase()} from its current status`,
      );
    const data =
      action === 'ACKNOWLEDGE'
        ? {
            status: 'ACKNOWLEDGED' as const,
            acknowledgedById: user.id,
            acknowledgedAt: new Date(),
            notes: input.notes,
            version: { increment: 1 },
          }
        : {
            status: 'READY_FOR_REINSPECTION' as const,
            readyById: user.id,
            readyAt: new Date(),
            notes: input.notes,
            version: { increment: 1 },
          };
    const updatedTask = await tx.qaReworkTask.update({ where: { id: taskId }, data });
    const status = action === 'READY' ? 'READY_FOR_REINSPECTION' : 'REWORK_REQUIRED';
    const updated = await tx.jobOrder.update({
      where: { id: jobOrderId },
      data: { status, version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: `QA_REWORK_${action}`,
        entityType: 'QaReworkTask',
        entityId: taskId,
        metadata: {
          jobOrderId,
          assignedQuantity: task.assignedQuantity,
          resultVersion: updatedTask.version,
        },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, `QA_REWORK_${action}`, key, requestHash, updated.version);
  });
  return toDetail(await load(jobOrderId));
}

export async function getFactoryReworkQueue(user: CurrentUser) {
  const factoryId = user.roles.includes('FACTORY_USER')
    ? user.factoryIds.length === 1
      ? user.factoryIds[0]!
      : (() => {
          throw user.factoryIds.length
            ? HttpError.factoryMappingAmbiguous()
            : HttpError.factoryMappingRequired();
        })()
    : null;
  if (!factoryId && !isSupervisor(user))
    throw HttpError.forbidden('You cannot view factory rework');
  const jobs = await prisma.jobOrder.findMany({
    where: {
      factoryId: factoryId ?? undefined,
      qaReworkTasks: { some: { status: { not: 'CLOSED' } } },
    },
    include: detailInclude,
  });
  return jobs.flatMap((job) =>
    job.qaReworkTasks.filter((t) => t.status !== 'CLOSED').map((task) => toRework(job, task)),
  );
}

export async function reopen(
  user: CurrentUser,
  sessionId: string,
  input: { expectedVersion: number; reason: string },
  key: string,
) {
  if (!isSupervisor(user)) throw HttpError.forbidden('Only admins and merchandisers may reopen QA');
  const session = await prisma.qaInspectionSession.findUnique({
    where: { id: sessionId },
    include: { jobOrder: true, lines: true },
  });
  if (!session) throw HttpError.notFound('Inspection session not found');
  if (session.jobOrder.status === 'QA_APPROVED')
    throw HttpError.conflict('Approved QA cannot be reopened after downstream release');
  const requestHash = hash(input);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${session.jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, session.jobOrderId, 'QA_REOPEN', key, requestHash)) return;
    const fresh = await tx.qaInspectionSession.findUniqueOrThrow({ where: { id: sessionId } });
    if (fresh.version !== input.expectedVersion) throw HttpError.staleVersion(fresh.version);
    if (fresh.status !== 'FINALIZED')
      throw HttpError.conflict('Only a finalized inspection can be reopened');
    if (
      await tx.qaReworkTask.count({
        where: { sourceLineId: { in: session.lines.map((l) => l.id) } },
      })
    )
      throw HttpError.conflict(
        'A session that generated rework cannot be reopened; use an explicit disposition reversal in a future slice',
      );
    const changed = await tx.qaInspectionSession.update({
      where: { id: sessionId },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenedById: user.id,
        reopenReason: input.reason,
        version: { increment: 1 },
      },
    });
    const updated = await tx.jobOrder.update({
      where: { id: session.jobOrderId },
      data: { status: 'QA_IN_PROGRESS', version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_INSPECTION_REOPENED',
        entityType: 'QaInspectionSession',
        entityId: sessionId,
        metadata: {
          jobOrderId: session.jobOrderId,
          reason: input.reason,
          resultVersion: changed.version,
        },
      },
      tx,
    );
    await finish(tx, user.id, session.jobOrderId, 'QA_REOPEN', key, requestHash, updated.version);
  });
  return getDetail(user, session.jobOrderId);
}
