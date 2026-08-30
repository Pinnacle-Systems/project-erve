import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { singleImageUpload } from '../../middleware/image-upload.js';
import { HttpError } from '../../errors/http-error.js';
import { successResponse } from '../../utils/response.js';
import * as service from './quality-executions.service.js';
import {
  attachmentParamsSchema,
  finalBatchActionSchema,
  finalBatchReworkActionSchema,
  finalBatchReworkCompleteSchema,
  qualityExecutionPayloadSchema,
} from './quality-executions.validation.js';

export const qualityExecutionsRouter = Router();
qualityExecutionsRouter.use(requireAuth);
qualityExecutionsRouter.get(
  '/:id',
  requireRoles('ADMIN', 'QA_USER', 'MERCHANDISER', 'SENIOR_MANAGEMENT'),
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.get(req.user!, req.params.id! as string))),
  ),
);
qualityExecutionsRouter.put(
  '/:id',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.saveDraft(
          req.user!,
          req.params.id! as string,
          qualityExecutionPayloadSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.post(
  '/:id/finalize',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.finalize(
          req.user!,
          req.params.id! as string,
          qualityExecutionPayloadSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.get(
  '/final-batches/:batchId',
  requireRoles('ADMIN', 'QA_USER', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(await service.getFinalBatch(req.user!, req.params.batchId! as string)),
    ),
  ),
);
qualityExecutionsRouter.post(
  '/final-batches/:batchId/reinspect',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) => {
    const execution = await service.startFinalBatchReinspection(
      req.user!,
      req.params.batchId! as string,
    );
    res.status(201).json(successResponse(execution));
  }),
);
qualityExecutionsRouter.post(
  '/final-batches/:batchId/cancel',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.cancelFinalBatch(
          req.user!,
          req.params.batchId! as string,
          finalBatchActionSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.post(
  '/final-batches/:batchId/permanently-reject',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.permanentlyRejectFinalBatch(
          req.user!,
          req.params.batchId! as string,
          finalBatchActionSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.post(
  '/final-batches/:batchId/rework/acknowledge',
  requireRoles('ADMIN', 'FACTORY_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.acknowledgeFinalBatchRework(
          req.user!,
          req.params.batchId! as string,
          finalBatchReworkActionSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.post(
  '/final-batches/:batchId/rework/start',
  requireRoles('ADMIN', 'FACTORY_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.startFinalBatchRework(
          req.user!,
          req.params.batchId! as string,
          finalBatchReworkActionSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.post(
  '/final-batches/:batchId/rework/complete',
  requireRoles('ADMIN', 'FACTORY_USER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.completeFinalBatchRework(
          req.user!,
          req.params.batchId! as string,
          finalBatchReworkCompleteSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityExecutionsRouter.get(
  '/attachments/:attachmentId/content',
  requireRoles('ADMIN', 'QA_USER', 'MERCHANDISER', 'SENIOR_MANAGEMENT'),
  asyncHandler(async (req, res) => {
    const file = await service.readAttachment(req.user!, req.params.attachmentId! as string);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/["\r\n]/g, '_')}"`,
    );
    res.send(file.data);
  }),
);
qualityExecutionsRouter.delete(
  '/attachments/:attachmentId',
  requireRoles('ADMIN', 'QA_USER'),
  asyncHandler(async (req, res) => {
    await service.deleteAttachment(req.user!, req.params.attachmentId! as string);
    res.status(204).send();
  }),
);
qualityExecutionsRouter.post(
  '/:id/attachments',
  requireRoles('ADMIN', 'QA_USER'),
  singleImageUpload('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw HttpError.badRequest('An image is required');
    const params = attachmentParamsSchema.parse(req.body);
    const result = await service.uploadAttachment(
      req.user!,
      req.params.id! as string,
      params.componentId,
      params.requirementKey,
      { buffer: req.file.buffer, originalName: req.file.originalname },
    );
    res.status(result.created ? 201 : 200).json(successResponse(result.attachment));
  }),
);
