import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/auth.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import type { GstinVerificationService } from './gstin-verification.service.js';

const sourceType = z.enum(['DISTRIBUTOR', 'SELLER_REGISTRATION', 'RETAIL_STORE', 'DISPATCH_ORDER']);
const targetSchema = z
  .object({
    gstin: z.string().trim().min(1).max(30),
    source: z
      .object({ type: sourceType, id: z.string().min(1).max(100) })
      .strict()
      .optional(),
  })
  .strict();
const readSchema = z
  .object({
    gstin: z.string().trim().min(1).max(30),
    sourceType: sourceType.optional(),
    sourceId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => !!v.sourceType === !!v.sourceId, 'Source type and id must be supplied together');

export function createGstinVerificationRouter(service: GstinVerificationService) {
  const router = Router();
  router.use(requireAuth);
  router.get(
    '/policy',
    asyncHandler(async (req, res) => {
      res.json(successResponse(await service.policy(req.user!)));
    }),
  );
  for (const history of [false, true])
    router.get(
      history ? '/history' : '/',
      asyncHandler(async (req, res) => {
        const input = readSchema.parse(req.query);
        const target = {
          gstin: input.gstin,
          ...(input.sourceType && input.sourceId
            ? { source: { type: input.sourceType, id: input.sourceId } }
            : {}),
        };
        res.json(
          successResponse(
            await (history ? service.history(req.user!, target) : service.read(req.user!, target)),
          ),
        );
      }),
    );
  router.post(
    '/prepare',
    asyncHandler(async (req, res) => {
      const input = z
        .object({ target: targetSchema, refresh: z.boolean().default(false) })
        .strict()
        .parse(req.body);
      res.json(successResponse(await service.prepare(req.user!, input.target, input.refresh)));
    }),
  );
  router.post(
    '/execute',
    asyncHandler(async (req, res) => {
      const input = z.object({ intentId: z.uuid() }).strict().parse(req.body);
      res.json(successResponse(await service.execute(req.user!, input.intentId)));
    }),
  );
  return router;
}
