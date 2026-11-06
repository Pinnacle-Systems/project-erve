import { Router } from 'express';
import { ERVE_DISPATCH_MUTATION_ROLES, ERVE_DISPATCH_VIEW_ROLES, ERVE_PACKING_LIST_VIEW_ROLES } from '@erve/shared';
import { ERVE_DISPATCH_TRANSPORT_ROLES, ERVE_DISPATCH_ASSIGNMENT_ROLES, ERVE_DISPATCH_DELIVERY_ROLES, ERVE_DISPATCH_DISTRIBUTOR_RECEIPT_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  addErvePackingListCartonsSchema,
  confirmErveDispatchDeliverySchema,
  submitDistributorReceiptSchema,
  createErvePackingListSchema,
  listEligibleCartonsQuerySchema,
  listErveDispatchesQuerySchema,
  listErvePackingListsQuerySchema,
  recordErveDispatchSchema,
  updateErveDispatchLrSchema,
  transporterAssignmentSchema,
  assignedTransportQuerySchema,
  transporterOptionsQuerySchema,
} from './erve-dispatch.validation.js';
import * as erveDispatchService from './erve-dispatch.service.js';
import * as transportService from './erve-dispatch-transport.service.js';
import * as distributorReceiptService from './erve-dispatch-distributor-receipt.service.js';
import { HttpError } from '../../errors/http-error.js';

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

ervePackingListsRouter.get(
  '/eligible-cartons',
  canMutatePackingLists,
  asyncHandler(async (req, res) => {
    const filters = listEligibleCartonsQuerySchema.parse(req.query);
    const result = await erveDispatchService.getEligibleErveCartons(req.user!, filters);
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

ervePackingListsRouter.post(
  '/:id/cartons',
  canMutatePackingLists,
  asyncHandler(async (req, res) => {
    const input = addErvePackingListCartonsSchema.parse(req.body);
    const packingList = await erveDispatchService.addErvePackingListCartons(req.user!, req.params.id! as string, input.cartonIds);
    res.status(200).json(successResponse(packingList));
  }),
);

ervePackingListsRouter.delete(
  '/:id/cartons/:cartonId',
  canMutatePackingLists,
  asyncHandler(async (req, res) => {
    const packingList = await erveDispatchService.removeErvePackingListCarton(req.user!, req.params.id! as string, req.params.cartonId! as string);
    res.status(200).json(successResponse(packingList));
  }),
);

ervePackingListsRouter.post(
  '/:id/finalize',
  canMutatePackingLists,
  asyncHandler(async (req, res) => {
    const packingList = await erveDispatchService.finalizeErvePackingList(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(packingList));
  }),
);

export const erveDispatchesRouter = Router();
erveDispatchesRouter.use(requireAuth);

const canViewDispatches = requireRoles(...ERVE_DISPATCH_VIEW_ROLES);
const canMutateDispatches = requireRoles(...ERVE_DISPATCH_MUTATION_ROLES);

erveDispatchesRouter.get('/assigned-transport', requireRoles('TRANSPORTER'), asyncHandler(async (req, res) => {
  res.json(successResponse(await transportService.listAssignedTransport(req.user!, assignedTransportQuerySchema.parse(req.query))));
}));

erveDispatchesRouter.get('/transporter-options', requireRoles(...ERVE_DISPATCH_ASSIGNMENT_ROLES), asyncHandler(async (req, res) => {
  res.json(successResponse(await transportService.listTransporterOptions(req.user!, transporterOptionsQuerySchema.parse(req.query))));
}));

erveDispatchesRouter.get('/:id/transport', requireRoles(...ERVE_DISPATCH_TRANSPORT_ROLES), asyncHandler(async (req, res) => {
  res.json(successResponse(await transportService.getDispatchTransport(req.user!, req.params.id as string)));
}));

erveDispatchesRouter.patch('/:id/transporter-assignment', requireRoles(...ERVE_DISPATCH_ASSIGNMENT_ROLES), asyncHandler(async (req, res) => {
  res.json(successResponse(await transportService.assignDispatchTransporter(req.user!, req.params.id as string, transporterAssignmentSchema.parse(req.body))));
}));

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
  requireRoles(...ERVE_DISPATCH_TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const input = updateErveDispatchLrSchema.parse(req.body);
    const dispatch = await erveDispatchService.updateErveDispatchLr(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);

erveDispatchesRouter.patch(
  '/:id/delivery',
  requireRoles(...ERVE_DISPATCH_DELIVERY_ROLES),
  asyncHandler(async (req, res) => {
    const input = confirmErveDispatchDeliverySchema.parse(req.body);
    const dispatch = await erveDispatchService.confirmErveDispatchDelivery(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(dispatch));
  }),
);

erveDispatchesRouter.post(
  '/:id/distributor-receipt',
  requireRoles(...ERVE_DISPATCH_DISTRIBUTOR_RECEIPT_ROLES),
  asyncHandler(async (req, res) => {
    const key = req.get('Idempotency-Key')?.trim();
    if (!key || key.length > 200) {
      throw HttpError.badRequest('Idempotency-Key header is required and must be at most 200 characters');
    }
    const input = submitDistributorReceiptSchema.parse(req.body);
    const id = req.params.id! as string;
    const { replayed } = await distributorReceiptService.submitDistributorReceipt(req.user!, id, input, key);
    const dispatch = await erveDispatchService.getErveDispatchDetail(req.user!, id);
    res.status(replayed ? 200 : 201).json(successResponse(dispatch));
  }),
);
