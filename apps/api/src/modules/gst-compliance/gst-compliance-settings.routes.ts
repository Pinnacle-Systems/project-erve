import { Router } from 'express';
import { GST_COMPLIANCE_SETTINGS_MANAGE_ROLES, GST_COMPLIANCE_SETTINGS_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import type { GstComplianceSettingsService } from './gst-compliance-settings.service.js';
import { updateGstComplianceSettingsSchema } from './gst-compliance-settings.validation.js';

export function createGstComplianceSettingsRouter(service: GstComplianceSettingsService) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', requireRoles(...GST_COMPLIANCE_SETTINGS_VIEW_ROLES), asyncHandler(async (req, res) => {
    res.json(successResponse(await service.read(req.user!)));
  }));
  router.get('/audit', requireRoles(...GST_COMPLIANCE_SETTINGS_VIEW_ROLES), asyncHandler(async (req, res) => {
    res.json(successResponse(await service.history(req.user!)));
  }));
  router.patch('/', requireRoles(...GST_COMPLIANCE_SETTINGS_MANAGE_ROLES), asyncHandler(async (req, res) => {
    const input = updateGstComplianceSettingsSchema.parse(req.body);
    res.json(successResponse(await service.update(req.user!, input)));
  }));
  return router;
}
