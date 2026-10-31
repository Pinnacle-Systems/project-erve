import { Router } from 'express';
import { GST_API_USAGE_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import type { GstApiUsageService } from './gst-api-usage.service.js';

export function createGstApiUsageRouter(service: GstApiUsageService) {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/',
    requireRoles(...GST_API_USAGE_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      // Live provider statistics must never be served from a shared or browser cache.
      res.setHeader('Cache-Control', 'no-store');
      res.json(successResponse(await service.usageToday(req.user!)));
    }),
  );
  return router;
}
