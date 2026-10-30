import { Router } from 'express';
import { requireAuth } from '../../auth/auth.middleware.js';
import { requireRoles } from '../../auth/rbac.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { singleBulkImportFileUpload } from '../../middleware/bulk-file-upload.js';
import { successResponse } from '../../utils/response.js';
import { HttpError } from '../../errors/http-error.js';
import { executeBulkStyleImport, planBulkStyleImport, summarizeBulkStyleImportPlan, bulkStyleImportConfirmationToken, verifyBulkStyleImportConfirmation, buildBulkStyleImportTemplate, buildBulkStyleImportExceptions, listBulkStyleImportWorksheets, styleImportReportOutcome } from './style-bulk-import.service.js';
import { prisma } from '../../db/prisma.js';

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

styleBulkImportRouter.get('/template', canManageMasterData, asyncHandler(async (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="styles.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await buildBulkStyleImportTemplate());
}));
styleBulkImportRouter.post('/worksheets', canManageMasterData, singleBulkImportFileUpload('file'), asyncHandler(async (req, res) => {
  res.json(successResponse(listBulkStyleImportWorksheets(requireUploadedFile(req.file).buffer)));
}));
styleBulkImportRouter.post('/exceptions', canManageMasterData, singleBulkImportFileUpload('file'), asyncHandler(async (req, res) => {
  const file = requireUploadedFile(req.file);
  const plan = await planBulkStyleImport(file.buffer, typeof req.body.worksheet === 'string' && req.body.worksheet ? req.body.worksheet : undefined);
  res.setHeader('Content-Disposition', 'attachment; filename="style-import-exceptions.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buildBulkStyleImportExceptions(file.buffer, plan));
}));
styleBulkImportRouter.get('/history', canManageMasterData, asyncHandler(async (_req, res) => {
  const runs = await prisma.styleBulkImportRun.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
    include: { rows: { orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }] } } });
  res.json(successResponse(runs.map((run) => ({ ...run, rows: run.rows.map((row) => ({ ...row, reportOutcome: styleImportReportOutcome(row.outcome) })) }))));
}));
styleBulkImportRouter.get('/history/:runId/report', canManageMasterData, asyncHandler(async (req, res) => {
  const run = await prisma.styleBulkImportRun.findUnique({ where: { id: req.params.runId as string }, include: { rows: { orderBy: { rowNumber: 'asc' } } } });
  if (!run) throw HttpError.notFound('Style import run not found');
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [['Row', 'Style Number', 'Outcome', 'Report Outcome', 'Detail'], ...run.rows.map((row) => [row.rowNumber, row.styleNumber, row.outcome, styleImportReportOutcome(row.outcome), row.detail])]
    .map((row) => row.map(cell).join(',')).join('\r\n');
  res.setHeader('Content-Disposition', `attachment; filename="style-import-${run.id}.csv"`);
  res.type('text/csv').send(csv);
}));

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
    const plan = await planBulkStyleImport(file.buffer, typeof req.body.worksheet === 'string' && req.body.worksheet ? req.body.worksheet : undefined);
    res.json(
      successResponse({
        sourceFileChecksum: plan.sourceFileChecksum,
        worksheet: plan.worksheet,
        worksheets: listBulkStyleImportWorksheets(file.buffer),
        confirmationToken: bulkStyleImportConfirmationToken(plan, req.user!.id),
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
    const plan = await planBulkStyleImport(file.buffer, typeof req.body.worksheet === 'string' && req.body.worksheet ? req.body.worksheet : undefined);
    if (req.body.sourceFileChecksum && req.body.sourceFileChecksum !== plan.sourceFileChecksum) {
      throw HttpError.conflict('Workbook bytes changed since preview; preview this file again');
    }
    if (!req.body.confirmationToken) throw HttpError.badRequest('Preview and confirm the workbook before importing');
    verifyBulkStyleImportConfirmation(plan, req.user!.id, String(req.body.confirmationToken));
    const summary = await executeBulkStyleImport(req.user!, plan, file.originalname);
    res.json(successResponse(summary));
  }),
);
