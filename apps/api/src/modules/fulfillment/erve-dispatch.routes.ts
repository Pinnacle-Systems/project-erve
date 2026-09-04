import { Router } from 'express';
import { ERVE_DISPATCH_MUTATION_ROLES, ERVE_DISPATCH_VIEW_ROLES, ERVE_PACKING_LIST_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  confirmErveDispatchDeliverySchema,
  createErvePackingListSchema,
  listErveDispatchesQuerySchema,
  listErvePackingListsQuerySchema,
  recordErveDispatchSchema,
  updateErveDispatchLrSchema,
} from './erve-dispatch.validation.js';
import * as erveDispatchService from './erve-dispatch.service.js';

export const ervePackingListsRouter = Router();
ervePackingListsRouter.use(requireAuth);

const canViewPackingLists = requireRoles(...ERVE_PACKING_LIST_VIEW_ROLES);
const canMutatePackingLists = requireRoles(...ERVE_DISPATCH_MUTATION_ROLES);

ervePackingListsRouter.get(
  '/',
  canViewPackingLists,
  asyncHandler(async (req, res) => {
    const filters = listErvePackingListsQuerySchema.parse(req.query);
    const result = await erveDispatchService.getErvePackingListList(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

ervePackingListsRouter.post(
  '/',
  canMutatePackingLists,
  asyncHandler(async (req, res) => {
    const input = createErvePackingListSchema.parse(req.body);
    const packingList = await erveDispatchService.createErvePackingList(req.user!, input);
    res.status(201).json(successResponse(packingList));
  }),
);

ervePackingListsRouter.get(
  '/:id',
  canViewPackingLists,
  asyncHandler(async (req, res) => {
    const packingList = await erveDispatchService.getErvePackingListDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(packingList));
  }),
);

export const erveDispatchesRouter = Router();
erveDispatchesRouter.use(requireAuth);

const canViewDispatches = requireRoles(...ERVE_DISPATCH_VIEW_ROLES);
const canMutateDispatches = requireRoles(...ERVE_DISPATCH_MUTATION_ROLES);

erveDispatchesRouter.get(
  '/',
  canViewDispatches,
  asyncHandler(async (req, res) => {
    const filters = listErveDispatchesQuerySchema.parse(req.query);
    const result = await erveDispatchService.getErveDispatchList(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

erveDispatchesRouter.post(
  '/',
  canMutateDispatches,
  asyncHandler(async (req, res) => {
    const input = recordErveDispatchSchema.parse(req.body);
    const dispatch = await erveDispatchService.recordErveDispatch(req.user!, input);
    res.status(201).json(successResponse(dispatch));
  }),
);

erveDispatchesRouter.get(
  '/:id',
  canViewDispatches,
  asyncHandler(async (req, res) => {
    const dispatch = await erveDispatchService.getErveDispatchDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(dispatch));
  }),
);

erveDispatchesRouter.patch(
  '/:id/lr',
  canMutateDispatches,
  asyncHandler(async (req, res) => {
    const input = updateErveDispatchLrSchema.parse(req.body);
    const dispatch = await erveDispatchService.updateErveDispatchLr(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);

erveDispatchesRouter.patch(
  '/:id/delivery',
  canMutateDispatches,
  asyncHandler(async (req, res) => {
    const input = confirmErveDispatchDeliverySchema.parse(req.body);
    const dispatch = await erveDispatchService.confirmErveDispatchDelivery(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);
