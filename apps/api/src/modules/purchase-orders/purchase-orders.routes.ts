import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  orderSheetStyleOptionsQuerySchema,
  updatePurchaseOrderSchema,
} from './purchase-orders.validation.js';
import * as purchaseOrdersService from './purchase-orders.service.js';

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(requireAuth);

// Order Sheet planning belongs to Merchandising: DISTRIBUTOR has no access at
// all (view or manage) — mirrors DISTRIBUTOR's existing full exclusion from
// Job Orders.
const canManagePOs = requireRoles('ADMIN', 'MERCHANDISER');
const canViewPOs = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT');

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

// Registered before '/:id' so 'style-options' isn't read as an Order Sheet
// id. These serve the Order Sheet form's Style lookup under the Order Sheet
// manage permission — a bounded slim search plus the one selected Style —
// so the form never depends on GET /styles returning the whole master.
purchaseOrdersRouter.get(
  '/style-options',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const filters = orderSheetStyleOptionsQuerySchema.parse(req.query);
    const options = await purchaseOrdersService.listOrderSheetStyleOptions(filters);
    res.status(200).json(successResponse(options));
  }),
);

purchaseOrdersRouter.get(
  '/style-options/:styleId',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const option = await purchaseOrdersService.getOrderSheetStyleOption(req.params.styleId! as string);
    res.status(200).json(successResponse(option));
  }),
);

purchaseOrdersRouter.get(
  '/:id',
  canViewPOs,
  asyncHandler(async (req, res) => {
    const order = await purchaseOrdersService.getPurchaseOrderDetail(
      req.user!,
      req.params.id! as string,
    );
    res.status(200).json(successResponse(order));
  }),
);

purchaseOrdersRouter.patch(
  '/:id',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const input = updatePurchaseOrderSchema.parse(req.body);
    const order = await purchaseOrdersService.updatePurchaseOrderDraft(
      req.user!,
      req.params.id! as string,
      input,
    );
    res.status(200).json(successResponse(order));
  }),
);

purchaseOrdersRouter.post(
  '/:id/actions/cancel',
  canManagePOs,
  asyncHandler(async (req, res) => {
    const order = await purchaseOrdersService.cancelPurchaseOrder(
      req.user!,
      req.params.id! as string,
    );
    res.status(200).json(successResponse(order));
  }),
);
