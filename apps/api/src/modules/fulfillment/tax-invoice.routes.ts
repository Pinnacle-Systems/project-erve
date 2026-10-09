import { Router } from 'express';
import { Prisma } from '../../db/prisma.js';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createTaxInvoiceDraftSchema,
  listTaxInvoicesQuerySchema,
  overrideTaxInvoiceLineRateSchema,
} from './tax-invoice.validation.js';
import * as taxInvoiceService from './tax-invoice.service.js';

export const taxInvoicesRouter = Router();
taxInvoicesRouter.use(requireAuth);

// INV-005/INV-006: ACCOUNTANT-only draft creation, override and
// finalization; ADMIN+ACCOUNTANT read-only — see TAX_INVOICE_MUTATION_ROLES/
// TAX_INVOICE_VIEW_ROLES in @erve/shared's rbac.ts for the reasoning
// (mirrors FACTORY_INVOICE_FINANCIAL_ROLES' ADMIN-excluded precedent).
// Confirmed business decision: ADMIN never gains override/finalize rights
// under INV-006 — reusing the same unwidened role set for both new routes.
const canCreateTaxInvoice = requireRoles('ACCOUNTANT');
const canMutateTaxInvoice = requireRoles('ACCOUNTANT');
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

// INV-006: ACCOUNTANT-only, DRAFT-only rate override on one line.
taxInvoicesRouter.patch(
  '/:id/lines/:lineId/override',
  canMutateTaxInvoice,
  asyncHandler(async (req, res) => {
    const input = overrideTaxInvoiceLineRateSchema.parse(req.body);
    const invoice = await taxInvoiceService.overrideTaxInvoiceLineRate(
      req.user!,
      req.params.id! as string,
      req.params.lineId! as string,
      { overrideUnitRate: new Prisma.Decimal(input.overrideUnitRate), reason: input.reason },
    );
    res.status(200).json(successResponse(invoice));
  }),
);

// INV-006: ACCOUNTANT-only atomic finalization. Idempotent — see
// finalizeTaxInvoice's header comment; always 200, never 201, since a
// repeated call returns the same persisted document, not a new one.
taxInvoicesRouter.post(
  '/:id/actions/finalize',
  canMutateTaxInvoice,
  asyncHandler(async (req, res) => {
    const invoice = await taxInvoiceService.finalizeTaxInvoice(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(invoice));
  }),
);
