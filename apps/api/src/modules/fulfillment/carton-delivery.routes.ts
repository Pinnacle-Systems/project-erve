import express, { Router, type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import { FACTORY_DISPATCH_VIEW_ROLES, ERVE_DISPATCH_VIEW_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../errors/http-error.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { deliveryInputSchema } from './carton-delivery.security.js';
import type { createCartonDeliveryService } from './carton-delivery.service.js';

type Service = ReturnType<typeof createCartonDeliveryService>;
const empty = z.object({}).strict();
const reason = z.string().trim().min(1).max(1000);
const expectedTokenId = z.string().min(1).max(80);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('revoke'), reason, expectedTokenId }).strict(),
  z
    .object({
      action: z.literal('extend'),
      reason,
      expectedTokenId,
      extendedUntil: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal('reissue'),
      reason,
      expectedTokenId: expectedTokenId.nullable(),
      acknowledgeReplacement: z.literal(true),
    })
    .strict(),
]);
const pageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(80).optional(),
  })
  .strict();

export function createPublicCartonDeliveryRouter(service: Service, publicOrigin: string) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    next();
  });
  router.use((req, _res, next) => {
    if (Object.keys(req.query).length) return next(HttpError.badRequest('Invalid public request'));
    if (req.get('Origin') && req.get('Origin') !== publicOrigin)
      return next(HttpError.forbidden('Origin is not allowed'));
    next();
  });
  router.use(
    cors({
      origin: publicOrigin || false,
      credentials: false,
      methods: ['POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Carton-Delivery-Token'],
      maxAge: 600,
    }),
  );
  // Before JSON parsing, so malformed/oversized traffic also consumes its IP budget.
  router.use(
    asyncHandler(async (req, _res, next) => {
      const raw = req.get('X-Carton-Delivery-Token') ?? '';
      await service.rateLimit(
        req.ip ?? 'unknown',
        raw.slice(0, 128),
        req.path === '/confirm' ? 'confirm' : 'resolve',
      );
      if (!/^[A-Za-z0-9_-]{43}$/.test(raw))
        throw HttpError.notFound('Carton delivery link is unavailable');
      next();
    }),
  );
  router.use(express.json({ limit: '12kb', strict: true }));
  router.post(
    '/resolve',
    asyncHandler(async (req, res) => {
      empty.parse(req.body);
      res.json(successResponse(await service.resolve(req.get('X-Carton-Delivery-Token')!)));
    }),
  );
  router.post(
    '/confirm',
    asyncHandler(async (req, res) => {
      res.json(
        successResponse(
          await service.confirm(
            req.get('X-Carton-Delivery-Token')!,
            deliveryInputSchema.parse(req.body),
          ),
        ),
      );
    }),
  );
  // Do not send SQL/crypto/parser exceptions to the general logger: they may carry secrets.
  const publicError: ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpError
          ? error.statusCode
          : [400, 413, 429].includes(error?.statusCode ?? error?.status)
            ? ((error.statusCode ?? error.status) as number)
            : 500;
    if (status === 429) res.set('Retry-After', '60');
    const code =
      status === 429
        ? 'RATE_LIMITED'
        : status === 409
          ? 'CONFLICT'
          : status === 400
            ? 'VALIDATION_ERROR'
            : 'DELIVERY_UNAVAILABLE';
    const message =
      status === 400
        ? 'Check the delivery fields, timezone and confirmation'
        : status === 409
          ? error instanceof HttpError
            ? error.message
            : 'This carton cannot accept this submission'
          : status === 429
            ? 'Please wait before trying again'
            : 'Carton delivery link is unavailable';
    res.status(status).json(errorResponse(code, message));
  };
  router.use(publicError);
  return router;
}

export function createCartonDeliveryRouter(service: Service) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  router.use(requireAuth);
  router.post(
    '/labels/:cartonId/prepare',
    requireRoles(...FACTORY_DISPATCH_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      const input = z
        .object({ expectedVersion: z.number().int().positive() })
        .strict()
        .parse(req.body);
      res.json(
        successResponse(
          await service.prepareLabel(
            req.user!,
            req.params.cartonId as string,
            input.expectedVersion,
          ),
        ),
      );
    }),
  );
  router.post(
    '/credentials/:cartonId',
    requireRoles('ADMIN', 'MERCHANDISER'),
    asyncHandler(async (req, res) => {
      res.json(
        successResponse(
          await service.manage(
            req.user!,
            req.params.cartonId as string,
            actionSchema.parse(req.body),
          ),
        ),
      );
    }),
  );
  router.get(
    '/dispatches/:dispatchId',
    requireRoles(...ERVE_DISPATCH_VIEW_ROLES),
    asyncHandler(async (req, res) => {
      res.json(
        successResponse(
          await service.summary(
            req.user!,
            req.params.dispatchId as string,
            pageSchema.parse(req.query),
          ),
        ),
      );
    }),
  );
  return router;
}
