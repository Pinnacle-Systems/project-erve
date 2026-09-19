import { Router } from 'express';
import {
  DISPATCH_ORDER_AUDIT_VIEW_ROLES,
  DISPATCH_ORDER_FILTER_ROLES,
  DISPATCH_ORDER_MUTATION_ROLES,
  DISPATCH_ORDER_VIEW_ROLES,
  FACTORY_DISPATCH_MUTATION_ROLES,
} from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../errors/http-error.js';
import { successResponse } from '../../utils/response.js';
import {
  createDispatchOrderSchema,
  dispatchOrderDistributorOptionsQuerySchema,
  dispatchOrderFactoryOptionsQuerySchema,
  listDispatchOrdersQuerySchema,
  updateDispatchOrderSchema,
} from './sale-orders.validation.js';
import { createCartonSchema } from '../fulfillment/factory-dispatch.validation.js';
import * as saleOrdersService from './sale-orders.service.js';
import * as factoryDispatchService from '../fulfillment/factory-dispatch.service.js';

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
// Packing List / carton creation is a Factory Dispatch mutation, not a
// Dispatch Order one (FACTORY_USER/ADMIN, not MERCHANDISER — see
// FACTORY_DISPATCH_MUTATION_ROLES) — kept on this router only because carton
// creation is keyed by the Dispatch Order (Phase 4 plan §2/§5), not a
// FactoryDispatch id which may not exist yet.
const canCreateCarton = requireRoles(...FACTORY_DISPATCH_MUTATION_ROLES);
const canFilterDispatchOrders = requireRoles(...DISPATCH_ORDER_FILTER_ROLES);

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

// UXAUTH-015: the Dispatch Order Factory/Distributor filters' minimal
// lookups. ACCOUNTANT and SENIOR_MANAGEMENT can list Dispatch Orders but are
// denied on the broad Factory/Distributor masters (master-data.routes.ts's
// canViewFactories is ADMIN/MERCHANDISER only, and canViewDistributors omits
// ACCOUNTANT) — these routes instead reuse DISPATCH_ORDER_FILTER_ROLES, the
// exact list that governs the filters' visibility on Web, so the two can
// never drift. Must stay registered before `/:id` so the literal path
// segments are never captured as an id.
saleOrdersRouter.get(
  '/factory-options',
  canFilterDispatchOrders,
  asyncHandler(async (req, res) => {
    const filters = dispatchOrderFactoryOptionsQuerySchema.parse(req.query);
    const options = await saleOrdersService.listFactoryOptionsForDispatchOrders(filters);
    res.status(200).json(successResponse(options));
  }),
);

saleOrdersRouter.get(
  '/distributor-options',
  canFilterDispatchOrders,
  asyncHandler(async (req, res) => {
    const filters = dispatchOrderDistributorOptionsQuerySchema.parse(req.query);
    const options = await saleOrdersService.listDistributorOptionsForDispatchOrders(filters);
    res.status(200).json(successResponse(options));
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

// Phase 4: the Factory Packing List is readable the moment a Dispatch Order
// exists — no FactoryDispatch id required, and this creates nothing. Reuses
// the SAME Dispatch Order view-access rule as GET /:id above (see
// getDispatchOrderPackingList). QA_USER is deliberately excluded — its
// Packing Audit discovery path is /packing-audit/... instead.
saleOrdersRouter.get(
  '/:id/packing-list',
  canView,
  asyncHandler(async (req, res) => {
    const packingList = await saleOrdersService.getDispatchOrderPackingList(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(packingList));
  }),
);

// Carton creation is keyed by the Dispatch Order, not a FactoryDispatch id,
// because the packing root may not exist yet (Phase 4 plan §2/§5) — the
// service gets-or-creates it atomically under the sale-order lock.
saleOrdersRouter.post(
  '/:id/packing-list/cartons',
  canCreateCarton,
  asyncHandler(async (req, res) => {
    const input = createCartonSchema.parse(req.body);
    const packingList = await factoryDispatchService.addFactoryPackingCarton(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(packingList));
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
