import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderSchema,
} from './purchase-orders.validation.js';
import * as purchaseOrdersService from './purchase-orders.service.js';

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(requireAuth);

const canManagePOs = requireRoles('ADMIN', 'MERCHANDISER', 'DISTRIBUTOR');
const canViewPOs = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR');

purchaseOrdersRouter.get(
  '/',
  canViewPOs,
  asyncHandler(async (req, res) => {
    const filters = listPurchaseOrdersQuerySchema.parse(req.query);
    const orders = await purchaseOrdersService.getPurchaseOrderList(req.user!, filters);
    res.status(200).json(successResponse(orders));
  }),
);

purchaseOrdersRouter.post(
  '/',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const input = createPurchaseOrderSchema.parse(req.body);
    const order = await purchaseOrdersService.createPurchaseOrder(req.user!, input);
    res.status(201).json(successResponse(order));
  }),
);

purchaseOrdersRouter.get(
  '/:id',
  canViewPOs,
  asyncHandler(async (req, res) => {
    const order = await purchaseOrdersService.getPurchaseOrderDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(order));
  }),
);

purchaseOrdersRouter.patch(
  '/:id',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const input = updatePurchaseOrderSchema.parse(req.body);
    const order = await purchaseOrdersService.updatePurchaseOrderDraft(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(order));
  }),
);

purchaseOrdersRouter.post(
  '/:id/actions/submit',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const order = await purchaseOrdersService.submitPurchaseOrder(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(order));
  }),
);

purchaseOrdersRouter.post(
  '/:id/actions/cancel',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const order = await purchaseOrdersService.cancelPurchaseOrder(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(order));
  }),
);

purchaseOrdersRouter.get(
  '/:id/job-order-balance',
  canViewPOs,
  asyncHandler(async (req, res) => {
    const balance = await purchaseOrdersService.getJobOrderBalance(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(balance));
  }),
);

purchaseOrdersRouter.get(
  '/:id/fulfilment-summary',
  canViewPOs,
  asyncHandler(async (req, res) => {
    const summary = await purchaseOrdersService.getFulfilmentSummary(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(summary));
  }),
);
