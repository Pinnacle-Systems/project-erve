import { Router } from 'express';
import { INVOICE_HANDOFF_MUTATION_ROLES, INVOICE_HANDOFF_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { listInvoiceHandoffsQuerySchema, recordTallyInvoiceReferenceSchema } from './invoice-handoff.validation.js';
import * as invoiceHandoffService from './invoice-handoff.service.js';

export const invoiceHandoffsRouter = Router();
invoiceHandoffsRouter.use(requireAuth);

const canView = requireRoles(...INVOICE_HANDOFF_VIEW_ROLES);
const canMutate = requireRoles(...INVOICE_HANDOFF_MUTATION_ROLES);

invoiceHandoffsRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listInvoiceHandoffsQuerySchema.parse(req.query);
    const result = await invoiceHandoffService.getInvoiceHandoffList(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

invoiceHandoffsRouter.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const invoice = await invoiceHandoffService.getInvoiceHandoffDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(invoice));
  }),
);

invoiceHandoffsRouter.patch(
  '/:id/tally-reference',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = recordTallyInvoiceReferenceSchema.parse(req.body);
    const invoice = await invoiceHandoffService.recordTallyInvoiceReference(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(invoice));
  }),
);
