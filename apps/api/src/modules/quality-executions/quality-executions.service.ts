import { createHash } from 'node:crypto';
import { canPerformQaOperation, createId } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { env } from '../../config/env.js';
import { FileNotFoundInStorageError, getFileStorage } from '../../storage/index.js';
import { sanitizeDisplayFileName, sniffImage } from '../../storage/image-sniff.js';
import type { QualityExecutionPayload } from './quality-executions.validation.js';
import type { QualityExecutionValidationError } from '@erve/types';

type Config = Record<string, unknown>;
type DefinitionComponent = {
  id: string;
  type: string;
  title: string;
  sequence: number;
  config: unknown;
};
const executionInclude = {
  startedBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  processFlowActivity: { include: { associatedProductionActivity: true } },
  qualityFormVersion: {
    include: {
      qualityForm: true,
      sections: {
        orderBy: { sequence: 'asc' as const },
        include: { components: { orderBy: { sequence: 'asc' as const } } },
      },
    },
  },
  checklistResponses: true,
  aqlResults: true,
  defects: true,
  correctiveActions: true,
  testResults: true,
  quantities: true,
  comments: true,
  fieldResponses: true,
  attendeeResponses: true,
  actionResponses: true,
  signoffs: true,
  attachments: { include: { file: true } },
  ppSampleSession: {
    include: { forms: { include: { jobOrderLineSize: { include: { size: true } } } } },
  },
} satisfies Prisma.QualityActivityExecutionInclude;
type Execution = Prisma.QualityActivityExecutionGetPayload<{ include: typeof executionInclude }>;

function assertMutation(user: CurrentUser) {
  if (!canPerformQaOperation(user))
    throw HttpError.forbidden('Only QA operations users may execute quality activities');
}
function config(component: DefinitionComponent): Config {
  return component.config as Config;
}
function components(execution: Execution): DefinitionComponent[] {
  return execution.qualityFormVersion.sections.flatMap((section) => section.components);
}
function componentMap(execution: Execution) {
  return new Map(components(execution).map((item) => [item.id, item]));
}
function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}
function assertComponent(map: Map<string, DefinitionComponent>, id: string, expected: string) {
  const item = map.get(id);
  if (!item) throw HttpError.badRequest('Response component does not belong to this form version');
  if (item.type !== expected)
    throw HttpError.badRequest(`Component ${id} does not accept this response type`);
  return item;
}
function assertOption(value: string, allowed: unknown, message: string) {
  if (!Array.isArray(allowed) || !allowed.includes(value)) throw HttpError.badRequest(message);
}
function assertCell(value: unknown, column: Record<string, unknown>) {
  const type = column.dataType;
  if (value == null || value === '') return;
  if (type === 'NUMBER' && (typeof value !== 'number' || !Number.isFinite(value)))
    throw HttpError.badRequest('Corrective action number is invalid');
  if (type === 'BOOLEAN' && typeof value !== 'boolean')
    throw HttpError.badRequest('Corrective action Boolean is invalid');
  if (['TEXT', 'DATE', 'SELECT'].includes(String(type)) && typeof value !== 'string')
    throw HttpError.badRequest('Corrective action value is invalid');
  if (type === 'SELECT')
    assertOption(String(value), column.options, 'Corrective action option is invalid');
}

function validatePayload(execution: Execution, input: QualityExecutionPayload, finalize: boolean) {
  const map = componentMap(execution);
  for (const response of input.checklistResponses) {
    const item = assertComponent(map, response.componentId, 'CHECKLIST');
    const cfg = config(item);
    const definition = list(cfg.items).find((x) => x.key === response.itemKey);
    if (!definition) throw HttpError.badRequest('Unknown checklist item');
    assertOption(response.response, cfg.responseOptions, 'Checklist option is not configured');
  }
  for (const response of input.aqlResults) {
    const item = assertComponent(map, response.componentId, 'AQL_RESULT');
    if (!list(config(item).criteria).some((x) => x.severity === response.severity))
      throw HttpError.badRequest('AQL severity is not configured');
  }
  for (const response of input.defects) {
    const item = assertComponent(map, response.componentId, 'DEFECT_LIST');
    assertOption(response.severity, config(item).severities, 'Defect severity is not configured');
    if (response.quantity != null && config(item).captureQuantity !== true)
      throw HttpError.badRequest('This defect component does not capture quantity');
  }
  for (const response of input.correctiveActions) {
    const item = assertComponent(map, response.componentId, 'CORRECTIVE_ACTIONS');
    const columns = list(config(item).columns);
    const keys = Object.keys(response.values);
    if (keys.some((key) => !columns.some((column) => column.key === key)))
      throw HttpError.badRequest('Unknown corrective action column');
    columns.forEach((column) => assertCell(response.values[String(column.key)], column));
  }
  for (const response of input.testResults) {
    const item = assertComponent(map, response.componentId, 'TEST_RESULTS');
    const test = list(config(item).tests).find((x) => x.key === response.testKey);
    if (!test) throw HttpError.badRequest('Unknown configured test');
    assertOption(response.response, test.responseOptions, 'Test response option is not configured');
  }
  for (const response of input.quantities) {
    const item = assertComponent(map, response.componentId, 'QUANTITY_RECONCILIATION');
    const field = list(config(item).fields).find((x) => x.key === response.fieldKey);
    if (!field) throw HttpError.badRequest('Unknown quantity field');
    if (field.source === 'SYSTEM')
      throw HttpError.badRequest('System-derived quantities are read-only');
    if (field.dataType !== 'NUMBER')
      throw HttpError.badRequest('Quantity response must target a numeric field');
  }
  for (const response of input.comments) {
    const item = assertComponent(map, response.componentId, 'COMMENTS');
    const max = config(item).maxLength;
    if (typeof max === 'number' && response.value.length > max)
      throw HttpError.badRequest('Comment exceeds configured maximum length');
  }
  for (const response of input.fieldResponses) {
    const item = assertComponent(map, response.componentId, 'FIELD_GROUP');
    const field = list(config(item).fields).find((x) => x.key === response.fieldKey);
    if (!field) throw HttpError.badRequest('Unknown report field');
    if (field.source === 'SYSTEM') throw HttpError.badRequest('System report fields are read-only');
    if (field.dataType === 'DATE' && response.value && !/^\d{4}-\d{2}-\d{2}$/.test(response.value))
      throw HttpError.badRequest('Report date must use YYYY-MM-DD');
    if (field.dataType === 'NUMBER' && response.value && !Number.isFinite(Number(response.value)))
      throw HttpError.badRequest('Report number is invalid');
    if (field.dataType === 'SELECT')
      assertOption(response.value, field.options, 'Report field option is invalid');
  }
  for (const response of input.attendees) {
    const item = assertComponent(map, response.componentId, 'ATTENDEE_LIST');
    const roles = config(item).roles;
    const configured =
      Array.isArray(roles) &&
      roles.some((role) =>
        typeof role === 'string'
          ? role === response.roleKey
          : (role as Record<string, unknown>).key === response.roleKey,
      );
    if (!configured && !(config(item).allowOther === true && response.roleKey === 'other'))
      throw HttpError.badRequest('Attendee role is not configured');
  }
  for (const response of input.actions) {
    const item = assertComponent(map, response.componentId, 'ACTION_LIST');
    const columns = list(config(item).columns);
    if (Object.keys(response.values).some((key) => !columns.some((column) => column.key === key)))
      throw HttpError.badRequest('Unknown follow-up action column');
    columns.forEach((column) => assertCell(response.values[String(column.key)], column));
  }
  for (const response of input.signoffs) {
    const item = assertComponent(map, response.componentId, 'SIGNATURES');
    if (!list(config(item).roles).some((x) => x.key === response.roleKey))
      throw HttpError.badRequest('Unknown sign-off role');
  }
  if (input.outcome) {
    const item = assertComponent(map, input.outcome.componentId, 'INSPECTION_OUTCOME');
    assertOption(
      input.outcome.value,
      config(item).allowedOutcomes,
      'Inspection outcome is not configured',
    );
  }
  if (!finalize) return;
  const missing: QualityExecutionValidationError[] = [];
  const add = (
    item: DefinitionComponent,
    fieldKey: string,
    fieldLabel: string,
    message: string,
    rowIndex?: number,
  ) => {
    const section = execution.qualityFormVersion.sections.find((candidate) =>
      candidate.components.some((component) => component.id === item.id),
    )!;
    missing.push({
      sectionId: section.id,
      sectionTitle: section.title,
      componentId: item.id,
      componentTitle: item.title,
      fieldKey,
      fieldLabel,
      ...(rowIndex === undefined ? {} : { rowIndex }),
      code: 'REQUIRED',
      message,
    });
  };
  for (const item of components(execution)) {
    const cfg = config(item);
    if (item.type === 'CHECKLIST')
      for (const definition of list(cfg.items))
        if (
          !input.checklistResponses.some(
            (x) => x.componentId === item.id && x.itemKey === definition.key,
          )
        )
          add(
            item,
            String(definition.key),
            String(definition.label),
            `${String(definition.label)} is required`,
          );
    if (item.type === 'AQL_RESULT')
      for (const criterion of list(cfg.criteria)) {
        const row = input.aqlResults.find(
          (x) => x.componentId === item.id && x.severity === criterion.severity,
        );
        if (!row || row.maxAllowed == null)
          add(
            item,
            `${String(criterion.severity)}.maxAllowed`,
            `${String(criterion.severity)} max`,
            `${String(criterion.severity)} AQL max is required`,
          );
        if (!row || row.found == null)
          add(
            item,
            `${String(criterion.severity)}.found`,
            `${String(criterion.severity)} found`,
            `${String(criterion.severity)} AQL found is required`,
          );
      }
    if (item.type === 'TEST_RESULTS')
      for (const test of list(cfg.tests))
        if (!input.testResults.some((x) => x.componentId === item.id && x.testKey === test.key))
          add(item, String(test.key), String(test.label), `${String(test.label)} is required`);
    if (item.type === 'QUANTITY_RECONCILIATION')
      for (const field of list(cfg.fields))
        if (
          field.required === true &&
          field.source !== 'SYSTEM' &&
          !input.quantities.some((x) => x.componentId === item.id && x.fieldKey === field.key)
        )
          add(item, String(field.key), String(field.label), `${String(field.label)} is required`);
    if (
      item.type === 'COMMENTS' &&
      cfg.required === true &&
      !input.comments.find((x) => x.componentId === item.id)?.value.trim()
    )
      add(item, 'value', item.title, `${item.title} is required`);
    if (item.type === 'FIELD_GROUP')
      for (const field of list(cfg.fields))
        if (
          field.required === true &&
          field.source !== 'SYSTEM' &&
          !input.fieldResponses.some(
            (response) =>
              response.componentId === item.id &&
              response.fieldKey === field.key &&
              response.value.trim(),
          )
        )
          add(item, String(field.key), String(field.label), `${String(field.label)} is required`);
    if (item.type === 'ATTENDEE_LIST')
      for (const role of list(cfg.roles))
        if (
          role.required === true &&
          !input.attendees.some(
            (response) =>
              response.componentId === item.id &&
              response.roleKey === role.key &&
              response.attendeeName.trim(),
          )
        )
          add(item, String(role.key), String(role.label), `${String(role.label)} is required`);
    if (item.type === 'ACTION_LIST') {
      const componentRows = input.actions.filter((response) => response.componentId === item.id);
      componentRows.forEach((response, rowIndex) => {
        for (const column of list(cfg.columns))
          if (column.required === true && !String(response.values[String(column.key)] ?? '').trim())
            add(
              item,
              String(column.key),
              String(column.label),
              `${String(column.label)} is required`,
              rowIndex,
            );
      });
    }
    if (item.type === 'CORRECTIVE_ACTIONS') {
      const componentRows = input.correctiveActions.filter(
        (response) => response.componentId === item.id,
      );
      componentRows.forEach((response, rowIndex) => {
        for (const column of list(cfg.columns))
          if (column.required === true && !String(response.values[String(column.key)] ?? '').trim())
            add(
              item,
              String(column.key),
              String(column.label),
              `${String(column.label)} is required`,
              rowIndex,
            );
      });
    }
    if (item.type === 'SIGNATURES')
      for (const role of list(cfg.roles))
        if (
          role.required === true &&
          !input.signoffs.some((x) => x.componentId === item.id && x.roleKey === role.key)
        )
          add(item, String(role.key), String(role.label), `${String(role.label)} is required`);
    if (item.type === 'INSPECTION_OUTCOME') {
      if (input.outcome?.componentId !== item.id)
        add(item, 'value', item.title, `${item.title} is required`);
      else if (cfg.remarksRequiredWhen === input.outcome.value && !input.outcome.remarks?.trim())
        add(item, 'remarks', 'Outcome remarks', 'Outcome remarks are required');
    }
    if (item.type === 'ATTACHMENTS')
      for (const requirement of list(cfg.requirements)) {
        const required =
          requirement.required === true ||
          requirement.requiredWhen === 'ALWAYS' ||
          (requirement.requiredWhen === 'INSPECTION_FAILED' && input.outcome?.value === 'FAIL');
        if (
          required &&
          !execution.attachments.some(
            (x) => x.componentId === item.id && x.requirementKey === requirement.key,
          )
        )
          add(
            item,
            String(requirement.key),
            String(requirement.label),
            `${String(requirement.label)} is required`,
          );
      }
  }
  if (missing.length)
    throw HttpError.badRequest('Please complete the required fields', {
      validationErrors: missing,
    });
}

function derivedSystemContext(
  jobOrder: Awaited<ReturnType<typeof loadJobOrder>>,
  sourceKey: string,
) {
  const styles = [...new Set(jobOrder.lines.map((line) => line.style.styleNumber))];
  const colours = [...new Set(jobOrder.lines.map((line) => line.style.colour).filter(Boolean))];
  const value: Record<string, unknown> = {
    SUPPLIER_NAME: jobOrder.factory.name,
    FACTORY_NAME: jobOrder.factory.name,
    STYLE_NUMBER: styles.join(', '),
    CUSTOMER_NAME: jobOrder.purchaseOrder.distributor.name,
    PURCHASE_ORDER_NUMBER: jobOrder.purchaseOrder.poNumber,
    JOB_ORDER_NUMBER: jobOrder.jobOrderNumber,
    ORDER_QUANTITY: jobOrder.lines.reduce((sum, line) => sum + line.orderedQuantityTotal, 0),
    REPORT_DATE: new Date().toISOString().slice(0, 10),
    ETD: jobOrder.purchaseOrder.requiredDeliveryDate?.toISOString().slice(0, 10) ?? null,
    COLOUR: colours.join(', ') || null,
    SHIP_QUANTITY: null,
    MERCHANDISER_NAME: jobOrder.purchaseOrder.merchandiser?.name ?? null,
    CUTTING_PLANNING_DATE: null,
    SEWING_PLANNING_DATE: null,
    MEETING_CONDUCTED_BY: null,
  };
  return {
    value: value[sourceKey] ?? null,
    available:
      Object.hasOwn(value, sourceKey) &&
      ![
        'SHIP_QUANTITY',
        'CUTTING_PLANNING_DATE',
        'SEWING_PLANNING_DATE',
        'MEETING_CONDUCTED_BY',
      ].includes(sourceKey),
  };
}
async function loadJobOrder(jobOrderId: string) {
  const item = await prisma.jobOrder.findUnique({
    where: { id: jobOrderId },
    include: {
      factory: true,
      purchaseOrder: { include: { distributor: true, merchandiser: true } },
      lines: { include: { style: true, purchaseOrderLine: true } },
      stageStatuses: true,
      qualityExecutions: {
        select: {
          id: true,
          processFlowActivityId: true,
          attemptNumber: true,
          batchNumber: true,
          status: true,
          inspectedQuantity: true,
          outcome: true,
          finalizedAt: true,
        },
        orderBy: { batchNumber: 'asc' },
      },
      processFlowVersion: {
        include: {
          stages: {
            include: {
              qualityFormVersion: {
                include: { qualityForm: true, sections: { include: { components: true } } },
              },
              associatedProductionActivity: true,
            },
          },
        },
      },
    },
  });
  if (!item) throw HttpError.notFound('Job order not found');
  return item;
}
function planned(jobOrder: Awaited<ReturnType<typeof loadJobOrder>>) {
  return jobOrder.lines.reduce((sum, line) => sum + line.orderedQuantityTotal, 0);
}
function eligible(
  jobOrder: Awaited<ReturnType<typeof loadJobOrder>>,
  activity: (typeof jobOrder.processFlowVersion.stages)[number],
) {
  const associated = jobOrder.stageStatuses.find(
    (x) => x.processFlowVersionStageId === activity.associatedProductionActivityId,
  );
  if (activity.qualityAvailabilityPolicy === 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE')
    return associated?.status === 'IN_PROGRESS';
  if (activity.qualityAvailabilityPolicy === 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES')
    return associated?.status === 'COMPLETED';
  if (
    activity.qualityAvailabilityPolicy === 'PROGRESS_PERCENTAGE' &&
    associated?.completedQuantity != null &&
    activity.progressThresholdPercent
  )
    return (
      BigInt(associated.completedQuantity) * 10000n >=
      BigInt(planned(jobOrder)) *
        BigInt(Math.round(Number(activity.progressThresholdPercent) * 100))
    );
  if (activity.qualityExecutionMode === 'SEQUENTIAL_GATE') {
    const prior = [...jobOrder.processFlowVersion.stages]
      .filter(
        (candidate) =>
          candidate.sequence < activity.sequence &&
          candidate.status === 'ACTIVE' &&
          (candidate.activityType === 'PRODUCTION' ||
            candidate.qualityExecutionMode === 'SEQUENTIAL_GATE'),
      )
      .sort((a, b) => b.sequence - a.sequence)[0];
    if (!prior) return jobOrder.factoryConfirmationStatus === 'CONFIRMED';
    if (prior.activityType === 'PRODUCTION')
      return jobOrder.stageStatuses.some(
        (runtime) =>
          runtime.processFlowVersionStageId === prior.id && runtime.status === 'COMPLETED',
      );
    const priorExecutions = jobOrder.qualityExecutions.filter(
      (candidate) =>
        candidate.processFlowActivityId === prior.id && candidate.status === 'FINALIZED',
    );
    return prior.gateSatisfactionRequirement === 'OUTCOME_PASS'
      ? priorExecutions.some((candidate) => candidate.outcome === 'PASS')
      : priorExecutions.length > 0;
  }
  return false;
}

export async function start(
  user: CurrentUser,
  jobOrderId: string,
  processFlowActivityId: string,
  input: {
    sampleJobOrderLineSizeId?: string;
    sampleQuantity?: number;
    inspectedQuantity?: number;
  } = {},
) {
  assertMutation(user);
  const jobOrder = await loadJobOrder(jobOrderId);
  const activity = jobOrder.processFlowVersion.stages.find((x) => x.id === processFlowActivityId);
  if (!activity || activity.activityType !== 'QUALITY')
    throw HttpError.badRequest('Quality activity does not belong to this job order');
  const form = activity.qualityFormVersion;
  if (!form)
    throw HttpError.badRequest('This Quality activity is not supported by the execution runtime');
  const ppSample =
    activity.qualityExecutionMode === 'SEQUENTIAL_GATE' && form.executionScope === 'SIZE';
  const genericSupported =
    form.executionScope === 'JOB_ORDER' &&
    ((activity.qualityExecutionMode === 'IN_PROCESS' && form.activityType === 'INSPECTION') ||
      (activity.qualityExecutionMode === 'SEQUENTIAL_GATE' && form.activityType === 'MEETING'));
  if (!ppSample && !genericSupported)
    throw HttpError.badRequest('This Quality activity is not supported by the execution runtime');
  if (ppSample && (!input.sampleJobOrderLineSizeId || !input.sampleQuantity))
    throw HttpError.badRequest('Select one Job Order size and a positive sample quantity');
  if (!ppSample && (input.sampleJobOrderLineSizeId || input.sampleQuantity))
    throw HttpError.badRequest('Sample context is only valid for a size-scoped sequential gate');
  if (activity.executionMultiplicity === 'BATCHED' && !input.inspectedQuantity)
    throw HttpError.badRequest('A positive inspected quantity is required for this batch');
  if (activity.executionMultiplicity !== 'BATCHED' && input.inspectedQuantity)
    throw HttpError.badRequest('Inspected quantity is only valid for batched Quality activities');
  const supported = new Set([
    'SYSTEM_CONTEXT',
    'AQL_RESULT',
    'PRODUCTION_PROGRESS',
    'DEFECT_LIST',
    'CHECKLIST',
    'CORRECTIVE_ACTIONS',
    'COMMENTS',
    'INSPECTION_OUTCOME',
    'SIGNATURES',
    'ATTACHMENTS',
    'QUANTITY_RECONCILIATION',
    'TEST_RESULTS',
    'FIELD_GROUP',
    'ATTENDEE_LIST',
    'ACTION_LIST',
  ]);
  const definitionComponents = form.sections.flatMap((section) => section.components);
  if (definitionComponents.some((item) => !supported.has(item.type)))
    throw HttpError.badRequest(
      'This form contains components not supported by inspection execution',
    );
  for (const item of definitionComponents) {
    const cfg = item.config as Config;
    if (
      item.type === 'SYSTEM_CONTEXT' &&
      list(cfg.fields).some((field) => typeof field.sourceKey !== 'string')
    )
      throw HttpError.conflict(
        'Published form lacks stable system-context source identifiers; create and reference a corrected form version',
      );
    if (
      item.type === 'QUANTITY_RECONCILIATION' &&
      list(cfg.fields).some(
        (field) => field.source === 'SYSTEM' && typeof field.sourceKey !== 'string',
      )
    )
      throw HttpError.conflict(
        'Published form lacks stable system quantity source identifiers; create and reference a corrected form version',
      );
    if (item.type === 'PRODUCTION_PROGRESS')
      for (const metric of list(cfg.metrics)) {
        if (
          typeof metric.sourceActivityCode !== 'string' ||
          !jobOrder.processFlowVersion.stages.some(
            (stage) =>
              stage.activityType === 'PRODUCTION' && stage.code === metric.sourceActivityCode,
          )
        )
          throw HttpError.conflict(
            'Production progress cannot be resolved by stable activity code for this Process Flow version',
          );
      }
  }
  const existing = await prisma.qualityActivityExecution.findFirst({
    where: { jobOrderId, processFlowActivityId },
    include: executionInclude,
    orderBy: { attemptNumber: 'desc' },
  });
  if (existing?.status === 'DRAFT') {
    if (
      (ppSample &&
        (existing.sampleJobOrderLineSizeId !== input.sampleJobOrderLineSizeId ||
          existing.sampleQuantity !== input.sampleQuantity)) ||
      (activity.executionMultiplicity === 'BATCHED' &&
        existing.inspectedQuantity !== input.inspectedQuantity)
    )
      throw HttpError.conflict('Inspection context is locked after the execution starts');
    return toView(existing, jobOrder);
  }
  if (
    existing &&
    activity.executionMultiplicity !== 'BATCHED' &&
    (!ppSample || existing.outcome === 'PASS')
  )
    throw HttpError.conflict(
      ppSample
        ? 'PP Sample gate is already satisfied by a finalized PASS cycle'
        : 'A finalized initial attempt already exists; reinspection is not implemented',
    );
  if (!eligible(jobOrder, activity))
    throw HttpError.conflict('Quality activity is not currently eligible to start');
  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quality:${jobOrderId}:${processFlowActivityId}`}))`;
      const currentExecutions = await tx.qualityActivityExecution.findMany({
        where: { jobOrderId, processFlowActivityId },
        orderBy: [{ attemptNumber: 'desc' }, { batchNumber: 'desc' }],
      });
      const currentDraft = currentExecutions.find((candidate) => candidate.status === 'DRAFT');
      if (currentDraft) {
        if (
          (ppSample &&
            (currentDraft.sampleJobOrderLineSizeId !== input.sampleJobOrderLineSizeId ||
              currentDraft.sampleQuantity !== input.sampleQuantity)) ||
          (activity.executionMultiplicity === 'BATCHED' &&
            currentDraft.inspectedQuantity !== input.inspectedQuantity)
        )
          throw HttpError.conflict('Inspection context is locked after the execution starts');
        return tx.qualityActivityExecution.findFirstOrThrow({
          where: { jobOrderId, processFlowActivityId, status: 'DRAFT' },
          include: executionInclude,
        });
      }
      if (activity.executionMultiplicity !== 'BATCHED' && currentExecutions.length && !ppSample)
        throw HttpError.conflict('This single Quality activity already has an execution');
      if (
        ppSample &&
        currentExecutions.some(
          (candidate) => candidate.status === 'FINALIZED' && candidate.outcome === 'PASS',
        )
      )
        throw HttpError.conflict('PP Sample gate is already satisfied by a finalized PASS cycle');
      if (activity.executionMultiplicity === 'BATCHED') {
        const inspected = currentExecutions
          .filter((candidate) => candidate.status === 'FINALIZED')
          .reduce((sum, candidate) => sum + (candidate.inspectedQuantity ?? 0), 0);
        if (jobOrder.preparedQuantityTotal > 0 && inspected >= jobOrder.preparedQuantityTotal)
          throw HttpError.conflict('Final Inspection coverage is already complete');
      }
      const attemptNumber = ppSample ? (currentExecutions[0]?.attemptNumber ?? 0) + 1 : 1;
      const batchNumber =
        activity.executionMultiplicity === 'BATCHED'
          ? (currentExecutions.find((candidate) => candidate.attemptNumber === 1)?.batchNumber ??
              0) + 1
          : 1;
      const result = await tx.qualityActivityExecution.create({
        data: {
          id: createId(),
          jobOrderId,
          processFlowActivityId,
          qualityFormVersionId: form.id,
          attemptNumber,
          batchNumber,
          inspectedQuantity: input.inspectedQuantity,
          sampleJobOrderLineSizeId: input.sampleJobOrderLineSizeId,
          sampleQuantity: input.sampleQuantity,
          startedById: user.id,
        },
        include: executionInclude,
      });
      if (ppSample) {
        const selectedSize = await tx.jobOrderLineSize.findFirst({
          where: { id: input.sampleJobOrderLineSizeId, jobOrderLine: { jobOrderId } },
        });
        if (!selectedSize)
          throw HttpError.badRequest('Selected size does not belong to this Job Order');
        await tx.qaInspectionSession.create({
          data: {
            id: createId(),
            jobOrderId,
            inspectorId: user.id,
            cycleNumber: attemptNumber,
            qualityActivityExecutionId: result.id,
            forms: {
              create: {
                id: createId(),
                jobOrderLineSizeId: selectedSize.id,
                sampleQuantity: input.sampleQuantity,
                inspectedQuantity: 0,
                acceptedQuantity: 0,
                reworkQuantity: 0,
                permanentlyRejectedQuantity: 0,
                checklist: {
                  create: [
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
                  ].map((itemCode) => ({ id: createId(), itemCode: itemCode as never })),
                },
              },
            },
          },
        });
      }
      await recordAuditLog(
        {
          actorId: user.id,
          action: ppSample
            ? 'PP_SAMPLE_STARTED'
            : activity.executionMultiplicity === 'BATCHED'
              ? 'FINAL_INSPECTION_BATCH_STARTED'
              : 'QUALITY_ACTIVITY_STARTED',
          entityType: 'QualityActivityExecution',
          entityId: result.id,
          metadata: {
            jobOrderId,
            processFlowActivityId,
            activityName: activity.name,
            qualityFormVersionId: form.id,
            attemptNumber,
            batchNumber: result.batchNumber,
            inspectedQuantity: input.inspectedQuantity ?? null,
            sampleJobOrderLineSizeId: input.sampleJobOrderLineSizeId ?? null,
            sampleQuantity: input.sampleQuantity ?? null,
          },
        },
        tx,
      );
      return result;
    });
    const hydrated = ppSample
      ? await prisma.qualityActivityExecution.findUniqueOrThrow({
          where: { id: created.id },
          include: executionInclude,
        })
      : created;
    return toView(hydrated, await loadJobOrder(jobOrderId));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const current = await prisma.qualityActivityExecution.findFirst({
        where: { jobOrderId, processFlowActivityId, status: 'DRAFT' },
        include: executionInclude,
      });
      if (current) return toView(current, jobOrder);
    }
    throw error;
  }
}

function canonical(input: QualityExecutionPayload) {
  const clone = structuredClone(input);
  delete (clone as Partial<QualityExecutionPayload>).expectedVersion;
  for (const value of Object.values(clone))
    if (Array.isArray(value))
      value.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(clone);
}
function currentPayload(execution: Execution): QualityExecutionPayload {
  return {
    expectedVersion: execution.version,
    checklistResponses: execution.checklistResponses.map(
      ({ componentId, itemKey, response, remarks }) => ({
        componentId,
        itemKey,
        response,
        remarks,
      }),
    ),
    aqlResults: execution.aqlResults.map(({ componentId, severity, maxAllowed, found }) => ({
      componentId,
      severity,
      maxAllowed,
      found,
    })),
    defects: execution.defects.map(({ componentId, description, severity, quantity }) => ({
      componentId,
      description,
      severity,
      quantity,
    })),
    correctiveActions: execution.correctiveActions.map(({ componentId, values }) => ({
      componentId,
      values: values as Record<string, string | number | boolean | null>,
    })),
    testResults: execution.testResults.map(({ componentId, testKey, response, remarks }) => ({
      componentId,
      testKey,
      response,
      remarks,
    })),
    quantities: execution.quantities.map(({ componentId, fieldKey, value }) => ({
      componentId,
      fieldKey,
      value: Number(value),
    })),
    comments: execution.comments.map(({ componentId, value }) => ({ componentId, value })),
    fieldResponses: execution.fieldResponses.map(({ componentId, fieldKey, value }) => ({
      componentId,
      fieldKey,
      value,
    })),
    attendees: execution.attendeeResponses.map(({ componentId, roleKey, attendeeName }) => ({
      componentId,
      roleKey,
      attendeeName,
    })),
    actions: execution.actionResponses
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map(({ componentId, values }) => ({
        componentId,
        values: values as Record<string, string | number | boolean | null>,
      })),
    signoffs: execution.signoffs.map(({ componentId, roleKey, signatoryName }) => ({
      componentId,
      roleKey,
      signatoryName,
    })),
    outcome:
      execution.outcome && execution.outcomeComponentId
        ? {
            componentId: execution.outcomeComponentId,
            value: execution.outcome,
            remarks: execution.outcomeRemarks,
          }
        : null,
  };
}

async function persist(
  user: CurrentUser,
  executionId: string,
  input: QualityExecutionPayload,
  finalize: boolean,
) {
  assertMutation(user);
  const execution = await prisma.qualityActivityExecution.findUnique({
    where: { id: executionId },
    include: executionInclude,
  });
  if (!execution) throw HttpError.notFound('Quality execution not found');
  if (execution.status !== 'DRAFT')
    throw HttpError.conflict('Finalized Quality executions are immutable');
  if (execution.version !== input.expectedVersion) throw HttpError.staleVersion(execution.version);
  validatePayload(execution, input, finalize);
  if (!finalize && canonical(input) === canonical(currentPayload(execution)))
    return toView(execution, await loadJobOrder(execution.jobOrderId));
  const saved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quality:${execution.jobOrderId}:${execution.processFlowActivityId}`}))`;
    if (finalize && execution.processFlowActivity.executionMultiplicity === 'BATCHED') {
      const prepared = await tx.jobOrder.findUniqueOrThrow({
        where: { id: execution.jobOrderId },
        select: { preparedQuantityTotal: true },
      });
      if (prepared.preparedQuantityTotal <= 0)
        throw HttpError.conflict(
          'Prepared quantity is not yet authoritative; save this batch as a draft and finalize after preparation is recorded',
        );
      const finalized = await tx.qualityActivityExecution.aggregate({
        where: {
          jobOrderId: execution.jobOrderId,
          processFlowActivityId: execution.processFlowActivityId,
          attemptNumber: execution.attemptNumber,
          status: 'FINALIZED',
        },
        _sum: { inspectedQuantity: true },
      });
      const resulting =
        (finalized._sum.inspectedQuantity ?? 0) + (execution.inspectedQuantity ?? 0);
      if (resulting > prepared.preparedQuantityTotal)
        throw HttpError.badRequest(
          `Finalizing this batch would inspect ${resulting}, exceeding prepared quantity ${prepared.preparedQuantityTotal}`,
        );
    }
    const changed = await tx.qualityActivityExecution.updateMany({
      where: { id: execution.id, version: input.expectedVersion, status: 'DRAFT' },
      data: {
        version: { increment: 1 },
        outcome: input.outcome?.value ?? null,
        outcomeComponentId: input.outcome?.componentId ?? null,
        outcomeRemarks: input.outcome?.remarks ?? null,
        ...(finalize
          ? { status: 'FINALIZED' as const, finalizedById: user.id, finalizedAt: new Date() }
          : {}),
      },
    });
    if (changed.count !== 1) {
      const now = await tx.qualityActivityExecution.findUnique({
        where: { id: execution.id },
        select: { version: true },
      });
      throw HttpError.staleVersion(now?.version ?? input.expectedVersion);
    }
    await Promise.all(
      [
        'qualityChecklistResponse',
        'qualityAqlResult',
        'qualityDefect',
        'qualityCorrectiveAction',
        'qualityTestResult',
        'qualityQuantityResponse',
        'qualityCommentResponse',
        'qualityFieldResponse',
        'qualityAttendeeResponse',
        'qualityActionResponse',
        'qualitySignoff',
      ].map((model) =>
        (tx[model as keyof typeof tx] as { deleteMany(args: object): Promise<unknown> }).deleteMany(
          { where: { executionId } },
        ),
      ),
    );
    if (input.checklistResponses.length)
      await tx.qualityChecklistResponse.createMany({
        data: input.checklistResponses.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.aqlResults.length)
      await tx.qualityAqlResult.createMany({
        data: input.aqlResults.map((x) => ({
          id: createId(),
          executionId,
          ...x,
          result:
            x.maxAllowed != null && x.found != null
              ? x.found <= x.maxAllowed
                ? ('PASS' as const)
                : ('FAIL' as const)
              : null,
        })),
      });
    if (input.defects.length)
      await tx.qualityDefect.createMany({
        data: input.defects.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.correctiveActions.length)
      await tx.qualityCorrectiveAction.createMany({
        data: input.correctiveActions.map((x) => ({
          id: createId(),
          executionId,
          componentId: x.componentId,
          values: x.values as Prisma.InputJsonValue,
        })),
      });
    if (input.testResults.length)
      await tx.qualityTestResult.createMany({
        data: input.testResults.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.quantities.length)
      await tx.qualityQuantityResponse.createMany({
        data: input.quantities.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.comments.length)
      await tx.qualityCommentResponse.createMany({
        data: input.comments.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.fieldResponses.length)
      await tx.qualityFieldResponse.createMany({
        data: input.fieldResponses.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.attendees.length)
      await tx.qualityAttendeeResponse.createMany({
        data: input.attendees.map((x) => ({ id: createId(), executionId, ...x })),
      });
    if (input.actions.length)
      await tx.qualityActionResponse.createMany({
        data: input.actions.map((x, index) => ({
          id: createId(),
          executionId,
          componentId: x.componentId,
          rowNumber: index + 1,
          values: x.values as Prisma.InputJsonValue,
        })),
      });
    if (input.signoffs.length)
      await tx.qualitySignoff.createMany({
        data: input.signoffs.map((x) => ({
          id: createId(),
          executionId,
          ...x,
          recordedById: user.id,
        })),
      });
    await recordAuditLog(
      {
        actorId: user.id,
        action:
          finalize && execution.processFlowActivity.executionMultiplicity === 'BATCHED'
            ? 'FINAL_INSPECTION_BATCH_FINALIZED'
            : finalize
              ? 'QUALITY_ACTIVITY_FINALIZED'
              : 'QUALITY_ACTIVITY_DRAFT_SAVED',
        entityType: 'QualityActivityExecution',
        entityId: executionId,
        metadata: {
          processFlowActivityId: execution.processFlowActivityId,
          activityName: execution.processFlowActivity.name,
          qualityFormVersionId: execution.qualityFormVersionId,
          attemptNumber: execution.attemptNumber,
          batchNumber: execution.batchNumber,
          inspectedQuantity: execution.inspectedQuantity,
          outcome: input.outcome?.value ?? null,
        },
      },
      tx,
    );
    return tx.qualityActivityExecution.findUniqueOrThrow({
      where: { id: executionId },
      include: executionInclude,
    });
  });
  return toView(saved, await loadJobOrder(saved.jobOrderId));
}
export const saveDraft = (user: CurrentUser, id: string, input: QualityExecutionPayload) =>
  persist(user, id, input, false);
export const finalize = (user: CurrentUser, id: string, input: QualityExecutionPayload) =>
  persist(user, id, input, true);

export async function get(user: CurrentUser, id: string) {
  if (
    !user.roles.some((x) => ['ADMIN', 'QA_USER', 'MERCHANDISER', 'SENIOR_MANAGEMENT'].includes(x))
  )
    throw HttpError.forbidden();
  const execution = await prisma.qualityActivityExecution.findUnique({
    where: { id },
    include: executionInclude,
  });
  if (!execution) throw HttpError.notFound('Quality execution not found');
  return toView(execution, await loadJobOrder(execution.jobOrderId));
}

function toView(execution: Execution, jobOrder: Awaited<ReturnType<typeof loadJobOrder>>) {
  const total = planned(jobOrder);
  const runtimeByActivity = new Map(
    jobOrder.stageStatuses.map((x) => [x.processFlowVersionStageId, x]),
  );
  const sections = execution.qualityFormVersion.sections.map((section) => ({
    ...section,
    components: section.components.map((item) => {
      const cfg = config(item);
      let systemValue: unknown = undefined;
      if (item.type === 'SYSTEM_CONTEXT')
        systemValue = list(cfg.fields).map((field) => ({
          key: field.key,
          ...derivedSystemContext(jobOrder, String(field.sourceKey)),
        }));
      if (item.type === 'PRODUCTION_PROGRESS')
        systemValue = list(cfg.metrics).map((metric) => {
          const definition = jobOrder.processFlowVersion.stages.find(
            (x) => x.activityType === 'PRODUCTION' && x.code === metric.sourceActivityCode,
          );
          const runtime = definition ? runtimeByActivity.get(definition.id) : undefined;
          return {
            key: metric.key,
            value:
              runtime?.completedQuantity == null || total === 0
                ? null
                : Math.round((runtime.completedQuantity * 10000) / total) / 100,
            available: Boolean(definition && runtime?.completedQuantity != null),
          };
        });
      if (item.type === 'QUANTITY_RECONCILIATION')
        systemValue = list(cfg.fields)
          .filter((field) => field.source === 'SYSTEM')
          .map((field) => ({
            key: field.key,
            ...(field.sourceKey === 'BATCH_INSPECTED_QUANTITY'
              ? {
                  value: execution.inspectedQuantity,
                  available: execution.inspectedQuantity != null,
                }
              : derivedSystemContext(jobOrder, String(field.sourceKey))),
          }));
      return {
        id: item.id,
        sequence: item.sequence,
        type: item.type,
        title: item.title,
        description: item.description,
        config: item.config,
        systemValue,
      };
    }),
  }));
  return {
    id: execution.id,
    jobOrderId: execution.jobOrderId,
    processFlowActivityId: execution.processFlowActivityId,
    activityName: execution.processFlowActivity.name,
    qualityForm: {
      id: execution.qualityFormVersion.qualityForm.id,
      code: execution.qualityFormVersion.qualityForm.code,
      name: execution.qualityFormVersion.qualityForm.name,
      versionId: execution.qualityFormVersionId,
      versionNumber: execution.qualityFormVersion.versionNumber,
    },
    attemptNumber: execution.attemptNumber,
    batchNumber: execution.batchNumber,
    inspectedQuantity: execution.inspectedQuantity,
    status: execution.status,
    version: execution.version,
    startedBy: execution.startedBy,
    startedAt: execution.startedAt.toISOString(),
    finalizedBy: execution.finalizedBy,
    finalizedAt: execution.finalizedAt?.toISOString() ?? null,
    ppSample: execution.sampleJobOrderLineSizeId
      ? {
          selectedSizeId: execution.sampleJobOrderLineSizeId,
          sizeCode: execution.ppSampleSession?.forms[0]?.jobOrderLineSize.size.code ?? null,
          sizeLabel: execution.ppSampleSession?.forms[0]?.jobOrderLineSize.size.label ?? null,
          sampleQuantity: execution.sampleQuantity,
          sessionId: execution.ppSampleSession?.id ?? null,
          formId: execution.ppSampleSession?.forms[0]?.id ?? null,
          decision: execution.outcome,
        }
      : null,
    coverage:
      execution.processFlowActivity.executionMultiplicity === 'BATCHED'
        ? (() => {
            const batches = jobOrder.qualityExecutions.filter(
              (candidate) =>
                candidate.processFlowActivityId === execution.processFlowActivityId &&
                candidate.attemptNumber === execution.attemptNumber,
            );
            const inspected = batches
              .filter((candidate) => candidate.status === 'FINALIZED')
              .reduce((sum, candidate) => sum + (candidate.inspectedQuantity ?? 0), 0);
            const prepared = jobOrder.preparedQuantityTotal;
            const preparedQuantityAuthoritative = prepared > 0;
            const finalizedBatches = batches.filter(
              (candidate) => candidate.status === 'FINALIZED',
            );
            const passedBatches = finalizedBatches.filter(
              (candidate) => candidate.outcome === 'PASS',
            ).length;
            const failedBatches = finalizedBatches.filter(
              (candidate) => candidate.outcome === 'FAIL',
            ).length;
            const reconciliationConflict = preparedQuantityAuthoritative && inspected > prepared;
            const complete = preparedQuantityAuthoritative && inspected === prepared;
            return {
              preparedQuantityAuthoritative,
              preparedQuantity: preparedQuantityAuthoritative ? prepared : null,
              inspectedQuantity: inspected,
              remainingQuantity: preparedQuantityAuthoritative
                ? Math.max(0, prepared - inspected)
                : null,
              complete,
              reconciliationConflict,
              state: reconciliationConflict
                ? ('CONFLICT' as const)
                : complete
                  ? ('COMPLETE' as const)
                  : preparedQuantityAuthoritative
                    ? ('IN_PROGRESS' as const)
                    : ('UNKNOWN' as const),
              passedBatches,
              failedBatches,
              hasFailedBatches: failedBatches > 0,
              batches: batches.map((candidate) => ({
                id: candidate.id,
                batchNumber: candidate.batchNumber,
                inspectedQuantity: candidate.inspectedQuantity,
                status: candidate.status,
                outcome: candidate.outcome,
                finalizedAt: candidate.finalizedAt?.toISOString() ?? null,
              })),
            };
          })()
        : null,
    sections,
    responses: currentPayload(execution),
    attachments: execution.attachments.map((x) => ({
      id: x.id,
      componentId: x.componentId,
      requirementKey: x.requirementKey,
      fileName: x.file.fileName,
      contentType: x.file.mimeType,
      sizeBytes: x.file.sizeBytes,
      createdAt: x.createdAt.toISOString(),
    })),
  };
}

export async function uploadAttachment(
  user: CurrentUser,
  executionId: string,
  componentId: string,
  requirementKey: string,
  upload: { buffer: Buffer; originalName?: string },
) {
  assertMutation(user);
  const execution = await prisma.qualityActivityExecution.findUnique({
    where: { id: executionId },
    include: executionInclude,
  });
  if (!execution) throw HttpError.notFound('Quality execution not found');
  if (execution.status !== 'DRAFT') throw HttpError.conflict('Finalized evidence is immutable');
  const component = assertComponent(componentMap(execution), componentId, 'ATTACHMENTS');
  if (!list(config(component).requirements).some((x) => x.key === requirementKey))
    throw HttpError.badRequest('Unknown attachment requirement');
  if (!upload.buffer.length || upload.buffer.length > env.UPLOAD_MAX_IMAGE_BYTES)
    throw HttpError.badRequest('Attachment is empty or too large');
  const image = sniffImage(upload.buffer);
  if (!image) throw HttpError.badRequest('Only valid JPEG, PNG and WebP evidence is accepted');
  const checksum = createHash('sha256').update(upload.buffer).digest('hex');
  const duplicate = execution.attachments.find(
    (x) =>
      x.componentId === componentId &&
      x.requirementKey === requirementKey &&
      x.checksumSha256 === checksum,
  );
  if (duplicate) return { attachment: duplicate, created: false };
  const fileId = createId(),
    attachmentId = createId(),
    storageKey = `quality-executions/${execution.jobOrderId}/${executionId}/${fileId}.${image.extension}`;
  await getFileStorage().put(storageKey, upload.buffer);
  try {
    const attachment = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status"::text AS "status" FROM "quality_activity_executions"
        WHERE "id" = ${executionId} FOR UPDATE
      `;
      if (locked[0]?.status !== 'DRAFT')
        throw HttpError.conflict('Finalized evidence is immutable');
      await tx.file.create({
        data: {
          id: fileId,
          fileName: sanitizeDisplayFileName(upload.originalName, image.extension),
          mimeType: image.mimeType,
          sizeBytes: upload.buffer.length,
          storageKey,
          checksumSha256: checksum,
          uploadedById: user.id,
        },
      });
      const result = await tx.qualityAttachment.create({
        data: {
          id: attachmentId,
          executionId,
          componentId,
          requirementKey,
          fileId,
          checksumSha256: checksum,
        },
        include: { file: true },
      });
      await recordAuditLog(
        {
          actorId: user.id,
          action: 'QUALITY_ACTIVITY_ATTACHMENT_ADDED',
          entityType: 'QualityActivityExecution',
          entityId: executionId,
          metadata: { attachmentId, componentId, requirementKey },
        },
        tx,
      );
      return result;
    });
    return { attachment, created: true };
  } catch (error) {
    await getFileStorage()
      .delete(storageKey)
      .catch(() => undefined);
    throw error;
  }
}

function assertAttachmentView(user: CurrentUser) {
  if (
    !user.roles.some((role) =>
      ['ADMIN', 'QA_USER', 'MERCHANDISER', 'SENIOR_MANAGEMENT'].includes(role),
    )
  ) {
    throw HttpError.forbidden('You cannot access this Quality attachment');
  }
}

export async function readAttachment(user: CurrentUser, attachmentId: string) {
  assertAttachmentView(user);
  const attachment = await prisma.qualityAttachment.findUnique({
    where: { id: attachmentId },
    include: { file: true },
  });
  if (!attachment) throw HttpError.notFound('Quality attachment not found');
  try {
    return {
      data: await getFileStorage().read(attachment.file.storageKey),
      mimeType: attachment.file.mimeType,
      fileName: attachment.file.fileName,
    };
  } catch (error) {
    if (error instanceof FileNotFoundInStorageError)
      throw HttpError.notFound('Quality attachment content not found');
    throw error;
  }
}

export async function deleteAttachment(user: CurrentUser, attachmentId: string) {
  assertMutation(user);
  const attachment = await prisma.qualityAttachment.findUnique({
    where: { id: attachmentId },
    include: { file: true },
  });
  if (!attachment) throw HttpError.notFound('Quality attachment not found');
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status" FROM "quality_activity_executions"
      WHERE "id" = ${attachment.executionId} FOR UPDATE
    `;
    if (locked[0]?.status !== 'DRAFT') throw HttpError.conflict('Finalized evidence is immutable');
    await tx.qualityAttachment.delete({ where: { id: attachment.id } });
    await tx.file.delete({ where: { id: attachment.fileId } });
    await recordAuditLog(
      {
        actorId: user.id,
        action: 'QUALITY_ACTIVITY_ATTACHMENT_REMOVED',
        entityType: 'QualityActivityExecution',
        entityId: attachment.executionId,
        metadata: { attachmentId },
      },
      tx,
    );
  });
  await getFileStorage()
    .delete(attachment.file.storageKey)
    .catch(() => undefined);
}
