import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { createHsnSchema, listHsnsQuerySchema, updateHsnSchema } from './hsn.validation.js';
import * as hsnService from './hsn.service.js';

export const hsnsRouter = Router();
hsnsRouter.use(requireAuth);

// HSN identity (code/description/status) is operational master data that
// MERCHANDISER owns, same as Style — so this route-level gate stays broad
// (ADMIN + MERCHANDISER + ACCOUNTANT write, +SENIOR_MANAGEMENT read). But
// the HSN -> GST Rule Set assignment is statutory tax configuration (RBAC
// finalization review): hsnService.createHsn/updateHsn separately enforce,
// at the FIELD level, that only ADMIN/ACCOUNTANT may set or change
// gstRuleSetId — a MERCHANDISER request that edits identity fields without
// touching gstRuleSetId still succeeds here, but one that tries to
// assign/change it is rejected in the service regardless of this route gate.
const canManageHsns = requireRoles('ADMIN', 'MERCHANDISER', 'ACCOUNTANT');
const canViewHsns = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT');

hsnsRouter.get(
  '/',
  canViewHsns,
  asyncHandler(async (req, res) => {
    const filters = listHsnsQuerySchema.parse(req.query);
    const hsns = await hsnService.listHsns(filters);
    res.status(200).json(successResponse(hsns));
  }),
);

hsnsRouter.post(
  '/',
  canManageHsns,
  asyncHandler(async (req, res) => {
    const input = createHsnSchema.parse(req.body);
    const hsn = await hsnService.createHsn(req.user!, input);
    res.status(201).json(successResponse(hsn));
  }),
);

// Registered before '/:id' so 'gst-rule-set-options'/'options' are never
// captured as an HSN id.
hsnsRouter.get(
  '/gst-rule-set-options',
  canManageHsns,
  asyncHandler(async (_req, res) => {
    const options = await hsnService.listGstRuleSetOptionsForHsn();
    res.status(200).json(successResponse(options));
  }),
);

// Style's HSN selector (INV-002 review correction) — gated like the
// Season/Size/Process-Flow options endpoints (canManageMasterData in
// master-data.routes.ts), not the broader view gate, since this only
// feeds a Style create/edit form. canManageHsns is a superset of
// STYLE_MANAGE_ROLES (ADMIN+MERCHANDISER), so every Style editor reaches it.
hsnsRouter.get(
  '/options',
  canManageHsns,
  asyncHandler(async (_req, res) => {
    const options = await hsnService.listHsnOptions();
    res.status(200).json(successResponse(options));
  }),
);

hsnsRouter.get(
  '/:id',
  canViewHsns,
  asyncHandler(async (req, res) => {
    const hsn = await hsnService.getHsnDetail(req.params.id! as string);
    res.status(200).json(successResponse(hsn));
  }),
);

hsnsRouter.patch(
  '/:id',
  canManageHsns,
  asyncHandler(async (req, res) => {
    const input = updateHsnSchema.parse(req.body);
    const hsn = await hsnService.updateHsn(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(hsn));
  }),
);
