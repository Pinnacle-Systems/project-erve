import { Router } from 'express';
import { z } from 'zod';
import { EWAY_BILL_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import type { EwayBillEligibilityService } from './eway-bill-eligibility.service.js';

const taxInvoiceParamsSchema = z.object({ id: z.string().trim().min(1).max(128) });

/**
 * Mounted at /tax-invoices alongside the Tax Invoice router. B1 is read-only:
 * no generation, external-link or movement mutation routes exist yet.
 */
export function createEwayBillRouter(service: EwayBillEligibilityService) {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/:id/eway-bill-readiness',
    requireRoles(...EWAY_BILL_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const { id } = taxInvoiceParamsSchema.parse(req.params);
      res.status(200).json(successResponse(await service.getReadiness(req.user!, id)));
    }),
  );
  return router;
}
