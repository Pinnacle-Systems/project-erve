import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createGstRuleSetSchema,
  createGstValueBandSchema,
  draftVersionWindowSchema,
  listGstRuleSetsQuerySchema,
  resolveGstRuleQuerySchema,
  updateGstRuleSetSchema,
  updateGstValueBandSchema,
} from './gst-rule-sets.validation.js';
import * as gstRuleSetsService from './gst-rule-sets.service.js';

export const gstRuleSetsRouter = Router();
gstRuleSetsRouter.use(requireAuth);

// Deliberately NOT the same manage charter as the HSN master (hsn.routes.ts)
// — GST rate/version configuration is statutory tax configuration, not
// operational master data, so it stays finance-only (RBAC finalization
// review): only ADMIN and ACCOUNTANT may create/version/activate a rule set
// or its bands. MERCHANDISER and SENIOR_MANAGEMENT can view (every role
// that can view/edit an HSN can also see the rule sets it may reference),
// but never mutate.
const canManageGstRuleSets = requireRoles('ADMIN', 'ACCOUNTANT');
const canViewGstRuleSets = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT');

gstRuleSetsRouter.get(
  '/',
  canViewGstRuleSets,
  asyncHandler(async (req, res) => {
    const filters = listGstRuleSetsQuerySchema.parse(req.query);
    const ruleSets = await gstRuleSetsService.listGstRuleSets(filters);
    res.status(200).json(successResponse(ruleSets));
  }),
);

gstRuleSetsRouter.post(
  '/',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = createGstRuleSetSchema.parse(req.body);
    const ruleSet = await gstRuleSetsService.createGstRuleSet(req.user!, input);
    res.status(201).json(successResponse(ruleSet));
  }),
);

// Registered before '/:id' so 'resolve' is never captured as a rule-set id.
// This resolves which value band applies — it never computes a tax amount
// (that is INV-006's Tax Invoice domain).
gstRuleSetsRouter.get(
  '/resolve',
  canViewGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = resolveGstRuleQuerySchema.parse(req.query);
    const result = await gstRuleSetsService.resolveGstRuleForHsn(input);
    res.status(200).json(successResponse(result));
  }),
);

gstRuleSetsRouter.get(
  '/:id',
  canViewGstRuleSets,
  asyncHandler(async (req, res) => {
    const ruleSet = await gstRuleSetsService.getGstRuleSetDetail(req.params.id! as string);
    res.status(200).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.patch(
  '/:id',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = updateGstRuleSetSchema.parse(req.body);
    const ruleSet = await gstRuleSetsService.updateGstRuleSet(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.post(
  '/:id/versions',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = draftVersionWindowSchema.parse(req.body);
    const ruleSet = await gstRuleSetsService.createGstRuleSetVersion(
      req.user!,
      req.params.id! as string,
      input,
    );
    res.status(201).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.patch(
  '/:id/versions/:versionId',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = draftVersionWindowSchema.parse(req.body);
    const ruleSet = await gstRuleSetsService.updateGstRuleSetVersionWindow(
      req.user!,
      req.params.id! as string,
      req.params.versionId! as string,
      input,
    );
    res.status(200).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.delete(
  '/:id/versions/:versionId',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const ruleSet = await gstRuleSetsService.deleteGstRuleSetVersion(
      req.user!,
      req.params.id! as string,
      req.params.versionId! as string,
    );
    res.status(200).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.post(
  '/:id/versions/:versionId/bands',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = createGstValueBandSchema.parse(req.body);
    const ruleSet = await gstRuleSetsService.addGstValueBand(
      req.user!,
      req.params.id! as string,
      req.params.versionId! as string,
      input,
    );
    res.status(201).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.patch(
  '/:id/versions/:versionId/bands/:bandId',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const input = updateGstValueBandSchema.parse(req.body);
    const ruleSet = await gstRuleSetsService.updateGstValueBand(
      req.user!,
      req.params.id! as string,
      req.params.versionId! as string,
      req.params.bandId! as string,
      input,
    );
    res.status(200).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.delete(
  '/:id/versions/:versionId/bands/:bandId',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const ruleSet = await gstRuleSetsService.removeGstValueBand(
      req.user!,
      req.params.id! as string,
      req.params.versionId! as string,
      req.params.bandId! as string,
    );
    res.status(200).json(successResponse(ruleSet));
  }),
);

gstRuleSetsRouter.post(
  '/:id/versions/:versionId/actions/activate',
  canManageGstRuleSets,
  asyncHandler(async (req, res) => {
    const ruleSet = await gstRuleSetsService.activateGstRuleSetVersion(
      req.user!,
      req.params.id! as string,
      req.params.versionId! as string,
    );
    res.status(200).json(successResponse(ruleSet));
  }),
);
