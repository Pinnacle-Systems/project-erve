import { z } from 'zod';
import { reportFilterFields } from './reports-filters.validation.js';

// Each report documents its own supported filter subset (RPT0 4.1) rather
// than sharing one all-fields schema every endpoint would partially ignore.

export const operationsSummaryQuerySchema = z.object({
  factoryId: reportFilterFields.factoryId,
  financialYearId: reportFilterFields.financialYearId,
  seasonId: reportFilterFields.seasonId,
  distributorId: reportFilterFields.distributorId,
  recordOrigin: reportFilterFields.recordOrigin,
});

export const productionReportQuerySchema = z.object({
  factoryId: reportFilterFields.factoryId,
  financialYearId: reportFilterFields.financialYearId,
  seasonId: reportFilterFields.seasonId,
  recordOrigin: reportFilterFields.recordOrigin,
});

export const fulfillmentReportQuerySchema = z.object({
  factoryId: reportFilterFields.factoryId,
  distributorId: reportFilterFields.distributorId,
});

export const saleOrReturnReportQuerySchema = z.object({
  distributorId: reportFilterFields.distributorId,
  groupByStyle: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

export const distributorReturnsReportQuerySchema = z.object({
  distributorId: reportFilterFields.distributorId,
  fromDate: reportFilterFields.fromDate,
  toDate: reportFilterFields.toDate,
  groupBy: z.enum(['status', 'distributor', 'both']).optional(),
});
