import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { createTaxInvoiceDraftSchema, listTaxInvoicesQuerySchema } from './tax-invoice.validation.js';
import * as taxInvoiceService from './tax-invoice.service.js';

export const taxInvoicesRouter = Router();
taxInvoicesRouter.use(requireAuth);

// INV-005: ACCOUNTANT-only draft creation, ADMIN+ACCOUNTANT read — see
// TAX_INVOICE_MUTATION_ROLES/TAX_INVOICE_VIEW_ROLES in @erve/shared's
// rbac.ts for the reasoning (mirrors FACTORY_INVOICE_FINANCIAL_ROLES'
// ADMIN-excluded precedent). No PATCH/DELETE/finalize/cancel route exists —
// this story only establishes the DRAFT domain.
const canCreateTaxInvoice = requireRoles('ACCOUNTANT');
const canViewTaxInvoices = requireRoles('ADMIN', 'ACCOUNTANT');

taxInvoicesRouter.post(
  '/',
  canCreateTaxInvoice,
  asyncHandler(async (req, res) => {
    const input = createTaxInvoiceDraftSchema.parse(req.body);
    const result = await taxInvoiceService.createOrGetTaxInvoiceDraft(req.user!, input.ervePackingListId);
    res.status(result.created ? 201 : 200).json(successResponse(result.taxInvoice));
  }),
);

taxInvoicesRouter.get(
  '/',
  canViewTaxInvoices,
  asyncHandler(async (req, res) => {
    const filters = listTaxInvoicesQuerySchema.parse(req.query);
    const result = await taxInvoiceService.getTaxInvoiceList(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

taxInvoicesRouter.get(
  '/by-erve-packing-list/:ervePackingListId',
  canViewTaxInvoices,
  asyncHandler(async (req, res) => {
    const invoice = await taxInvoiceService.getTaxInvoiceByErvePackingListId(
      req.user!,
      req.params.ervePackingListId! as string,
    );
    res.status(200).json(successResponse(invoice));
  }),
);

taxInvoicesRouter.get(
  '/by-erve-dispatch/:erveDispatchId',
  canViewTaxInvoices,
  asyncHandler(async (req, res) => {
    const invoice = await taxInvoiceService.getTaxInvoiceByErveDispatchId(
      req.user!,
      req.params.erveDispatchId! as string,
    );
    res.status(200).json(successResponse(invoice));
  }),
);

taxInvoicesRouter.get(
  '/:id',
  canViewTaxInvoices,
  asyncHandler(async (req, res) => {
    const invoice = await taxInvoiceService.getTaxInvoiceDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(invoice));
  }),
);
