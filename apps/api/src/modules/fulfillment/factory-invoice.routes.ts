import { Router } from 'express';
import { FACTORY_INVOICE_CONFIRM_ROLES, FACTORY_INVOICE_FINANCIAL_ROLES, FACTORY_INVOICE_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { versionedActionSchema } from './factory-dispatch.validation.js';
import {
  confirmFactoryInvoiceSchema,
  listFactoryInvoicesQuerySchema,
  updateFactoryInvoiceFinancialsSchema,
} from './factory-invoice.validation.js';
import * as factoryInvoiceService from './factory-invoice.service.js';

export const factoryInvoicesRouter = Router();
factoryInvoicesRouter.use(requireAuth);

const canView = requireRoles(...FACTORY_INVOICE_VIEW_ROLES);
const canConfirm = requireRoles(...FACTORY_INVOICE_CONFIRM_ROLES);
const canManageFinancials = requireRoles(...FACTORY_INVOICE_FINANCIAL_ROLES);

factoryInvoicesRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listFactoryInvoicesQuerySchema.parse(req.query);
    const result = await factoryInvoiceService.getFactoryInvoiceList(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

factoryInvoicesRouter.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const invoice = await factoryInvoiceService.getFactoryInvoiceDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(invoice));
  }),
);

factoryInvoicesRouter.post(
  '/:id/confirm',
  canConfirm,
  asyncHandler(async (req, res) => {
    confirmFactoryInvoiceSchema.parse(req.body ?? {});
    const invoice = await factoryInvoiceService.confirmFactoryInvoice(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(invoice));
  }),
);

factoryInvoicesRouter.patch(
  '/:id/financials',
  canManageFinancials,
  asyncHandler(async (req, res) => {
    const input = updateFactoryInvoiceFinancialsSchema.parse(req.body);
    const invoice = await factoryInvoiceService.updateFactoryInvoiceFinancials(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(invoice));
  }),
);

factoryInvoicesRouter.post(
  '/:id/finalize',
  canManageFinancials,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const invoice = await factoryInvoiceService.finalizeFactoryInvoice(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(invoice));
  }),
);
