import { Router } from 'express';
import { EWAY_BILL_MANAGE_ROLES, EWAY_BILL_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import type { EwayBillEligibilityService } from './eway-bill-eligibility.service.js';
import type { EwayBillOperationsService } from './eway-bill-operations.service.js';
import { attemptParamsSchema, taxInvoiceParamsSchema } from './eway-bill-operations.validation.js';

/**
 * Mounted at /tax-invoices alongside the Tax Invoice router.
 *
 *   ADMIN + ACCOUNTANT : every GET
 *   ACCOUNTANT only    : PUT movement, POST generate / close-demo / link
 *
 * Request bodies are validated (strict) by the operations service, so a
 * client-supplied mode, test_mode, credential or unknown field is a 400.
 * The role middleware runs first, so an unauthorized caller reaches no code
 * that reads invoice data.
 */
export function createEwayBillRouter(
  eligibility: EwayBillEligibilityService,
  operations: EwayBillOperationsService,
) {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:id/eway-bill-readiness',
    requireRoles(...EWAY_BILL_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(200).json(successResponse(await eligibility.getReadiness(req.user!, id)));
    }),
  );

  router.get(
    '/:id/eway-bill/movement',
    requireRoles(...EWAY_BILL_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(200).json(successResponse(await operations.getMovement(req.user!, id)));
    }),
  );

  router.put(
    '/:id/eway-bill/movement',
    requireRoles(...EWAY_BILL_MANAGE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(200).json(successResponse(await operations.saveMovement(req.user!, id, req.body)));
    }),
  );

  router.get(
    '/:id/eway-bill/generation-preview',
    requireRoles(...EWAY_BILL_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(200).json(successResponse(await operations.preview(req.user!, id)));
    }),
  );

  router.post(
    '/:id/eway-bill/generate',
    requireRoles(...EWAY_BILL_MANAGE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      const result = await operations.generateDemo(req.user!, id, req.body);
      // 201 a synthetic bill was recorded; 202 the outcome is unknown and the
      // attempt stays open; 200 the provider definitively refused.
      const status = result.outcome === 'SUCCEEDED' ? 201 : result.outcome === 'UNCERTAIN' ? 202 : 200;
      res.status(status).json(successResponse(result));
    }),
  );

  router.get(
    '/:id/eway-bill/attempts',
    requireRoles(...EWAY_BILL_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(200).json(successResponse(await operations.history(req.user!, id)));
    }),
  );

  router.post(
    '/:id/eway-bill/attempts/:attemptId/close-demo',
    requireRoles(...EWAY_BILL_MANAGE_ROLES),
    asyncHandler(async (req, res) => {
      const { id, attemptId } = attemptParamsSchema.parse(req.params);
      res
        .status(200)
        .json(successResponse(await operations.closeDemoAttempt(req.user!, id, attemptId, req.body)));
    }),
  );

  router.post(
    '/:id/eway-bill/link',
    requireRoles(...EWAY_BILL_MANAGE_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(201).json(successResponse(await operations.linkExisting(req.user!, id, req.body)));
    }),
  );

  return router;
}
