import { Router } from 'express';
import { REPORT_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import * as reportsService from './reports.service.js';
import {
  distributorReturnsReportQuerySchema,
  fulfillmentReportQuerySchema,
  operationsSummaryQuerySchema,
  productionReportQuerySchema,
  saleOrReturnReportQuerySchema,
} from './reports.validation.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const canViewReports = requireRoles(...REPORT_VIEW_ROLES);

reportsRouter.get(
  '/operations/summary',
  canViewReports,
  asyncHandler(async (req, res) => {
    const filters = operationsSummaryQuerySchema.parse(req.query);
    const summary = await reportsService.getOperationsSummary(req.user!, filters);
    res.status(200).json(successResponse(summary));
  }),
);

reportsRouter.get(
  '/production',
  canViewReports,
  asyncHandler(async (req, res) => {
    const filters = productionReportQuerySchema.parse(req.query);
    const report = await reportsService.getProductionReport(req.user!, filters);
    res.status(200).json(successResponse(report));
  }),
);

reportsRouter.get(
  '/fulfillment',
  canViewReports,
  asyncHandler(async (req, res) => {
    const filters = fulfillmentReportQuerySchema.parse(req.query);
    const report = await reportsService.getFulfillmentReport(req.user!, filters);
    res.status(200).json(successResponse(report));
  }),
);

reportsRouter.get(
  '/sale-or-return',
  canViewReports,
  asyncHandler(async (req, res) => {
    const filters = saleOrReturnReportQuerySchema.parse(req.query);
    const report = await reportsService.getSaleOrReturnReport(req.user!, filters);
    res.status(200).json(successResponse(report));
  }),
);

reportsRouter.get(
  '/distributor-returns',
  canViewReports,
  asyncHandler(async (req, res) => {
    const filters = distributorReturnsReportQuerySchema.parse(req.query);
    const report = await reportsService.getDistributorReturnsReport(req.user!, filters);
    res.status(200).json(successResponse(report));
  }),
);

// RPT2 — the management Dashboard's Season filter needs this narrow,
// read-only id/name lookup. Deliberately NOT a widened
// GET /seasons/options: that endpoint is intentionally ADMIN/MERCHANDISER-
// only (see master-data.test.ts), and SENIOR_MANAGEMENT is a reporting-only
// audience there too — this is a separate, reports-scoped surface rather
// than a change to that established access decision.
reportsRouter.get(
  '/season-options',
  canViewReports,
  asyncHandler(async (req, res) => {
    res.status(200).json(successResponse(await reportsService.getSeasonFilterOptions(req.user!)));
  }),
);
