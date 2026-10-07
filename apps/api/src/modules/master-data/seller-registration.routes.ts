import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createSellerRegistrationSchema,
  listSellerRegistrationsQuerySchema,
  sellerRegistrationOptionsQuerySchema,
  updateSellerRegistrationSchema,
  updateSellerRegistrationStatusSchema,
} from './seller-registration.validation.js';
import * as sellerRegistrationService from './seller-registration.service.js';

// ERVE's own GST/legal/bank identity is statutory document master data — the
// story intentionally keeps this ADMIN-only (tighter than the usual
// ADMIN+MERCHANDISER master-maintenance gate) rather than widening access
// just because invoice users may eventually need to read it. Read access
// can be broadened in a later invoice story, with its own justification.
const canManageSellerRegistrations = requireRoles('ADMIN');
const canViewSellerRegistrations = requireRoles('ADMIN');

export const sellerRegistrationsRouter = Router();

sellerRegistrationsRouter.use(requireAuth);

sellerRegistrationsRouter.get(
  '/',
  canViewSellerRegistrations,
  asyncHandler(async (req, res) => {
    const filters = listSellerRegistrationsQuerySchema.parse(req.query);
    const registrations = await sellerRegistrationService.listSellerRegistrations(filters);
    res.status(200).json(successResponse(registrations));
  }),
);

// Registered before '/:id' so 'options' isn't read as a registration id —
// a bounded ACTIVE-only search for future invoice-side selectors.
sellerRegistrationsRouter.get(
  '/options',
  canViewSellerRegistrations,
  asyncHandler(async (req, res) => {
    const filters = sellerRegistrationOptionsQuerySchema.parse(req.query);
    const options = await sellerRegistrationService.listSellerRegistrationOptions(filters);
    res.status(200).json(successResponse(options));
  }),
);

sellerRegistrationsRouter.post(
  '/',
  canManageSellerRegistrations,
  asyncHandler(async (req, res) => {
    const input = createSellerRegistrationSchema.parse(req.body);
    const registration = await sellerRegistrationService.createSellerRegistration(req.user!, input);
    res.status(201).json(successResponse(registration));
  }),
);

sellerRegistrationsRouter.get(
  '/:id',
  canViewSellerRegistrations,
  asyncHandler(async (req, res) => {
    const registration = await sellerRegistrationService.getSellerRegistrationById(
      req.params.id! as string,
    );
    res.status(200).json(successResponse(registration));
  }),
);

sellerRegistrationsRouter.patch(
  '/:id',
  canManageSellerRegistrations,
  asyncHandler(async (req, res) => {
    const input = updateSellerRegistrationSchema.parse(req.body);
    const registration = await sellerRegistrationService.updateSellerRegistration(
      req.user!,
      req.params.id! as string,
      input,
    );
    res.status(200).json(successResponse(registration));
  }),
);

sellerRegistrationsRouter.patch(
  '/:id/status',
  canManageSellerRegistrations,
  asyncHandler(async (req, res) => {
    const { status } = updateSellerRegistrationStatusSchema.parse(req.body);
    const registration = await sellerRegistrationService.updateSellerRegistrationStatus(
      req.user!,
      req.params.id! as string,
      status,
    );
    res.status(200).json(successResponse(registration));
  }),
);
