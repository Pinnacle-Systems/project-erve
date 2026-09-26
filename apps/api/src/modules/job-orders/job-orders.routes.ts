import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { HttpError } from '../../errors/http-error.js';
import {
  completeStageSchema,
  startStageSchema,
  confirmJobOrderSchema,
  assignedTasksQuerySchema,
  createJobOrderSchema,
  jobOrderFactoryOptionsQuerySchema,
  listJobOrdersQuerySchema,
  listQualityWorkQuerySchema,
  qualityWorkSummaryQuerySchema,
  updatePreparedQuantitySchema,
  updateJobOrderDisclaimerSchema,
  updateJobOrderSourcesSchema,
  updateJobOrderDeliveryDateSchema,
  updateJobOrderPlanSchema,
  versionedMutationSchema,
} from './job-orders.validation.js';
import * as jobOrdersService from './job-orders.service.js';
import * as qualityExecutionsService from '../quality-executions/quality-executions.service.js';
import { startQualityExecutionSchema } from '../quality-executions/quality-executions.validation.js';
import { JOB_ORDER_FACTORY_FILTER_ROLES, JOB_ORDER_PRODUCTION_MUTATION_ROLES } from '@erve/shared';
import { getPooledFactoryInventory } from './pooled-inventory.service.js';
import { prisma } from '../../db/prisma.js';
import { pooledInventoryQuerySchema } from './job-orders.validation.js';

export const jobOrdersRouter = Router();
jobOrdersRouter.use(requireAuth);

const canViewJobOrders = requireRoles(
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'QA_USER',
  'SENIOR_MANAGEMENT',
);
const canCreateJobOrders = requireRoles('ADMIN', 'MERCHANDISER');
const canWorkflowJobOrders = requireRoles(...JOB_ORDER_PRODUCTION_MUTATION_ROLES);
const canFilterJobOrdersByFactory = requireRoles(...JOB_ORDER_FACTORY_FILTER_ROLES);

function idempotencyKey(req: { get(name: string): string | undefined }): string {
  const key = req.get('Idempotency-Key')?.trim();
  if (!key || key.length > 200) {
    throw HttpError.badRequest(
      'Idempotency-Key header is required and must be at most 200 characters',
    );
  }
  return key;
}

jobOrdersRouter.get(
  '/',
  canViewJobOrders,
  asyncHandler(async (req, res) => {
    const filters = listJobOrdersQuerySchema.parse(req.query);
    const jobOrders = await jobOrdersService.getJobOrderList(req.user!, filters);
    res.status(200).json(successResponse(jobOrders));
  }),
);

jobOrdersRouter.post(
  '/:id/quality-activities/:activityId/executions',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) => {
    const execution = await qualityExecutionsService.start(
      req.user!,
      req.params.id! as string,
      req.params.activityId! as string,
      startQualityExecutionSchema.parse(req.body ?? {}),
    );
    res.status(201).json(successResponse(execution));
  }),
);

jobOrdersRouter.patch(
  '/:id/disclaimer',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = updateJobOrderDisclaimerSchema.parse(req.body);
    const jobOrder = await jobOrdersService.updateDraftJobOrderDisclaimer(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = createJobOrderSchema.parse(req.body);
    const jobOrder = await jobOrdersService.createJobOrder(req.user!, input);
    res.status(201).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.patch(
  '/:id/sources',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = updateJobOrderSourcesSchema.parse(req.body);
    const jobOrder = await jobOrdersService.updateDraftJobOrderSources(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.patch(
  '/:id/production-plan',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = updateJobOrderPlanSchema.parse(req.body);
    const jobOrder = await jobOrdersService.updateDraftJobOrderPlan(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.patch(
  '/:id/delivery-date',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = updateJobOrderDeliveryDateSchema.parse(req.body);
    const jobOrder = await jobOrdersService.updateJobOrderDeliveryDate(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.get(
  '/pooled-inventory',
  requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'),
  asyncHandler(async (req, res) => {
    const filters = pooledInventoryQuerySchema.parse(req.query);
    const rows = await getPooledFactoryInventory(prisma, filters);
    res.status(200).json(successResponse(rows));
  }),
);

jobOrdersRouter.get(
  '/assigned-tasks',
  requireRoles('FACTORY_USER'),
  asyncHandler(async (req, res) => {
    const filters = assignedTasksQuerySchema.parse(req.query);
    const tasks = await jobOrdersService.getAssignedFactoryTasks(req.user!, filters);
    res.status(200).json(successResponse(tasks));
  }),
);

const canPerformQaOperationRoute = requireRoles('ADMIN', 'QA_USER');

// Must stay registered before "/quality-work" is treated as anything but a
// literal path segment and before "/:id" below, same as /factory-options.
jobOrdersRouter.get(
  '/quality-work/summary',
  canPerformQaOperationRoute,
  asyncHandler(async (req, res) => {
    const filters = qualityWorkSummaryQuerySchema.parse(req.query);
    const summary = await jobOrdersService.getQualityWorkSummary(req.user!, filters);
    res.status(200).json(successResponse(summary));
  }),
);

jobOrdersRouter.get(
  '/quality-work',
  canPerformQaOperationRoute,
  asyncHandler(async (req, res) => {
    const query = listQualityWorkQuerySchema.parse(req.query);
    const page = await jobOrdersService.getProcessFlowQualityWorkPage(
      req.user!,
      {
        status: query.status,
        conflict: query.conflict,
        factoryId: query.factoryId,
        search: query.search,
      },
      { limit: query.limit, cursor: query.cursor },
    );
    res.status(200).json(successResponse(page));
  }),
);

// UXAUTH-014: the Job Order Factory filter's minimal lookup. QA_USER and
// SENIOR_MANAGEMENT can list Job Orders but are denied on the broad Factory
// master (master-data.routes.ts's canViewFactories is ADMIN/MERCHANDISER
// only) — this route instead reuses JOB_ORDER_FACTORY_FILTER_ROLES, the
// exact list that governs the Factory filter's visibility on Web, so the two
// can never drift. Must stay registered before `/:id` so the literal path
// "factory-options" is never captured as an id.
jobOrdersRouter.get(
  '/factory-options',
  canFilterJobOrdersByFactory,
  asyncHandler(async (req, res) => {
    const filters = jobOrderFactoryOptionsQuerySchema.parse(req.query);
    const options = await jobOrdersService.listFactoryOptionsForJobOrders(filters);
    res.status(200).json(successResponse(options));
  }),
);

jobOrdersRouter.get(
  '/:id',
  canViewJobOrders,
  asyncHandler(async (req, res) => {
    const jobOrder = await jobOrdersService.getJobOrderDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/send-to-factory',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = versionedMutationSchema.parse(req.body);
    const jobOrder = await jobOrdersService.sendJobOrderToFactory(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/confirm',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const input = confirmJobOrderSchema.parse(req.body);
    const jobOrder = await jobOrdersService.confirmJobOrder(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/start-stage',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const input = startStageSchema.parse(req.body);
    const jobOrder = await jobOrdersService.startProductionStage(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/complete-stage',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const input = completeStageSchema.parse(req.body);
    const jobOrder = await jobOrdersService.completeProductionStage(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/update-prepared-quantity',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const input = updatePreparedQuantitySchema.parse(req.body);
    const jobOrder = await jobOrdersService.updatePreparedQuantity(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

// Merchandiser-only "stop/accept production" override — deliberately a
// narrower gate than canWorkflowJobOrders (no FACTORY_USER). See
// jobOrdersService.markJobOrderProductionComplete.
jobOrdersRouter.post(
  '/:id/actions/mark-production-complete',
  requireRoles('ADMIN', 'MERCHANDISER'),
  asyncHandler(async (req, res) => {
    const input = versionedMutationSchema.parse(req.body);
    const jobOrder = await jobOrdersService.markJobOrderProductionComplete(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

// Merchandiser-only lifecycle transition — deliberately a narrower gate
// than canWorkflowJobOrders (no FACTORY_USER), matching
// mark-production-complete's precedent. See jobOrdersService.cancelJobOrder.
jobOrdersRouter.post(
  '/:id/actions/cancel',
  requireRoles('ADMIN', 'MERCHANDISER'),
  asyncHandler(async (req, res) => {
    const input = versionedMutationSchema.parse(req.body);
    const jobOrder = await jobOrdersService.cancelJobOrder(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.get(
  '/:id/stages',
  canViewJobOrders,
  asyncHandler(async (req, res) => {
    const stages = await jobOrdersService.getJobOrderStages(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(stages));
  }),
);

jobOrdersRouter.get(
  '/:id/audit',
  canViewJobOrders,
  asyncHandler(async (req, res) => {
    const history = await jobOrdersService.getJobOrderAuditHistory(
      req.user!,
      req.params.id! as string,
    );
    res.status(200).json(successResponse(history));
  }),
);

jobOrdersRouter.get(
  '/:id/variance',
  canViewJobOrders,
  asyncHandler(async (req, res) => {
    const variance = await jobOrdersService.calculateVariance(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(variance));
  }),
);
