import { Router } from 'express';
import { RETAIL_STORE_INVENTORY_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  listRetailStoreInventoryQuerySchema,
  listRetailStoreInventorySourcesQuerySchema,
} from './retail-store-inventory.validation.js';
import { listRetailStoreInventory, listRetailStoreInventorySources } from './retail-store-inventory.service.js';

// Read-only. Deliberately its own router and role set — never RETAIL_STORE_VIEW_ROLES,
// which guards the Retail Store master endpoints a Distributor must not browse.
export const retailStoreInventoryRouter = Router();
retailStoreInventoryRouter.use(requireAuth, requireRoles(...RETAIL_STORE_INVENTORY_VIEW_ROLES));

retailStoreInventoryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await listRetailStoreInventory(req.user!, listRetailStoreInventoryQuerySchema.parse(req.query)),
      ),
    );
  }),
);

retailStoreInventoryRouter.get(
  '/sources',
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await listRetailStoreInventorySources(
          req.user!,
          listRetailStoreInventorySourcesQuerySchema.parse(req.query),
        ),
      ),
    );
  }),
);
