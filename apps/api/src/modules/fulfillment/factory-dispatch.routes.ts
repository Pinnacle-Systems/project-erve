import { Router } from 'express';
import { FACTORY_DISPATCH_MUTATION_ROLES, FACTORY_DISPATCH_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  addFactoryDispatchLinesSchema,
  createCartonSchema,
  createFactoryDispatchSchema,
  listFactoryDispatchesQuerySchema,
  packingQueueQuerySchema,
  versionedActionSchema,
} from './factory-dispatch.validation.js';
import * as factoryDispatchService from './factory-dispatch.service.js';

export const factoryDispatchesRouter = Router();
factoryDispatchesRouter.use(requireAuth);

const canView = requireRoles(...FACTORY_DISPATCH_VIEW_ROLES);
const canMutate = requireRoles(...FACTORY_DISPATCH_MUTATION_ROLES);

// Static routes must be registered before `/:id`.
factoryDispatchesRouter.get(
  '/packing-queue',
  canView,
  asyncHandler(async (req, res) => {
    const query = packingQueueQuerySchema.parse(req.query);
    const queue = await factoryDispatchService.getFactoryPackingQueue(req.user!, query.factoryId);
    res.status(200).json(successResponse(queue));
  }),
);

factoryDispatchesRouter.get(
  '/',
  canView,
  asyncHandler(async (req, res) => {
    const filters = listFactoryDispatchesQuerySchema.parse(req.query);
    const result = await factoryDispatchService.getFactoryDispatchList(req.user!, filters);
    res.status(200).json(successResponse(result));
  }),
);

factoryDispatchesRouter.post(
  '/',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = createFactoryDispatchSchema.parse(req.body);
    const dispatch = await factoryDispatchService.createFactoryDispatch(req.user!, input);
    res.status(201).json(successResponse(dispatch));
  }),
);

factoryDispatchesRouter.get(
  '/:id',
  canView,
  asyncHandler(async (req, res) => {
    const dispatch = await factoryDispatchService.getFactoryDispatchDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(dispatch));
  }),
);

factoryDispatchesRouter.delete(
  '/:id',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    await factoryDispatchService.deleteFactoryDispatch(req.user!, req.params.id! as string, input);
    res.status(204).send();
  }),
);

factoryDispatchesRouter.post(
  '/:id/lines',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = addFactoryDispatchLinesSchema.parse(req.body);
    const dispatch = await factoryDispatchService.addFactoryDispatchLines(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);

factoryDispatchesRouter.delete(
  '/:id/lines/:lineId',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const dispatch = await factoryDispatchService.removeFactoryDispatchLine(
      req.user!,
      req.params.id! as string,
      req.params.lineId! as string,
      input,
    );
    res.status(200).json(successResponse(dispatch));
  }),
);

factoryDispatchesRouter.post(
  '/:id/cartons',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = createCartonSchema.parse(req.body);
    const dispatch = await factoryDispatchService.addFactoryPackingCarton(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);

factoryDispatchesRouter.delete(
  '/:id/cartons/:cartonId',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const dispatch = await factoryDispatchService.removeFactoryPackingCarton(
      req.user!,
      req.params.id! as string,
      req.params.cartonId! as string,
      input,
    );
    res.status(200).json(successResponse(dispatch));
  }),
);

factoryDispatchesRouter.post(
  '/:id/actions/finalize',
  canMutate,
  asyncHandler(async (req, res) => {
    const input = versionedActionSchema.parse(req.body);
    const dispatch = await factoryDispatchService.finalizeFactoryDispatch(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);
