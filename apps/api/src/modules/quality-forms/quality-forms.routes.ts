import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import { HttpError } from '../../errors/http-error.js';
import * as service from './quality-forms.service.js';
import {
  createQualityFormSchema,
  createQualityFormVersionSchema,
  listQualityFormsQuerySchema,
  qualityFormDefinitionSchema,
  replaceQualityFormDefinitionSchema,
  updateQualityFormSchema,
  updateQualityFormStatusSchema,
} from './quality-forms.validation.js';

export const qualityFormsRouter = Router();
export const qualityFormVersionsRouter = Router();
const canManage = requireRoles('ADMIN', 'MERCHANDISER');
qualityFormsRouter.use(requireAuth, canManage);
qualityFormVersionsRouter.use(requireAuth, canManage);

qualityFormsRouter.get(
  '/',
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(await service.listQualityForms(listQualityFormsQuerySchema.parse(req.query))),
    ),
  ),
);
qualityFormsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createQualityFormSchema.parse(req.body);
    const definition = qualityFormDefinitionSchema.parse({ sections: input.sections });
    const { sections: _sections, ...master } = input;
    res
      .status(201)
      .json(successResponse(await service.createQualityForm(req.user!, master, definition)));
  }),
);
qualityFormsRouter.get(
  '/:id',
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.getQualityForm(String(req.params.id)))),
  ),
);
qualityFormsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.updateQualityForm(
          req.user!,
          String(req.params.id),
          updateQualityFormSchema.parse(req.body),
        ),
      ),
    ),
  ),
);
qualityFormsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(
        await service.updateQualityFormStatus(
          req.user!,
          String(req.params.id),
          updateQualityFormStatusSchema.parse(req.body).status,
        ),
      ),
    ),
  ),
);
qualityFormsRouter.post(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const input = createQualityFormVersionSchema.parse(req.body);
    let definition;
    let semantics: {
      activityType: 'MEETING' | 'INSPECTION';
      executionScope: 'JOB_ORDER' | 'SIZE';
    };
    if (input.copyFromVersionId) {
      const source = await service.getQualityFormVersion(input.copyFromVersionId);
      if (source.qualityFormId !== req.params.id)
        throw HttpError.badRequest('Source version does not belong to this Quality Form');
      definition = qualityFormDefinitionSchema.parse({ sections: source.sections });
      semantics = { activityType: source.activityType, executionScope: source.executionScope };
    } else {
      definition = qualityFormDefinitionSchema.parse({ sections: input.sections });
      semantics = {
        activityType: input.activityType!,
        executionScope: input.executionScope!,
      };
    }
    res
      .status(201)
      .json(
        successResponse(
          await service.createQualityFormVersion(
            req.user!,
            String(req.params.id),
            semantics,
            definition,
          ),
        ),
      );
  }),
);

qualityFormVersionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) =>
    res.json(successResponse(await service.getQualityFormVersion(String(req.params.id)))),
  ),
);
qualityFormVersionsRouter.put(
  '/:id/definition',
  asyncHandler(async (req, res) => {
    const input = replaceQualityFormDefinitionSchema.parse(req.body);
    res.json(
      successResponse(
        await service.replaceQualityFormDefinition(
          req.user!,
          String(req.params.id),
          { activityType: input.activityType, executionScope: input.executionScope },
          input,
        ),
      ),
    );
  }),
);
qualityFormVersionsRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) =>
    res.json(
      successResponse(await service.publishQualityFormVersion(req.user!, String(req.params.id))),
    ),
  ),
);
