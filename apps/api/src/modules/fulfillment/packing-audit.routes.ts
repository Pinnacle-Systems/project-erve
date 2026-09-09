import { Router } from 'express';
import { PACKING_AUDIT_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { packingAuditQueueQuerySchema } from './factory-dispatch.validation.js';
import * as factoryDispatchService from './factory-dispatch.service.js';

// QA's narrow Packing Audit discovery surface — deliberately not the full
// Dispatch-Order-keyed Packing List projection (which stays closed to
// QA_USER). QA_USER is intentionally NOT factory-scoped here (see the
// Phase 4 plan's QA-factory-scoping resolution: userFactory mappings are
// enforced server-side to FACTORY_USER only, and QA_USER mirrors the
// existing, already cross-factory Job-Order-QA inspection workflow).
// ADMIN may view for oversight; only QA_USER may confirm (see
// factory-dispatch.routes.ts's /:id/cartons/:cartonId/audit).
export const packingAuditRouter = Router();
packingAuditRouter.use(requireAuth);

const canViewQueue = requireRoles(...PACKING_AUDIT_VIEW_ROLES);

packingAuditRouter.get(
  '/queue',
  canViewQueue,
  asyncHandler(async (req, res) => {
    const filters = packingAuditQueueQuerySchema.parse(req.query);
    const result = await factoryDispatchService.getPackingAuditQueue(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

packingAuditRouter.get(
  '/cartons/:cartonId',
  canViewQueue,
  asyncHandler(async (req, res) => {
    const detail = await factoryDispatchService.getPackingAuditCartonDetail(req.user!, req.params.cartonId! as string);
    res.status(200).json(successResponse(detail));
  }),
);
