import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { createHsnSchema, listHsnsQuerySchema, updateHsnSchema } from './hsn.validation.js';
import * as hsnService from './hsn.service.js';

export const hsnsRouter = Router();
hsnsRouter.use(requireAuth);

// HSN is Style master data with a tax-configuration dimension grafted on
// (its GST Rule Set assignment) — mirrors the Price List precedent
// (price-lists.routes.ts): MERCHANDISER (master-data owner) plus ADMIN,
// plus ACCOUNTANT as the same explicit business exception (finance assigns
// and cross-checks GST rule sets). Reads add SENIOR_MANAGEMENT oversight.
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

// Registered before '/:id' so 'gst-rule-set-options' is never captured as an
// HSN id.
hsnsRouter.get(
  '/gst-rule-set-options',
  canManageHsns,
  asyncHandler(async (_req, res) => {
    const options = await hsnService.listGstRuleSetOptionsForHsn();
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
