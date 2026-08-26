import { Router } from 'express';
import { FINANCIAL_YEAR_READ_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  computeFinancialYearWindow,
  parseStrictCalendarDate,
  toCompactFinancialYearCode,
} from './financial-year.util.js';
import { getCurrentFinancialYear, getFinancialYearById, listFinancialYears } from './financial-year.service.js';
import { resolveFinancialYearQuerySchema } from './financial-year.validation.js';

// Read-only: no POST/PATCH/DELETE here. Persisting a FinancialYear row is
// exclusively `ensureFinancialYear`'s job, called only from internal PO/JO
// creation service code — never from a public route.
export const financialYearsRouter = Router();

financialYearsRouter.use(requireAuth);

const canReadFinancialYears = requireRoles(...FINANCIAL_YEAR_READ_ROLES);

financialYearsRouter.get(
  '/',
  canReadFinancialYears,
  asyncHandler(async (_req, res) => {
    res.json(successResponse(await listFinancialYears()));
  }),
);

financialYearsRouter.get(
  '/current',
  canReadFinancialYears,
  asyncHandler(async (_req, res) => {
    res.json(successResponse(await getCurrentFinancialYear()));
  }),
);

// Pure preview for the PO date field as the user types — creates nothing.
financialYearsRouter.get(
  '/resolve',
  canReadFinancialYears,
  asyncHandler(async (req, res) => {
    const { date } = resolveFinancialYearQuerySchema.parse(req.query);
    const businessDate = parseStrictCalendarDate(date)!;
    const window = computeFinancialYearWindow(businessDate);
    res.json(
      successResponse({
        code: window.code,
        compactCode: toCompactFinancialYearCode(window.code),
        startDate: window.startDate,
        endDate: window.endDate,
      }),
    );
  }),
);

financialYearsRouter.get(
  '/:id',
  canReadFinancialYears,
  asyncHandler(async (req, res) => {
    res.json(successResponse(await getFinancialYearById(String(req.params.id))));
  }),
);
