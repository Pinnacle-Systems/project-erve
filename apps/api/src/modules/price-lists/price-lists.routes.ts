import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createPriceListLineSchema,
  createPriceListSchema,
  listPriceListsQuerySchema,
  priceLookupQuerySchema,
  updatePriceListLineSchema,
  updatePriceListSchema,
} from './price-lists.validation.js';
import * as priceListsService from './price-lists.service.js';

export const priceListsRouter = Router();
priceListsRouter.use(requireAuth);

// Mutations follow the seeded role charter ("MERCHANDISER: manages styles,
// price lists, and process flows") plus ADMIN. Reads are limited to roles
// that genuinely need distributor pricing; DISTRIBUTOR users are further
// scoped to their own distributor's ACTIVE lists in the service layer.
const canManagePriceLists = requireRoles('ADMIN', 'MERCHANDISER');
const canViewPriceLists = requireRoles(
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'ACCOUNTANT',
  'DISTRIBUTOR',
);

priceListsRouter.get(
  '/',
  canViewPriceLists,
  asyncHandler(async (req, res) => {
    const filters = listPriceListsQuerySchema.parse(req.query);
    const priceLists = await priceListsService.listPriceLists(req.user!, filters);
    res.status(200).json(successResponse(priceLists));
  }),
);

priceListsRouter.post(
  '/',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const input = createPriceListSchema.parse(req.body);
    const priceList = await priceListsService.createPriceList(req.user!, input);
    res.status(201).json(successResponse(priceList));
  }),
);

// Registered before '/:id' so 'lookup' is never captured as a price-list id.
priceListsRouter.get(
  '/lookup',
  canViewPriceLists,
  asyncHandler(async (req, res) => {
    const input = priceLookupQuerySchema.parse(req.query);
    const result = await priceListsService.lookupPriceForActor(req.user!, input);
    res.status(200).json(successResponse(result));
  }),
);

priceListsRouter.get(
  '/distributors/:distributorId/history',
  canViewPriceLists,
  asyncHandler(async (req, res) => {
    const history = await priceListsService.getDistributorPriceListHistory(
      req.user!,
      req.params.distributorId! as string,
    );
    res.status(200).json(successResponse(history));
  }),
);

priceListsRouter.get(
  '/:id',
  canViewPriceLists,
  asyncHandler(async (req, res) => {
    const priceList = await priceListsService.getPriceListDetail(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(priceList));
  }),
);

priceListsRouter.patch(
  '/:id',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const input = updatePriceListSchema.parse(req.body);
    const priceList = await priceListsService.updatePriceListDraft(
      req.user!,
      req.params.id! as string,
      input,
    );
    res.status(200).json(successResponse(priceList));
  }),
);

priceListsRouter.post(
  '/:id/lines',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const input = createPriceListLineSchema.parse(req.body);
    const priceList = await priceListsService.addPriceListLine(req.user!, req.params.id! as string, input);
    res.status(201).json(successResponse(priceList));
  }),
);

priceListsRouter.patch(
  '/:id/lines/:lineId',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const input = updatePriceListLineSchema.parse(req.body);
    const priceList = await priceListsService.updatePriceListLine(
      req.user!,
      req.params.id! as string,
      req.params.lineId! as string,
      input,
    );
    res.status(200).json(successResponse(priceList));
  }),
);

priceListsRouter.delete(
  '/:id/lines/:lineId',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const priceList = await priceListsService.removePriceListLine(
      req.user!,
      req.params.id! as string,
      req.params.lineId! as string,
    );
    res.status(200).json(successResponse(priceList));
  }),
);

priceListsRouter.post(
  '/:id/actions/activate',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const priceList = await priceListsService.activatePriceList(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(priceList));
  }),
);

priceListsRouter.post(
  '/:id/actions/retire',
  canManagePriceLists,
  asyncHandler(async (req, res) => {
    const priceList = await priceListsService.retirePriceList(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(priceList));
  }),
);
