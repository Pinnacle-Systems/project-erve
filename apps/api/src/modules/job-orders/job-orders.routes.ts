import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  completeStageSchema,
  createJobOrderSchema,
  listJobOrdersQuerySchema,
  updatePreparedQuantitySchema,
} from './job-orders.validation.js';
import * as jobOrdersService from './job-orders.service.js';

export const jobOrdersRouter = Router();
jobOrdersRouter.use(requireAuth);

const canViewJobOrders = requireRoles('ADMIN', 'MERCHANDISER', 'FACTORY_USER', 'QA_USER', 'SENIOR_MANAGEMENT');
const canCreateJobOrders = requireRoles('ADMIN', 'MERCHANDISER');
const canWorkflowJobOrders = requireRoles('ADMIN', 'MERCHANDISER', 'FACTORY_USER');

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
  '/',
  canCreateJobOrders,
  asyncHandler(async (req, res) => {
    const input = createJobOrderSchema.parse(req.body);
    const jobOrder = await jobOrdersService.createJobOrderFromPO(req.user!, input);
    res.status(201).json(successResponse(jobOrder));
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
    const jobOrder = await jobOrdersService.sendJobOrderToFactory(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/confirm',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const jobOrder = await jobOrdersService.confirmJobOrder(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/complete-stage',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const input = completeStageSchema.parse(req.body);
    const jobOrder = await jobOrdersService.completeProductionStage(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(jobOrder));
  }),
);

jobOrdersRouter.post(
  '/:id/actions/update-prepared-quantity',
  canWorkflowJobOrders,
  asyncHandler(async (req, res) => {
    const input = updatePreparedQuantitySchema.parse(req.body);
    const jobOrder = await jobOrdersService.updatePreparedQuantity(req.user!, req.params.id! as string, input);
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
  '/:id/variance',
  canViewJobOrders,
  asyncHandler(async (req, res) => {
    const variance = await jobOrdersService.calculateVariance(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(variance));
  }),
);
