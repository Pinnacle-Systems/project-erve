import { Router } from 'express';
import {
  DISTRIBUTOR_SALES_REPORT_SUBMIT_ROLES,
  DISTRIBUTOR_SALES_REPORT_VIEW_ROLES,
  SALE_OR_RETURN_POSITION_VIEW_ROLES,
} from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  listDistributorSalesReportsQuerySchema,
  listSaleOrReturnPositionsQuerySchema,
  submitDistributorSalesReportSchema,
} from './distributor-sales-report.validation.js';
import * as distributorSalesReportService from './distributor-sales-report.service.js';

export const saleOrReturnPositionsRouter = Router();
saleOrReturnPositionsRouter.use(requireAuth);

saleOrReturnPositionsRouter.get(
  '/',
  requireRoles(...SALE_OR_RETURN_POSITION_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const filters = listSaleOrReturnPositionsQuerySchema.parse(req.query);
    const items = await distributorSalesReportService.listSaleOrReturnPositions(req.user!, filters);
    res.status(200).json(successResponse({ items }));
  }),
);

export const distributorSalesReportsRouter = Router();
distributorSalesReportsRouter.use(requireAuth);

const canView = requireRoles(...DISTRIBUTOR_SALES_REPORT_VIEW_ROLES);
const canSubmit = requireRoles(...DISTRIBUTOR_SALES_REPORT_SUBMIT_ROLES);

distributorSalesReportsRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listDistributorSalesReportsQuerySchema.parse(req.query);
    const result = await distributorSalesReportService.listDistributorSalesReports(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

distributorSalesReportsRouter.post(
  '/',
  canSubmit,
  asyncHandler(async (req, res) => {
    const input = submitDistributorSalesReportSchema.parse(req.body);
    const report = await distributorSalesReportService.submitDistributorSalesReport(req.user!, input);
    res.status(201).json(successResponse(report));
  }),
);

distributorSalesReportsRouter.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const report = await distributorSalesReportService.getDistributorSalesReportDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(report));
  }),
);
