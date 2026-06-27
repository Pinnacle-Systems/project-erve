import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  assignRoleSchema,
  createUserSchema,
  distributorMappingSchema,
  factoryMappingSchema,
  roleNameSchema,
  updateStatusSchema,
} from './users.validation.js';
import * as usersService from './users.service.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRoles('ADMIN'));

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await usersService.createUser(req.user!, input);
    res.status(201).json(successResponse(user));
  }),
);

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await usersService.listUsers();
    res.status(200).json(successResponse(users));
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await usersService.getUserById(req.params.id!);
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = updateStatusSchema.parse(req.body);
    const user = await usersService.updateUserStatus(req.user!, req.params.id!, status);
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.post(
  '/:id/roles',
  asyncHandler(async (req, res) => {
    const { roleName } = assignRoleSchema.parse(req.body);
    const user = await usersService.assignRole(req.user!, req.params.id!, roleName);
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.delete(
  '/:id/roles/:roleName',
  asyncHandler(async (req, res) => {
    const roleName = roleNameSchema.parse(req.params.roleName);
    const user = await usersService.removeRole(req.user!, req.params.id!, roleName);
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.post(
  '/:id/distributors',
  asyncHandler(async (req, res) => {
    const { distributorId } = distributorMappingSchema.parse(req.body);
    const user = await usersService.addDistributorMapping(req.user!, req.params.id!, distributorId);
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.delete(
  '/:id/distributors/:distributorId',
  asyncHandler(async (req, res) => {
    const user = await usersService.removeDistributorMapping(
      req.user!,
      req.params.id!,
      req.params.distributorId!,
    );
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.post(
  '/:id/factories',
  asyncHandler(async (req, res) => {
    const { factoryId } = factoryMappingSchema.parse(req.body);
    const user = await usersService.addFactoryMapping(req.user!, req.params.id!, factoryId);
    res.status(200).json(successResponse(user));
  }),
);

usersRouter.delete(
  '/:id/factories/:factoryId',
  asyncHandler(async (req, res) => {
    const user = await usersService.removeFactoryMapping(
      req.user!,
      req.params.id!,
      req.params.factoryId!,
    );
    res.status(200).json(successResponse(user));
  }),
);
