import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { HttpError } from '../errors/http-error.js';

// Multipart parsing for single-image uploads. Memory storage is deliberate:
// files are capped at UPLOAD_MAX_IMAGE_BYTES, validated by signature, and
// then written through the FileStorage adapter — nothing multipart ever
// touches the filesystem directly.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_IMAGE_BYTES, files: 1 },
});

export function singleImageUpload(field: string) {
  const handler = imageUpload.single(field);
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        next(
          error.code === 'LIMIT_FILE_SIZE'
            ? new HttpError(
                413,
                'PAYLOAD_TOO_LARGE',
                `Image exceeds the maximum allowed size of ${env.UPLOAD_MAX_IMAGE_BYTES} bytes`,
              )
            : HttpError.badRequest(`Invalid upload: ${error.message}`),
        );
        return;
      }
      next(error);
    });
  };
}
