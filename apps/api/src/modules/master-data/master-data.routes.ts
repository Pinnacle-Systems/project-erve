import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { successResponse } from '../../utils/response.js';
import {
  createDistributorSchema,
  createFactorySchema,
  createProcessFlowSchema,
  createProcessFlowVersionSchema,
  createSizeSchema,
  createStyleSchema,
  listStatusQuerySchema,
  listStylesQuerySchema,
  replaceProcessFlowVersionStagesSchema,
  styleFactorySchema,
  styleSizeSchema,
  updateDistributorSchema,
  updateDistributorStatusSchema,
  updateFactorySchema,
  updateFactoryStatusSchema,
  updateSizeSchema,
  updateSizeStatusSchema,
  updateStyleSchema,
  updateStyleStatusSchema,
} from './master-data.validation.js';
import * as masterDataService from './master-data.service.js';
import * as styleImagesService from './style-images.service.js';
import { singleImageUpload } from '../../middleware/image-upload.js';
import { HttpError } from '../../errors/http-error.js';

const canManageMasterData = requireRoles('ADMIN', 'MERCHANDISER');
const canViewStyles = requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT');
const canViewFactories = requireRoles('ADMIN', 'MERCHANDISER', 'FACTORY_USER');
const canViewDistributors = requireRoles(
  'ADMIN',
  'MERCHANDISER',
  'SENIOR_MANAGEMENT',
  'DISTRIBUTOR',
);
const canManageDistributors = requireRoles('ADMIN');

export const stylesRouter = Router();
export const sizesRouter = Router();
export const factoriesRouter = Router();
export const processFlowsRouter = Router();
export const processFlowVersionsRouter = Router();
export const distributorsRouter = Router();

stylesRouter.use(requireAuth);
sizesRouter.use(requireAuth);
factoriesRouter.use(requireAuth);
processFlowsRouter.use(requireAuth);
processFlowVersionsRouter.use(requireAuth);
distributorsRouter.use(requireAuth);

distributorsRouter.get(
  '/',
  canViewDistributors,
  asyncHandler(async (req, res) => {
    const filters = listStatusQuerySchema.parse(req.query);
    const distributors = await masterDataService.listDistributors(req.user!, filters);
    res.status(200).json(successResponse(distributors));
  }),
);

distributorsRouter.post(
  '/',
  canManageDistributors,
  asyncHandler(async (req, res) => {
    const input = createDistributorSchema.parse(req.body);
    const distributor = await masterDataService.createDistributor(req.user!, input);
    res.status(201).json(successResponse(distributor));
  }),
);

distributorsRouter.get(
  '/:id',
  canViewDistributors,
  asyncHandler(async (req, res) => {
    const distributor = await masterDataService.getDistributorById(
      req.user!,
      req.params.id! as string,
    );
    res.status(200).json(successResponse(distributor));
  }),
);

distributorsRouter.patch(
  '/:id',
  canManageDistributors,
  asyncHandler(async (req, res) => {
    const input = updateDistributorSchema.parse(req.body);
    const distributor = await masterDataService.updateDistributor(
      req.user!,
      req.params.id! as string,
      input,
    );
    res.status(200).json(successResponse(distributor));
  }),
);

distributorsRouter.patch(
  '/:id/status',
  canManageDistributors,
  asyncHandler(async (req, res) => {
    const { status } = updateDistributorStatusSchema.parse(req.body);
    const distributor = await masterDataService.updateDistributorStatus(
      req.user!,
      req.params.id! as string,
      status,
    );
    res.status(200).json(successResponse(distributor));
  }),
);

distributorsRouter.get(
  '/:id/users',
  canManageDistributors,
  asyncHandler(async (req, res) => {
    const users = await masterDataService.listDistributorUsers(req.params.id! as string);
    res.status(200).json(successResponse(users));
  }),
);

stylesRouter.get(
  '/',
  canViewStyles,
  asyncHandler(async (req, res) => {
    const filters = listStylesQuerySchema.parse(req.query);
    const styles = await masterDataService.listStyles(filters);
    res.status(200).json(successResponse(styles));
  }),
);

stylesRouter.post(
  '/',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = createStyleSchema.parse(req.body);
    const style = await masterDataService.createStyle(req.user!, input);
    res.status(201).json(successResponse(style));
  }),
);

stylesRouter.get(
  '/:id',
  canViewStyles,
  asyncHandler(async (req, res) => {
    const style = await masterDataService.getStyleById(req.params.id! as string);
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.patch(
  '/:id',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = updateStyleSchema.parse(req.body);
    const style = await masterDataService.updateStyle(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.patch(
  '/:id/status',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const { status } = updateStyleStatusSchema.parse(req.body);
    const style = await masterDataService.updateStyleStatus(
      req.user!,
      req.params.id! as string,
      status,
    );
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.post(
  '/:id/sizes',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = styleSizeSchema.parse(req.body);
    const style = await masterDataService.addStyleSize(req.user!, req.params.id! as string, input);
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.delete(
  '/:id/sizes/:sizeId',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const style = await masterDataService.removeStyleSize(
      req.user!,
      req.params.id! as string,
      req.params.sizeId! as string,
    );
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.post(
  '/:id/factories',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = styleFactorySchema.parse(req.body);
    const style = await masterDataService.addStyleFactory(
      req.user!,
      req.params.id! as string,
      input,
    );
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.delete(
  '/:id/factories/:factoryId',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const style = await masterDataService.removeStyleFactory(
      req.user!,
      req.params.id! as string,
      req.params.factoryId! as string,
    );
    res.status(200).json(successResponse(style));
  }),
);

stylesRouter.post(
  '/:id/images',
  canManageMasterData,
  singleImageUpload('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw HttpError.badRequest("A multipart file field named 'image' is required");
    }
    const { image, created } = await styleImagesService.uploadStyleImage(
      req.user!,
      req.params.id! as string,
      { buffer: req.file.buffer, originalName: req.file.originalname },
    );
    // A retried upload of identical content answers 200 with the existing
    // image instead of creating a duplicate (201).
    res.status(created ? 201 : 200).json(successResponse(image));
  }),
);

stylesRouter.get(
  '/:id/images',
  canViewStyles,
  asyncHandler(async (req, res) => {
    const images = await styleImagesService.listStyleImages(req.params.id! as string);
    res.status(200).json(successResponse(images));
  }),
);

stylesRouter.get(
  '/:id/images/:imageId/content',
  canViewStyles,
  asyncHandler(async (req, res) => {
    const content = await styleImagesService.getStyleImageContent(
      req.params.id! as string,
      req.params.imageId! as string,
    );
    // The storage key (and therefore the ETag) changes on every replace, so
    // clients revalidate cheaply and never render stale replaced content.
    if (req.headers['if-none-match'] === content.etag) {
      res.status(304).end();
      return;
    }
    res
      .status(200)
      .set({
        'Content-Type': content.mimeType,
        'Content-Length': String(content.data.length),
        'Content-Disposition': `inline; filename="${content.fileName.replaceAll('"', '')}"`,
        'Cache-Control': 'private, no-cache',
        ETag: content.etag,
      })
      .send(content.data);
  }),
);

stylesRouter.put(
  '/:id/images/:imageId',
  canManageMasterData,
  singleImageUpload('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw HttpError.badRequest("A multipart file field named 'image' is required");
    }
    const image = await styleImagesService.replaceStyleImage(
      req.user!,
      req.params.id! as string,
      req.params.imageId! as string,
      { buffer: req.file.buffer, originalName: req.file.originalname },
    );
    res.status(200).json(successResponse(image));
  }),
);

stylesRouter.delete(
  '/:id/images/:imageId',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const images = await styleImagesService.removeStyleImage(
      req.user!,
      req.params.id! as string,
      req.params.imageId! as string,
    );
    res.status(200).json(successResponse(images));
  }),
);

stylesRouter.patch(
  '/:id/images/:imageId/primary',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const images = await styleImagesService.setPrimaryStyleImage(
      req.user!,
      req.params.id! as string,
      req.params.imageId! as string,
    );
    res.status(200).json(successResponse(images));
  }),
);

sizesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = listStatusQuerySchema.parse(req.query);
    const sizes = await masterDataService.listSizes(filters);
    res.status(200).json(successResponse(sizes));
  }),
);

sizesRouter.post(
  '/',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = createSizeSchema.parse(req.body);
    const size = await masterDataService.createSize(input);
    res.status(201).json(successResponse(size));
  }),
);

sizesRouter.patch(
  '/:id',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = updateSizeSchema.parse(req.body);
    const size = await masterDataService.updateSize(req.params.id! as string, input);
    res.status(200).json(successResponse(size));
  }),
);

sizesRouter.patch(
  '/:id/status',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const { status } = updateSizeStatusSchema.parse(req.body);
    const size = await masterDataService.updateSizeStatus(req.params.id! as string, status);
    res.status(200).json(successResponse(size));
  }),
);

factoriesRouter.get(
  '/',
  canViewFactories,
  asyncHandler(async (req, res) => {
    const filters = listStatusQuerySchema.parse(req.query);
    const factories = await masterDataService.listFactories(req.user!, filters);
    res.status(200).json(successResponse(factories));
  }),
);

factoriesRouter.post(
  '/',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = createFactorySchema.parse(req.body);
    const factory = await masterDataService.createFactory(input);
    res.status(201).json(successResponse(factory));
  }),
);

factoriesRouter.get(
  '/:id',
  canViewFactories,
  asyncHandler(async (req, res) => {
    const factory = await masterDataService.getFactoryById(req.user!, req.params.id! as string);
    res.status(200).json(successResponse(factory));
  }),
);

factoriesRouter.patch(
  '/:id',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = updateFactorySchema.parse(req.body);
    const factory = await masterDataService.updateFactory(req.params.id! as string, input);
    res.status(200).json(successResponse(factory));
  }),
);

factoriesRouter.patch(
  '/:id/status',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const { status } = updateFactoryStatusSchema.parse(req.body);
    const factory = await masterDataService.updateFactoryStatus(req.params.id! as string, status);
    res.status(200).json(successResponse(factory));
  }),
);

processFlowsRouter.get(
  '/',
  canManageMasterData,
  asyncHandler(async (_req, res) => {
    const flows = await masterDataService.listProcessFlows();
    res.status(200).json(successResponse(flows));
  }),
);

processFlowsRouter.post(
  '/',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = createProcessFlowSchema.parse(req.body);
    const flow = await masterDataService.createProcessFlow(input, req.user!);
    res.status(201).json(successResponse(flow));
  }),
);

processFlowsRouter.get(
  '/:id',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const flow = await masterDataService.getProcessFlowById(req.params.id! as string);
    res.status(200).json(successResponse(flow));
  }),
);

processFlowsRouter.post(
  '/:id/versions',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = createProcessFlowVersionSchema.parse(req.body);
    const version = await masterDataService.createProcessFlowVersion(
      req.params.id! as string,
      input,
      req.user!,
    );
    res.status(201).json(successResponse(version));
  }),
);

processFlowVersionsRouter.get(
  '/:id',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const version = await masterDataService.getProcessFlowVersionById(req.params.id! as string);
    res.status(200).json(successResponse(version));
  }),
);

processFlowVersionsRouter.post(
  '/:id/activate',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const version = await masterDataService.activateProcessFlowVersion(
      req.params.id! as string,
      req.user!,
    );
    res.status(200).json(successResponse(version));
  }),
);

processFlowVersionsRouter.put(
  '/:id/stages',
  canManageMasterData,
  asyncHandler(async (req, res) => {
    const input = replaceProcessFlowVersionStagesSchema.parse(req.body);
    const version = await masterDataService.replaceProcessFlowVersionStages(
      req.params.id! as string,
      input,
      req.user!,
    );
    res.status(200).json(successResponse(version));
  }),
);
