import { Router } from 'express';
import { z } from 'zod';
import type { MasterImportRow } from '@erve/types';
import { requireAuth } from '../../auth/auth.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { singleBulkImportFileUpload } from '../../middleware/bulk-file-upload.js';
import { successResponse } from '../../utils/response.js';
import { HttpError } from '../../errors/http-error.js';
import {
  buildMasterImportWorkbook,
  listMasterImportWorksheets,
  masterImportHeaders,
  masterImportWorksheets,
} from './master-import.parser.js';
import {
  planMasterImport,
  executeMasterImport,
  masterImportKindSchema,
  masterImportHistory,
  masterImportRunDetail,
  requireMasterImportActor,
} from './master-import.service.js';

export const masterImportsRouter = Router();
masterImportsRouter.use(requireAuth);
masterImportsRouter.use(
  '/:kind',
  asyncHandler(async (req, _res, next) => {
    await requireMasterImportActor(
      req.user!,
      undefined,
      masterImportKindSchema.parse(req.params.kind),
    );
    next();
  }),
);
function file(req: { file?: Express.Multer.File }): Express.Multer.File {
  if (!req.file) throw HttpError.badRequest('An import file is required (multipart field "file")');
  return req.file;
}
function exceptions(rows: MasterImportRow[]): Buffer {
  const metadata = ['Source Row', 'Import Outcome', 'Import Detail'];
  const headers = [
    ...new Set(rows.flatMap((row) => row.sourceHeaders ?? Object.keys(row.raw))),
  ].filter((header) => !metadata.some((label) => label.toLowerCase() === header.toLowerCase()));
  return buildMasterImportWorkbook(
    [...headers, ...metadata],
    rows
      .filter((row) => ['NEEDS_REVIEW', 'REJECTED', 'FAILED'].includes(row.outcome))
      .map((row) => [
        ...headers.map((header) => row.raw[header] ?? ''),
        String(row.rowNumber),
        row.outcome,
        row.detail ?? '',
      ]),
    'Exceptions',
  );
}
masterImportsRouter.get(
  '/:kind/template',
  asyncHandler(async (req, res) => {
    const kind = masterImportKindSchema.parse(req.params.kind);
    res
      .attachment(`${kind}-template.xlsx`)
      .send(buildMasterImportWorkbook(masterImportHeaders[kind], [], masterImportWorksheets[kind]));
  }),
);
masterImportsRouter.post(
  '/:kind/worksheets',
  singleBulkImportFileUpload('file'),
  asyncHandler(async (req, res) => {
    masterImportKindSchema.parse(req.params.kind);
    const uploaded = file(req);
    res.json(
      successResponse({
        worksheets: listMasterImportWorksheets(uploaded.buffer, uploaded.originalname),
      }),
    );
  }),
);
masterImportsRouter.post(
  '/:kind/preflight',
  singleBulkImportFileUpload('file'),
  asyncHandler(async (req, res) => {
    const kind = masterImportKindSchema.parse(req.params.kind);
    const uploaded = file(req);
    res.json(
      successResponse(
        await planMasterImport(
          req.user!,
          kind,
          uploaded.buffer,
          uploaded.originalname,
          z.string().max(31).optional().parse(req.body?.worksheet),
        ),
      ),
    );
  }),
);
masterImportsRouter.post(
  '/:kind/exceptions',
  singleBulkImportFileUpload('file'),
  asyncHandler(async (req, res) => {
    const kind = masterImportKindSchema.parse(req.params.kind);
    const uploaded = file(req);
    const plan = await planMasterImport(
      req.user!,
      kind,
      uploaded.buffer,
      uploaded.originalname,
      z.string().max(31).optional().parse(req.body?.worksheet),
    );
    res.attachment(`${kind}-exceptions.xlsx`).send(exceptions(plan.rows));
  }),
);
masterImportsRouter.post(
  '/:kind/execute',
  singleBulkImportFileUpload('file'),
  asyncHandler(async (req, res) => {
    const kind = masterImportKindSchema.parse(req.params.kind);
    const uploaded = file(req);
    const token = z.string().min(1).parse(req.body?.confirmationToken);
    res.json(
      successResponse(
        await executeMasterImport(
          req.user!,
          kind,
          uploaded.buffer,
          uploaded.originalname,
          z.string().max(31).optional().parse(req.body?.worksheet),
          token,
        ),
      ),
    );
  }),
);
masterImportsRouter.get(
  '/:kind/history',
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await masterImportHistory(req.user!, masterImportKindSchema.parse(req.params.kind)),
      ),
    );
  }),
);
masterImportsRouter.get(
  '/:kind/history/:runId',
  asyncHandler(async (req, res) => {
    res.json(
      successResponse(
        await masterImportRunDetail(
          req.user!,
          masterImportKindSchema.parse(req.params.kind),
          z.string().min(1).parse(req.params.runId),
        ),
      ),
    );
  }),
);
masterImportsRouter.get(
  '/:kind/history/:runId/exceptions',
  asyncHandler(async (req, res) => {
    const run = await masterImportRunDetail(
      req.user!,
      masterImportKindSchema.parse(req.params.kind),
      z.string().min(1).parse(req.params.runId),
    );
    res
      .attachment(`${run.kind}-${run.id}-exceptions.xlsx`)
      .send(exceptions(run.rows.map((row) => row.payload as unknown as MasterImportRow)));
  }),
);
