import { Router } from 'express';
import type { HealthCheckResponse } from '@erve/types';
import { successResponse } from '@erve/shared';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const payload: HealthCheckResponse = {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(successResponse(payload));
});
