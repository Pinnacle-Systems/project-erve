import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../errors/http-error.js';
import { successResponse } from '../../utils/response.js';
import {
  approveSaleOrderSchema,
  createSaleOrderSchema,
  globalInventoryQuerySchema,
  listSaleOrdersQuerySchema,
  updateSaleOrderSchema,
  versionedActionSchema,
} from './sale-orders.validation.js';
import * as saleOrdersService from './sale-orders.service.js';

export const saleOrdersRouter = Router();
saleOrdersRouter.use(requireAuth);

const canManageAsDistributor = requireRoles('ADMIN', 'DISTRIBUTOR');
const canView = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR');
const canReview = requireRoles('ADMIN', 'MERCHANDISER');
const canCancel = requireRoles('ADMIN', 'DISTRIBUTOR', 'MERCHANDISER');
const canViewGlobalInventory = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT');

function idempotencyKey(req: { get(name: string): string | undefined }): string {
  const key = req.get('Idempotency-Key')?.trim();
  if (!key || key.length > 200) {
    throw HttpError.badRequest('Idempotency-Key header is required and must be at most 200 characters');
  }
  return key;
}

const eligibleStockQuerySchema = z.object({ distributorId: z.string().trim().optional() });

// Static routes must be registered before the `/:id` route below — Express
// would otherwise match "eligible-stock"/"inventory" as an `:id` value.
saleOrdersRouter.get(
  '/eligible-stock',
  canManageAsDistributor,
  asyncHandler(async (req, res) => {
    const query = eligibleStockQuerySchema.parse(req.query);
    const stock = await saleOrdersService.getEligibleStock(req.user!, query.distributorId);
    res.status(200).json(successResponse(stock));
  }),
);

saleOrdersRouter.get(
  '/inventory',
  canViewGlobalInventory,
  asyncHandler(async (req, res) => {
    const query = globalInventoryQuerySchema.parse(req.query);
    const inventory = await saleOrdersService.getGlobalInventoryView(req.user!, query);
    res.status(200).json(successResponse(inventory));
  }),
);

saleOrdersRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listSaleOrdersQuerySchema.parse(req.query);
    const orders = await saleOrdersService.getSaleOrderList(req.user!, filters);
    res.status(200).json(successResponse(orders));
  }),
);

saleOrdersRouter.post(
  '/',
  canManageAsDistributor,
  asyncHandler(async (req, res) => {
    const input = createSaleOrderSchema.parse(req.body);
    const order = await saleOrdersService.createSaleOrder(req.user!, input);
    res.status(201).json(successResponse(order));
  }),
);

saleOrdersRouter.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const order = await saleOrdersService.getSaleOrderDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(order));
  }),
);

saleOrdersRouter.patch(
  '/:id',
  canManageAsDistributor,
  asyncHandler(async (req, res) => {
    const input = updateSaleOrderSchema.parse(req.body);
    const order = await saleOrdersService.updateSaleOrderDraft(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(order));
  }),
);

saleOrdersRouter.post(
  '/:id/actions/submit',
  canManageAsDistributor,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const order = await saleOrdersService.submitSaleOrder(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(order));
  }),
);

saleOrdersRouter.post(
  '/:id/actions/start-review',
  canReview,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const order = await saleOrdersService.startReviewSaleOrder(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(order));
  }),
);

saleOrdersRouter.post(
  '/:id/actions/reject',
  canReview,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const order = await saleOrdersService.rejectSaleOrder(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(order));
  }),
);

saleOrdersRouter.post(
  '/:id/actions/cancel',
  canCancel,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const order = await saleOrdersService.cancelSaleOrder(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(order));
  }),
);

saleOrdersRouter.post(
  '/:id/actions/approve',
  canReview,
  asyncHandler(async (req, res) => {
    const input = approveSaleOrderSchema.parse(req.body);
    const order = await saleOrdersService.approveSaleOrder(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(order));
  }),
);
