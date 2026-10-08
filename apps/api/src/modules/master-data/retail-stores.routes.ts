import { Router } from 'express';
import { RETAIL_STORE_MANAGE_ROLES, RETAIL_STORE_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import * as validation from './retail-stores.validation.js';
import * as service from './retail-stores.service.js';

export const retailStoresRouter = Router();
retailStoresRouter.use(requireAuth);
const view = requireRoles(...RETAIL_STORE_VIEW_ROLES);
const manage = requireRoles(...RETAIL_STORE_MANAGE_ROLES);
retailStoresRouter.get(
  '/',
  view,
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await service.listRetailStores(
          req.user!,
          validation.listRetailStoresSchema.parse(req.query),
        ),
      ),
    );
  }),
);
retailStoresRouter.get(
  '/options',
  view,
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await service.retailStoreOptions(
          req.user!,
          validation.retailStoreOptionsSchema.parse(req.query),
        ),
      ),
    );
  }),
);
retailStoresRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        successResponse(
          await service.createRetailStore(
            req.user!,
            validation.createRetailStoreSchema.parse(req.body),
          ),
        ),
      );
  }),
);
retailStoresRouter.get(
  '/:id',
  view,
  asyncHandler(async (req, res) => {
    res.json(successResponse(await service.getRetailStore(req.user!, String(req.params.id))));
  }),
);
retailStoresRouter.patch(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await service.updateRetailStore(
          req.user!,
          String(req.params.id),
          validation.updateRetailStoreSchema.parse(req.body),
        ),
      ),
    );
  }),
);
retailStoresRouter.patch(
  '/:id/status',
  manage,
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await service.updateRetailStore(
          req.user!,
          String(req.params.id),
          validation.retailStoreStatusSchema.parse(req.body),
        ),
      ),
    );
  }),
);
