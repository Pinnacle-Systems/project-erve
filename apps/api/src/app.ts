import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { HealthCheckResponse } from '@erve/types';
import { env } from './config/env.js';
import { asyncHandler } from './middleware/async-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { successResponse } from './utils/response.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(requestLogger);

  app.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const payload: HealthCheckResponse = {
        status: 'ok',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(successResponse(payload));
    }),
  );

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
