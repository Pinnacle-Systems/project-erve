import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { HttpError } from '../errors/http-error.js';

// Multipart parsing for a single bulk-import workbook upload. Memory
// storage, same rationale as image-upload.ts: the file is validated in
// memory (parsed as XLSX) and never touches the filesystem directly. A
// workbook with embedded images is larger than a single product photo, so
// this uses its own, more generous size limit rather than reusing
// UPLOAD_MAX_IMAGE_BYTES.
const MAX_BULK_IMPORT_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

const bulkFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BULK_IMPORT_FILE_BYTES, files: 1 },
});

export function singleBulkImportFileUpload(field: string) {
  const handler = bulkFileUpload.single(field);
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          error.code === 'LIMIT_FILE_SIZE'
            ? new HttpError(
                413,
                'PAYLOAD_TOO_LARGE',
                `Workbook exceeds the maximum allowed size of ${MAX_BULK_IMPORT_FILE_BYTES} bytes`,
              )
            : HttpError.badRequest(`Invalid upload: ${error.message}`),
        );
        return;
      }
      next(error);
    });
  };
}
