import { Router } from 'express';
import {
  DISTRIBUTOR_RETURN_APPROVE_ROLES,
  DISTRIBUTOR_RETURN_RECEIVE_ROLES,
  DISTRIBUTOR_RETURN_SUBMIT_ROLES,
  SALE_OR_RETURN_POSITION_VIEW_ROLES,
} from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  approveDistributorReturnSchema,
  cancelDistributorReturnSchema,
  listDistributorReturnsQuerySchema,
  receiveDistributorReturnSchema,
  recordDistributorReturnCreditNoteSchema,
  rejectDistributorReturnSchema,
  submitDistributorReturnSchema,
} from './distributor-return.validation.js';
import * as distributorReturnService from './distributor-return.service.js';

export const distributorReturnsRouter = Router();
distributorReturnsRouter.use(requireAuth);

const canView = requireRoles(...SALE_OR_RETURN_POSITION_VIEW_ROLES);
const canSubmit = requireRoles(...DISTRIBUTOR_RETURN_SUBMIT_ROLES);
const canApprove = requireRoles(...DISTRIBUTOR_RETURN_APPROVE_ROLES);
const canReceive = requireRoles(...DISTRIBUTOR_RETURN_RECEIVE_ROLES);
// Cancel is allowed for either the submitting Distributor or Finance/Admin,
// depending on the return's current status — the service enforces the
// precise rule, this route just requires the caller be one of the two
// candidate actor sets at all.
const canAttemptCancel = requireRoles(...DISTRIBUTOR_RETURN_SUBMIT_ROLES, ...DISTRIBUTOR_RETURN_APPROVE_ROLES);

distributorReturnsRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listDistributorReturnsQuerySchema.parse(req.query);
    const result = await distributorReturnService.listDistributorReturns(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

distributorReturnsRouter.post(
  '/',
  canSubmit,
  asyncHandler(async (req, res) => {
    const input = submitDistributorReturnSchema.parse(req.body);
    const record = await distributorReturnService.submitDistributorReturn(req.user!, input);
    res.status(201).json(successResponse(record));
  }),
);

distributorReturnsRouter.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const record = await distributorReturnService.getDistributorReturnDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(record));
  }),
);

distributorReturnsRouter.post(
  '/:id/approve',
  canApprove,
  asyncHandler(async (req, res) => {
    const input = approveDistributorReturnSchema.parse(req.body);
    const record = await distributorReturnService.approveDistributorReturn(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(record));
  }),
);

distributorReturnsRouter.post(
  '/:id/reject',
  canApprove,
  asyncHandler(async (req, res) => {
    const input = rejectDistributorReturnSchema.parse(req.body);
    const record = await distributorReturnService.rejectDistributorReturn(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(record));
  }),
);

distributorReturnsRouter.post(
  '/:id/credit-note',
  canApprove,
  asyncHandler(async (req, res) => {
    const input = recordDistributorReturnCreditNoteSchema.parse(req.body);
    const record = await distributorReturnService.recordDistributorReturnCreditNote(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(record));
  }),
);

distributorReturnsRouter.post(
  '/:id/receive',
  canReceive,
  asyncHandler(async (req, res) => {
    const input = receiveDistributorReturnSchema.parse(req.body);
    const record = await distributorReturnService.receiveDistributorReturn(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(record));
  }),
);

distributorReturnsRouter.post(
  '/:id/cancel',
  canAttemptCancel,
  asyncHandler(async (req, res) => {
    const input = cancelDistributorReturnSchema.parse(req.body);
    const record = await distributorReturnService.cancelDistributorReturn(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(record));
  }),
);
