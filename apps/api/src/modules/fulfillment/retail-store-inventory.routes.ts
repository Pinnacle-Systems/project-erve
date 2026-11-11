import { Router } from 'express';
import { RETAIL_STORE_FIFO_ACTION_ROLES, RETAIL_STORE_INVENTORY_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  listRetailStoreInventoryQuerySchema,
  listRetailStoreInventorySourcesQuerySchema,
  storeFifoAvailabilityQuerySchema,
  storeFifoIdempotencyKeySchema,
  storeFifoReturnSchema,
  storeFifoSalesReportSchema,
} from './retail-store-inventory.validation.js';
import { listRetailStoreInventory, listRetailStoreInventorySources } from './retail-store-inventory.service.js';
import {
  getStoreFifoAvailability,
  submitStoreFifoReturn,
  submitStoreFifoSalesReport,
} from './retail-store-fifo.service.js';

// The inventory reads are read-only; the /store-fifo routes (ISS-089) are Distributor-only actions.
// Deliberately its own router and role set — never RETAIL_STORE_VIEW_ROLES,
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

// ISS-089: Store-level FIFO actions. The role gate is the Distributor alone; the service pins every
// request to the caller's own Distributor and to Retail Stores it was dispatched to.
const fifoActionRoles = requireRoles(...RETAIL_STORE_FIFO_ACTION_ROLES);

retailStoreInventoryRouter.get(
  '/store-fifo/availability',
  fifoActionRoles,
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await getStoreFifoAvailability(req.user!, storeFifoAvailabilityQuerySchema.parse(req.query)),
      ),
    );
  }),
);

retailStoreInventoryRouter.post(
  '/store-fifo/sales-reports',
  fifoActionRoles,
  asyncHandler(async (req, res) => {
    const key = storeFifoIdempotencyKeySchema.parse(req.get('Idempotency-Key'));
    const result = await submitStoreFifoSalesReport(req.user!, storeFifoSalesReportSchema.parse(req.body), key);
    res.status(result.replayed ? 200 : 201).json(successResponse(result));
  }),
);

retailStoreInventoryRouter.post(
  '/store-fifo/returns',
  fifoActionRoles,
  asyncHandler(async (req, res) => {
    const key = storeFifoIdempotencyKeySchema.parse(req.get('Idempotency-Key'));
    const result = await submitStoreFifoReturn(req.user!, storeFifoReturnSchema.parse(req.body), key);
    res.status(result.replayed ? 200 : 201).json(successResponse(result));
  }),
);
