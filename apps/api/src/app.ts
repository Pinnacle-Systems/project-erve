import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { HealthCheckResponse, ReadyCheckResponse } from '@erve/types';
import { corsOptions } from './config/cors.js';
import { asyncHandler } from './middleware/async-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { successResponse, errorResponse } from './utils/response.js';
import { prisma } from './db/prisma.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import {
  distributorsRouter,
  factoriesRouter,
  processFlowsRouter,
  processFlowVersionsRouter,
  sizesRouter,
  stylesRouter,
} from './modules/master-data/master-data.routes.js';
import { priceListsRouter } from './modules/price-lists/price-lists.routes.js';
import { purchaseOrdersRouter } from './modules/purchase-orders/purchase-orders.routes.js';
import { jobOrdersRouter } from './modules/job-orders/job-orders.routes.js';

const READY_CHECK_TIMEOUT_MS = 2000;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Readiness check timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function createApp() {
  const app = express();

  // Exactly one hop of trust: the local CloudPanel-managed Nginx reverse
  // proxy in front of this process. This lets Express derive req.ip /
  // req.protocol from the first (nearest) X-Forwarded-* entry instead of
  // trusting arbitrary client-supplied values (which `true` would do).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors(corsOptions));
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

  app.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      try {
        await withTimeout(prisma.$queryRaw`SELECT 1`, READY_CHECK_TIMEOUT_MS);
        const payload: ReadyCheckResponse = { status: 'ok', timestamp: new Date().toISOString() };
        res.status(200).json(successResponse(payload));
      } catch {
        const payload: ReadyCheckResponse = { status: 'error', timestamp: new Date().toISOString() };
        res.status(503).json(errorResponse('NOT_READY', 'Database is not reachable', payload));
      }
    }),
  );

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/styles', stylesRouter);
  app.use('/sizes', sizesRouter);
  app.use('/factories', factoriesRouter);
  app.use('/distributors', distributorsRouter);
  app.use('/process-flows', processFlowsRouter);
  app.use('/process-flow-versions', processFlowVersionsRouter);
  app.use('/price-lists', priceListsRouter);
  app.use('/purchase-orders', purchaseOrdersRouter);
  app.use('/job-orders', jobOrdersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
