import { Router } from 'express';
import { SALE_OR_RETURN_POSITION_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  listStockStyleSourcesQuerySchema,
  listStockStylesQuerySchema,
  stockStyleParamsSchema,
  stockStyleScopeQuerySchema,
} from './sale-or-return-stock.validation.js';
import {
  getStockStyleDetail,
  listStockStyleSources,
  listStockStyleStores,
  listStockStyles,
} from './sale-or-return-stock.service.js';

// Read-only, Style-first consolidated Sale-or-Return stock. Same audience as the
// per-Dispatch position list (SALE_OR_RETURN_POSITION_VIEW_ROLES); the service
// additionally pins a DISTRIBUTOR to its own Distributor. No mutation routes.
export const saleOrReturnStockRouter = Router();
saleOrReturnStockRouter.use(requireAuth, requireRoles(...SALE_OR_RETURN_POSITION_VIEW_ROLES));

saleOrReturnStockRouter.get(
  '/styles',
  asyncHandler(async (req, res) => {
    res.json(successResponse(await listStockStyles(req.user!, listStockStylesQuerySchema.parse(req.query))));
  }),
);

saleOrReturnStockRouter.get(
  '/styles/:styleId',
  asyncHandler(async (req, res) => {
    const { styleId } = stockStyleParamsSchema.parse(req.params);
    res.json(
      successResponse(await getStockStyleDetail(req.user!, styleId, stockStyleScopeQuerySchema.parse(req.query))),
    );
  }),
);

saleOrReturnStockRouter.get(
  '/styles/:styleId/stores',
  asyncHandler(async (req, res) => {
    const { styleId } = stockStyleParamsSchema.parse(req.params);
    res.json(
      successResponse(await listStockStyleStores(req.user!, styleId, stockStyleScopeQuerySchema.parse(req.query))),
    );
  }),
);

saleOrReturnStockRouter.get(
  '/styles/:styleId/sources',
  asyncHandler(async (req, res) => {
    const { styleId } = stockStyleParamsSchema.parse(req.params);
    res.json(
      successResponse(
        await listStockStyleSources(req.user!, styleId, listStockStyleSourcesQuerySchema.parse(req.query)),
      ),
    );
  }),
);
