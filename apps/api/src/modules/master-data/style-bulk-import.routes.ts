import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { singleBulkImportFileUpload } from '../../middleware/bulk-file-upload.js';
import { successResponse } from '../../utils/response.js';
import { HttpError } from '../../errors/http-error.js';
import { executeBulkStyleImport, planBulkStyleImport, summarizeBulkStyleImportPlan } from './style-bulk-import.service.js';

// Same RBAC as POST /styles (master-data.routes.ts) — a bulk import is
// equivalent to many individual Style creates and must require the same
// authorization, nothing looser.
const canManageMasterData = requireRoles('ADMIN', 'MERCHANDISER');

// Mounted at /styles/bulk-import, and registered BEFORE /styles
// (master-data.routes.ts's `GET /:id`) in app.ts — deliberately its own
// router, not folded into stylesRouter, so a two-segment path like
// /styles/bulk-import/preflight is never at risk of being matched by a
// single-segment `/:id` route.
export const styleBulkImportRouter = Router();
styleBulkImportRouter.use(requireAuth);

function requireUploadedFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw HttpError.badRequest('A workbook file is required (multipart field "file")');
  }
  return file;
}

// Read-only: validates the workbook against current master data and
// provenance, but never writes. Safe to call repeatedly while a user
// reviews the preview.
styleBulkImportRouter.post(
  '/preflight',
  canManageMasterData,
  singleBulkImportFileUpload('file'),
  asyncHandler(async (req, res) => {
    const file = requireUploadedFile(req.file);
    const plan = await planBulkStyleImport(file.buffer);
    res.json(
      successResponse({
        sourceFileChecksum: plan.sourceFileChecksum,
        summary: summarizeBulkStyleImportPlan(plan),
        rows: plan.rows.map((row) => ({
          rowNumber: row.rowNumber,
          styleNumber: row.styleNumber,
          status: row.status,
          reason: row.reason,
          detail: row.detail,
          imageCount: row.imageCount,
        })),
        fileLevelImageWarnings: plan.fileLevelImageWarnings,
      }),
    );
  }),
);

// Re-uploads the same workbook rather than referencing a server-held
// preflight result, and re-plans fresh from it before executing — this
// guarantees execute always reflects the current DB state and the exact
// bytes it runs against, even if time passed since preflight.
styleBulkImportRouter.post(
  '/execute',
  canManageMasterData,
  singleBulkImportFileUpload('file'),
  asyncHandler(async (req, res) => {
    const file = requireUploadedFile(req.file);
    const plan = await planBulkStyleImport(file.buffer);
    const summary = await executeBulkStyleImport(req.user!, plan, file.originalname);
    res.json(successResponse(summary));
  }),
);
