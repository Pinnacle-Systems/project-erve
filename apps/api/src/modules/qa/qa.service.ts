import { createHash } from 'node:crypto';
import { canPerformQaOperation, createId } from '@erve/shared';
import type {
  PaginatedResponse,
  QaInspectionDetail,
  QaChecklistItemCode,
  QaQueueSummary,
  QaReworkTaskView,
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

async function deriveSessionStatus(tx: Tx, sessionId: string) {
  const forms = await tx.qaSizeInspectionForm.findMany({
    where: { inspectionSessionId: sessionId },
    select: { status: true },
  });
  const finalized = forms.length > 0 && forms.every((form) => form.status === 'FINALIZED');
  return tx.qaInspectionSession.update({
    where: { id: sessionId },
    data: finalized
      ? { status: 'FINALIZED', finalizedAt: new Date() }
      : { status: 'DRAFT', finalizedAt: null },
  });
}

const detailInclude = {
  factory: { select: { id: true, code: true, name: true } },
  purchaseOrder: {
    select: { poNumber: true, distributor: { select: { id: true, code: true, name: true } } },
  },
  seasonSnapshots: { select: { code: true, displayName: true } },
  lines: {
    include: {
      style: { select: { styleNumber: true, styleName: true, colour: true } },
      sizes: { include: { size: { select: { code: true, label: true, sortOrder: true } } } },
    },
  },
  qaInspections: {
    include: {
      inspector: { select: { id: true, name: true, email: true } },
      forms: { include: { checklist: true } },
      evidence: { include: { file: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  qaReworkTasks: { include: { sourceLine: true } },
} satisfies Prisma.JobOrderInclude;
type DetailRecord = Prisma.JobOrderGetPayload<{ include: typeof detailInclude }>;

const checklistOrder: QaChecklistItemCode[] = [
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
];

function derive(record: DetailRecord) {
  const activeSessions = record.qaInspections.filter(
    (session) => session.status !== 'REOPENED' && session.status !== 'VOIDED',
  );
  const finalizedLines = activeSessions
    .flatMap((session) => session.forms)
    .filter((form) => form.status === 'FINALIZED');
  const reservedFirstPass = activeSessions
    .flatMap((s) => s.forms)
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
    for (const line of session.forms) {
      const fact = lineFacts.get(line.jobOrderLineSizeId)!;
      if (!line.sourceReworkTaskId) fact.reserved += line.inspectedQuantity;
      if (line.status === 'FINALIZED') {
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
    distributor: record.purchaseOrder.distributor,
    seasons: record.seasonSnapshots.map((season) => ({
      code: season.code,
      displayName: season.displayName,
    })),
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
          colour: line.style.colour,
          sizeCode: size.size.code,
          sizeLabel: size.size.label,
          orderedQuantity: size.orderedQuantity,
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
      finalizedAt: session.finalizedAt?.toISOString() ?? null,
      reopenedAt: session.reopenedAt?.toISOString() ?? null,
      reopenReason: session.reopenReason,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      version: session.version,
      forms: session.forms.map((line) => {
        const size = record.lines
          .flatMap((l) => l.sizes.map((s) => ({ l, s })))
          .find(({ s }) => s.id === line.jobOrderLineSizeId)!;
        return {
          id: line.id,
          status: line.status,
          version: line.version,
          finalizedAt: line.finalizedAt?.toISOString() ?? null,
          reopenedAt: line.reopenedAt?.toISOString() ?? null,
          reopenReason: line.reopenReason,
          jobOrderLineSizeId: line.jobOrderLineSizeId,
          sourceReworkTaskId: line.sourceReworkTaskId,
          styleNumber: size.l.style.styleNumber,
          styleName: size.l.style.styleName,
          colour: size.l.style.colour,
          sizeCode: size.s.size.code,
          sizeLabel: size.s.size.label,
          preparedQuantity: size.s.preparedQuantity,
          sampleQuantity: line.sampleQuantity,
          checklist: checklistOrder.map((itemCode) => {
            const item = line.checklist.find((check) => check.itemCode === itemCode);
            return { itemCode, status: item?.status ?? null, remarks: item?.remarks ?? null };
          }),
          inspectionRemarks: line.inspectionRemarks,
          inspectedQuantity: line.inspectedQuantity,
          acceptedQuantity: line.acceptedQuantity,
          reworkQuantity: line.reworkQuantity,
          permanentlyRejectedQuantity: line.permanentlyRejectedQuantity,
          defectCategory: line.defectCategory,
          otherDefectDetails: line.otherDefectDetails,
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
        lines: { include: { sizes: true } },
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
    const eligible = selected.length
      ? selected.map((task) => ({
          jobOrderLineSizeId: task.jobOrderLineSizeId,
          sourceReworkTaskId: task.id,
        }))
      : job.lines
          .flatMap((line) => line.sizes)
          .filter((size) => size.preparedQuantity > 0)
          .map((size) => ({ jobOrderLineSizeId: size.id, sourceReworkTaskId: null }));
    if (!eligible.length)
      throw HttpError.conflict('No size allocations are available for inspection');
    await tx.qaInspectionSession.create({
      data: {
        id: sessionId,
        jobOrderId,
        inspectorId: user.id,
        cycleNumber: Math.max(0, ...job.qaInspections.map((s) => s.cycleNumber)) + 1,
        forms: {
          create: eligible.map((form) => ({
            id: createId(),
            jobOrderLineSizeId: form.jobOrderLineSizeId,
            sourceReworkTaskId: form.sourceReworkTaskId,
            inspectedQuantity: 0,
            acceptedQuantity: 0,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
            checklist: {
              create: checklistOrder.map((itemCode) => ({ id: createId(), itemCode })),
            },
          })),
        },
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

export async function saveSizeInspectionForm(
  user: CurrentUser,
  sessionId: string,
  formId: string,
  input: {
    expectedVersion: number;
    sampleQuantity?: number | null;
    inspectionRemarks?: string | null;
    checklist: Array<{
      itemCode: QaChecklistItemCode;
      status: 'YES' | 'NO' | 'AVAILABLE' | null;
      remarks: string | null;
    }>;
    inspectedQuantity: number;
    acceptedQuantity: number;
    reworkQuantity: number;
    permanentlyRejectedQuantity: number;
    defectCategory?:
      | 'STITCHING'
      | 'FABRIC'
      | 'PRINT_EMBROIDERY'
      | 'MEASUREMENT'
      | 'FINISHING'
      | 'PACKAGING'
      | 'OTHER'
      | null;
    otherDefectDetails?: string | null;
    defectNotes?: string | null;
  },
  key: string,
) {
  const requestHash = hash(input);
  let jobOrderId = '';
  await prisma.$transaction(async (tx) => {
    const form = await tx.qaSizeInspectionForm.findUnique({
      where: { id: formId },
      include: { session: { include: { jobOrder: true } }, checklist: true },
    });
    if (!form || form.inspectionSessionId !== sessionId)
      throw HttpError.notFound('Size inspection form not found');
    jobOrderId = form.session.jobOrderId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_FORM_SAVE', key, requestHash)) return;
    assertQaMutation(user, form.session.jobOrder.factoryId);
    if (form.session.inspectorId !== user.id && !isSupervisor(user))
      throw HttpError.forbidden('Only the inspector can edit this draft');
    if (form.version !== input.expectedVersion) throw HttpError.staleVersion(form.version);
    if (!['DRAFT', 'REOPENED'].includes(form.status))
      throw HttpError.conflict('Size inspection form is finalized');
    const size = await tx.jobOrderLineSize.findFirst({
      where: { id: form.jobOrderLineSizeId, jobOrderLine: { jobOrderId } },
    });
    if (!size) throw HttpError.badRequest('Size inspection form does not belong to this job order');
    const other = await tx.qaSizeInspectionForm.findMany({
      where: {
        id: { not: formId },
        jobOrderLineSizeId: form.jobOrderLineSizeId,
        status: { in: ['DRAFT', 'FINALIZED'] },
      },
    });
    const consumed = other
      .filter((candidate) => candidate.sourceReworkTaskId === form.sourceReworkTaskId)
      .reduce((sum, candidate) => sum + candidate.inspectedQuantity, 0);
    const capacity = form.sourceReworkTaskId
      ? (await tx.qaReworkTask.findUniqueOrThrow({ where: { id: form.sourceReworkTaskId } }))
          .assignedQuantity
      : size.preparedQuantity;
    if (consumed + input.inspectedQuantity > capacity)
      throw HttpError.badRequest('Inspection exceeds quantity available for this size', {
        issues: [
          {
            qaSizeInspectionFormId: formId,
            jobOrderLineSizeId: form.jobOrderLineSizeId,
            field: 'quantities',
            message:
              'Accepted, rework and rejected quantities exceed the remaining inspectable quantity.',
          },
        ],
      });
    const normalized = {
      sampleQuantity: input.sampleQuantity ?? null,
      inspectionRemarks: input.inspectionRemarks?.trim() || null,
      inspectedQuantity: input.inspectedQuantity,
      acceptedQuantity: input.acceptedQuantity,
      reworkQuantity: input.reworkQuantity,
      permanentlyRejectedQuantity: input.permanentlyRejectedQuantity,
      defectCategory: input.defectCategory ?? null,
      otherDefectDetails:
        input.defectCategory === 'OTHER' ? input.otherDefectDetails?.trim() || null : null,
      defectNotes: input.defectNotes?.trim() || null,
      checklist: input.checklist
        .map((item) => ({
          itemCode: item.itemCode,
          status: item.status,
          remarks: item.remarks?.trim() || null,
        }))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    };
    const existing = {
      sampleQuantity: form.sampleQuantity,
      inspectionRemarks: form.inspectionRemarks,
      inspectedQuantity: form.inspectedQuantity,
      acceptedQuantity: form.acceptedQuantity,
      reworkQuantity: form.reworkQuantity,
      permanentlyRejectedQuantity: form.permanentlyRejectedQuantity,
      defectCategory: form.defectCategory,
      otherDefectDetails: form.otherDefectDetails,
      defectNotes: form.defectNotes,
      checklist: form.checklist
        .map((item) => ({ itemCode: item.itemCode, status: item.status, remarks: item.remarks }))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    };
    if (JSON.stringify(normalized) === JSON.stringify(existing)) {
      await finish(tx, user.id, jobOrderId, 'QA_FORM_SAVE', key, requestHash, form.version);
      return;
    }
    await tx.qaSizeInspectionChecklistItem.deleteMany({ where: { inspectionFormId: formId } });
    const updated = await tx.qaSizeInspectionForm.update({
      where: { id: formId },
      data: {
        ...normalized,
        status: 'DRAFT',
        checklist: {
          createMany: { data: normalized.checklist.map((item) => ({ id: createId(), ...item })) },
        },
        version: { increment: 1 },
      },
    });
    await deriveSessionStatus(tx, sessionId);
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_SIZE_FORM_SAVED',
        entityType: 'QaSizeInspectionForm',
        entityId: formId,
        metadata: {
          jobOrderId,
          sessionId,
          jobOrderLineSizeId: form.jobOrderLineSizeId,
          resultVersion: updated.version,
        },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_FORM_SAVE', key, requestHash, updated.version);
  });
  return getDetail(user, jobOrderId);
}

export async function finalizeSizeInspectionForm(
  user: CurrentUser,
  sessionId: string,
  formId: string,
  input: { expectedVersion: number },
  key: string,
) {
  const requestHash = hash(input);
  let jobOrderId = '';
  await prisma.$transaction(async (tx) => {
    const form = await tx.qaSizeInspectionForm.findUnique({
      where: { id: formId },
      include: { checklist: true, session: { include: { jobOrder: true } } },
    });
    if (!form || form.inspectionSessionId !== sessionId)
      throw HttpError.notFound('Size inspection form not found');
    jobOrderId = form.session.jobOrderId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_FORM_FINALIZE', key, requestHash)) return;
    assertQaMutation(user, form.session.jobOrder.factoryId);
    if (form.session.inspectorId !== user.id && !isSupervisor(user))
      throw HttpError.forbidden('Only the inspector can finalize this form');
    if (form.version !== input.expectedVersion) throw HttpError.staleVersion(form.version);
    if (form.status !== 'DRAFT')
      throw HttpError.conflict('Size inspection form is already finalized');
    const capacity = form.sourceReworkTaskId
      ? (await tx.qaReworkTask.findUniqueOrThrow({ where: { id: form.sourceReworkTaskId } }))
          .assignedQuantity
      : (
          await tx.jobOrderLineSize.findUniqueOrThrow({
            where: { id: form.jobOrderLineSizeId },
          })
        ).preparedQuantity;
    const incomplete: Array<{ field: string; message: string }> = [];
    if (form.sampleQuantity === null)
      incomplete.push({ field: 'sampleQuantity', message: 'Sample quantity is required.' });
    if (
      form.checklist.length !== checklistOrder.length ||
      form.checklist.some((item) => item.status === null)
    )
      incomplete.push({ field: 'checklist', message: 'Every checklist response is required.' });
    if (form.inspectedQuantity !== capacity)
      incomplete.push({
        field: 'quantities',
        message: `Final quantities must reconcile to ${capacity}.`,
      });
    if (
      (form.reworkQuantity > 0 || form.permanentlyRejectedQuantity > 0) &&
      !form.defectCategory
    )
      incomplete.push({ field: 'defectCategory', message: 'A defect category is required.' });
    if (form.defectCategory === 'OTHER' && !form.otherDefectDetails?.trim())
      incomplete.push({
        field: 'otherDefectDetails',
        message: 'Other defect details are required.',
      });
    if (incomplete.length)
      throw HttpError.badRequest('Size inspection form is incomplete', {
        issues: incomplete.map((issue) => ({
          qaSizeInspectionFormId: formId,
          jobOrderLineSizeId: form.jobOrderLineSizeId,
          ...issue,
        })),
      });
    if (form.permanentlyRejectedQuantity > 0) {
      const evidence = await tx.qaEvidence.count({
        where: { inspectionSessionId: sessionId, inspectionLineId: formId },
      });
      if (!evidence)
        throw HttpError.badRequest('Photo evidence is required for permanent rejection');
    }
    if (form.reworkQuantity > 0) {
      const attempt =
        (await tx.qaReworkTask.count({ where: { jobOrderLineSizeId: form.jobOrderLineSizeId } })) +
        1;
      await tx.qaReworkTask.create({
        data: {
          id: createId(),
          jobOrderId,
          jobOrderLineSizeId: form.jobOrderLineSizeId,
          sourceLineId: formId,
          attemptNumber: attempt,
          assignedQuantity: form.reworkQuantity,
        },
      });
    }
    if (form.sourceReworkTaskId)
      await tx.qaReworkTask.update({
        where: { id: form.sourceReworkTaskId },
        data: { status: 'CLOSED', version: { increment: 1 } },
      });
    const updated = await tx.qaSizeInspectionForm.update({
      where: { id: formId },
      data: { status: 'FINALIZED', finalizedAt: new Date(), version: { increment: 1 } },
    });
    const session = await deriveSessionStatus(tx, sessionId);
    const openRework = await tx.qaReworkTask.count({
      where: { jobOrderId, status: { not: 'CLOSED' } },
    });
    await tx.jobOrder.update({
      where: { id: jobOrderId },
      data: {
        status: openRework ? 'REWORK_REQUIRED' : 'QA_IN_PROGRESS',
        version: { increment: 1 },
      },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_SIZE_FORM_FINALIZED',
        entityType: 'QaSizeInspectionForm',
        entityId: formId,
        metadata: {
          jobOrderId,
          sessionId,
          jobOrderLineSizeId: form.jobOrderLineSizeId,
          sessionStatus: session.status,
          resultVersion: updated.version,
        },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_FORM_FINALIZE', key, requestHash, updated.version);
  });
  return getDetail(user, jobOrderId);
}

export async function reopenSizeInspectionForm(
  user: CurrentUser,
  sessionId: string,
  formId: string,
  input: { expectedVersion: number; reason: string },
  key: string,
) {
  if (!user.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER'))
    throw HttpError.forbidden('Only admins and merchandisers may reopen QA');
  const requestHash = hash(input);
  let jobOrderId = '';
  await prisma.$transaction(async (tx) => {
    const form = await tx.qaSizeInspectionForm.findUnique({
      where: { id: formId },
      include: { session: { include: { jobOrder: true } } },
    });
    if (!form || form.inspectionSessionId !== sessionId)
      throw HttpError.notFound('Size inspection form not found');
    jobOrderId = form.session.jobOrderId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${jobOrderId}`}))`;
    if (await replayOrLock(tx, user.id, jobOrderId, 'QA_FORM_REOPEN', key, requestHash)) return;
    if (form.session.jobOrder.status === 'QA_APPROVED')
      throw HttpError.conflict('Approved QA cannot be reopened after downstream release');
    if (form.version !== input.expectedVersion) throw HttpError.staleVersion(form.version);
    if (form.status !== 'FINALIZED')
      throw HttpError.conflict('Only a finalized size inspection form can be reopened');
    if (await tx.qaReworkTask.count({ where: { sourceLineId: formId } }))
      throw HttpError.conflict('A form that generated rework cannot be reopened');
    const changed = await tx.qaSizeInspectionForm.update({
      where: { id: formId },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenedById: user.id,
        reopenReason: input.reason,
        version: { increment: 1 },
      },
    });
    const session = await deriveSessionStatus(tx, sessionId);
    await tx.jobOrder.update({
      where: { id: jobOrderId },
      data: { status: 'QA_IN_PROGRESS', version: { increment: 1 } },
    });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QA_SIZE_FORM_REOPENED',
        entityType: 'QaSizeInspectionForm',
        entityId: formId,
        metadata: {
          jobOrderId,
          sessionId,
          jobOrderLineSizeId: form.jobOrderLineSizeId,
          reason: input.reason,
          sessionStatus: session.status,
          resultVersion: changed.version,
        },
      },
      tx,
    );
    await finish(tx, user.id, jobOrderId, 'QA_FORM_REOPEN', key, requestHash, changed.version);
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
        qaInspections: { where: { status: 'FINALIZED' }, include: { forms: true } },
        qaReworkTasks: true,
      },
    });
    if (!job) throw HttpError.notFound('Job order not found');
    assertQaMutation(user, job.factoryId);
    if (job.version !== input.expectedVersion) throw HttpError.staleVersion(job.version);
    if (job.qaReworkTasks.some((t) => t.status !== 'CLOSED'))
      throw HttpError.conflict('Rework remains outstanding');
    const initial = job.qaInspections
      .flatMap((s) => s.forms)
      .filter((l) => !l.sourceReworkTaskId)
      .reduce((n, l) => n + l.inspectedQuantity, 0);
    if (initial !== job.preparedQuantityTotal)
      throw HttpError.conflict('Prepared quantities have not been fully inspected');
    const terminal = job.qaInspections
      .flatMap((s) => s.forms)
      .reduce((n, l) => n + l.acceptedQuantity + l.permanentlyRejectedQuantity, 0);
    if (terminal !== job.preparedQuantityTotal)
      throw HttpError.conflict('QA quantities do not reconcile to prepared quantity');
    const acceptedBySize = new Map<string, number>();
    for (const line of job.qaInspections.flatMap((s) => s.forms))
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
