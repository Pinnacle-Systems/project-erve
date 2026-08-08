import { Router } from 'express';
import { QA_OPERATION_ROLES } from '@erve/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { HttpError } from '../../errors/http-error.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { singleImageUpload } from '../../middleware/image-upload.js';
import { successResponse } from '../../utils/response.js';
import * as evidenceService from './qa-evidence.service.js';
import * as service from './qa.service.js';
import {
  qaQueueQuerySchema,
  reopenSchema,
  reworkActionSchema,
  saveSizeInspectionFormSchema,
  startInspectionSchema,
  versionSchema,
} from './qa.validation.js';

export const qaRouter = Router();
qaRouter.use(requireAuth);
const canView = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'QA_USER');
const canInspect = requireRoles(...QA_OPERATION_ROLES, 'MERCHANDISER');
const canRework = requireRoles('ADMIN', 'MERCHANDISER', 'FACTORY_USER');
function key(req: { get(name: string): string | undefined }) {
  const value = req.get('Idempotency-Key')?.trim();
  if (!value || value.length > 200)
    throw HttpError.badRequest(
      'Idempotency-Key header is required and must be at most 200 characters',
    );
  return value;
}

qaRouter.get(
  '/queue',
  canView,
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(await service.getQueue(req.user!, qaQueueQuerySchema.parse(req.query))),
    ),
  ),
);
qaRouter.get(
  '/job-orders/:id',
  canView,
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.getDetail(req.user!, req.params.id! as string))),
  ),
);
qaRouter.post(
  '/job-orders/:id/inspections',
  canInspect,
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        successResponse(
          await service.startInspection(
            req.user!,
            req.params.id! as string,
            startInspectionSchema.parse(req.body),
            key(req),
          ),
        ),
      ),
  ),
);
qaRouter.put(
  '/inspections/:sessionId/forms/:formId',
  canInspect,
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.saveSizeInspectionForm(
      req.user!, req.params.sessionId! as string, req.params.formId! as string,
      saveSizeInspectionFormSchema.parse(req.body), key(req),
    ))),
  ),
);
qaRouter.post(
  '/inspections/:sessionId/forms/:formId/finalize',
  canInspect,
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.finalizeSizeInspectionForm(
      req.user!, req.params.sessionId! as string, req.params.formId! as string,
      versionSchema.parse(req.body), key(req),
    ))),
  ),
);
qaRouter.post(
  '/job-orders/:id/approve',
  canInspect,
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.approve(
          req.user!,
          req.params.id! as string,
          versionSchema.parse(req.body),
          key(req),
        ),
      ),
    ),
  ),
);
qaRouter.post(
  '/inspections/:sessionId/forms/:formId/reopen',
  requireRoles('ADMIN', 'MERCHANDISER'),
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.reopenSizeInspectionForm(
          req.user!,
          req.params.sessionId! as string,
          req.params.formId! as string,
          reopenSchema.parse(req.body),
          key(req),
        ),
      ),
    ),
  ),
);
qaRouter.get(
  '/rework',
  canRework,
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.getFactoryReworkQueue(req.user!))),
  ),
);
qaRouter.post(
  '/rework/:id/acknowledge',
  canRework,
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.updateRework(
          req.user!,
          req.params.id! as string,
          'ACKNOWLEDGE',
          reworkActionSchema.parse(req.body),
          key(req),
        ),
      ),
    ),
  ),
);
qaRouter.post(
  '/rework/:id/ready',
  canRework,
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.updateRework(
          req.user!,
          req.params.id! as string,
          'READY',
          reworkActionSchema.parse(req.body),
          key(req),
        ),
      ),
    ),
  ),
);
qaRouter.post(
  '/inspections/:id/evidence',
  canInspect,
  singleImageUpload('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw HttpError.badRequest('Image is required');
    const outcome = await evidenceService.uploadEvidence(
      req.user!,
      req.params.id! as string,
      typeof req.body.inspectionLineId === 'string' ? req.body.inspectionLineId : undefined,
      { buffer: req.file.buffer, originalName: req.file.originalname },
    );
    res.status(outcome.created ? 201 : 200).json(successResponse(outcome.evidence));
  }),
);
qaRouter.get(
  '/evidence/:id/content',
  requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'QA_USER', 'FACTORY_USER'),
  asyncHandler(async (req, res) => {
    const file = await evidenceService.readEvidence(req.user!, req.params.id! as string);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/["\\]/g, '')}"`,
    );
    res.setHeader('ETag', file.etag);
    res.send(file.data);
  }),
);
qaRouter.delete(
  '/evidence/:id',
  canInspect,
  asyncHandler(async (req, res) => {
    await evidenceService.deleteEvidence(req.user!, req.params.id! as string);
    res.status(204).end();
  }),
);
