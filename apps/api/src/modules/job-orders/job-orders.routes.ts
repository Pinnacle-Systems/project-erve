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
  listJobOrdersQuerySchema,
  updatePreparedQuantitySchema,
  updateJobOrderDisclaimerSchema,
  versionedMutationSchema,
} from './job-orders.validation.js';
import * as jobOrdersService from './job-orders.service.js';
import * as qualityExecutionsService from '../quality-executions/quality-executions.service.js';
import { startQualityExecutionSchema } from '../quality-executions/quality-executions.validation.js';

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
const canWorkflowJobOrders = requireRoles('ADMIN', 'MERCHANDISER', 'FACTORY_USER');

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
    const jobOrder = await jobOrdersService.createJobOrderFromPO(req.user!, input);
    res.status(201).json(successResponse(jobOrder));
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

jobOrdersRouter.get(
  '/quality-work',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) => {
    res
      .status(200)
      .json(successResponse(await jobOrdersService.getProcessFlowQualityWork(req.user!)));
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
