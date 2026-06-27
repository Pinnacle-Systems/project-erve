import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { loginSchema } from './auth.validation.js';
import { getMe, login } from './auth.service.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const result = await login(identifier, password);
    res.status(200).json(successResponse(result));
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = await getMe(req.user!.id);
    res.status(200).json(successResponse(me));
  }),
);
