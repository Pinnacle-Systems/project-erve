import { Router } from 'express';
import { DISPATCH_ORDER_AUDIT_VIEW_ROLES, DISPATCH_ORDER_MUTATION_ROLES, DISPATCH_ORDER_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../errors/http-error.js';
import { successResponse } from '../../utils/response.js';
import { createDispatchOrderSchema, listDispatchOrdersQuerySchema, updateDispatchOrderSchema } from './sale-orders.validation.js';
import * as saleOrdersService from './sale-orders.service.js';

export const saleOrdersRouter = Router();
saleOrdersRouter.use(requireAuth);

// Dispatch Order Phase 3 role table (single source of truth: @erve/shared's
// rbac.ts, also used by apps/web/src/auth/permissions.ts — consolidating
// what used to be three independently-drifted copies):
// - DISTRIBUTOR has no Dispatch Order role at all (no create/view/edit).
// - FACTORY_USER gains read-only list/detail access (server-scoped to its
//   own mapped Factory — see resolveListFactoryScope/
//   assertDispatchOrderViewAccess) but never the audit trail, which carries
//   internal correction/allocation metadata it has no operational need for.
// - QA_USER has no access.
// - ADMIN's create/edit rights are unchanged from the old Sale Order
//   workflow — no new capability granted.
const canView = requireRoles(...DISPATCH_ORDER_VIEW_ROLES);
const canViewAudit = requireRoles(...DISPATCH_ORDER_AUDIT_VIEW_ROLES);
const canMutate = requireRoles(...DISPATCH_ORDER_MUTATION_ROLES);

function idempotencyKey(req: { get(name: string): string | undefined }): string {
  const key = req.get('Idempotency-Key')?.trim();
  if (!key || key.length > 200) {
    throw HttpError.badRequest('Idempotency-Key header is required and must be at most 200 characters');
  }
  return key;
}

// Static routes must be registered before the `/:id` route below — Express
// would otherwise match a literal path segment as an `:id` value.
saleOrdersRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listDispatchOrdersQuerySchema.parse(req.query);
    const orders = await saleOrdersService.getSaleOrderList(req.user!, filters);
    res.status(200).json(successResponse(orders));
  }),
);

saleOrdersRouter.post(
  '/',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = createDispatchOrderSchema.parse(req.body);
    const order = await saleOrdersService.createDispatchOrder(req.user!, input, idempotencyKey(req));
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

saleOrdersRouter.get(
  '/:id/audit',
  canViewAudit,
  asyncHandler(async (req, res) => {
    const history = await saleOrdersService.getSaleOrderAuditHistory(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(history));
  }),
);

saleOrdersRouter.patch(
  '/:id',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = updateDispatchOrderSchema.parse(req.body);
    const order = await saleOrdersService.updateDispatchOrder(
      req.user!,
      req.params.id! as string,
      input,
      idempotencyKey(req),
    );
    res.status(200).json(successResponse(order));
  }),
);

// The old submit/start-review/reject/cancel/approve workflow routes and the
// already-retired /actions/fulfill are gone entirely — Dispatch Order
// creation itself is the sole allocation point (see sale-orders.service.ts),
// there is no draft/review/approval workflow and no cancellation.
