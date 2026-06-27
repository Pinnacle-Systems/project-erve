import { Router } from 'express';
import { z } from 'zod';
import { errorResponse } from '../utils/response.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Placeholder only: request validation + route wiring are in place,
// credential verification and token issuance land with the auth feature.
authRouter.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res
      .status(400)
      .json(errorResponse('VALIDATION_ERROR', 'Invalid request data', parsed.error.flatten()));
    return;
  }

  res.status(501).json(errorResponse('NOT_IMPLEMENTED', 'Login is not implemented yet'));
});
