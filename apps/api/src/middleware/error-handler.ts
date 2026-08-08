import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { errorResponse } from '../utils/response.js';
import { HttpError } from '../errors/http-error.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(errorResponse('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json(errorResponse(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    const formId = req.params.formId ?? req.originalUrl.match(/\/forms\/([^/?]+)/)?.[1];
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid request data', {
      issues: err.issues.map((issue) => ({
        qaSizeInspectionFormId: formId,
        jobOrderLineSizeId: typeof req.body?.jobOrderLineSizeId === 'string' ? req.body.jobOrderLineSizeId : undefined,
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    }));
    return;
  }

  console.error(err);
  res.status(500).json(errorResponse('INTERNAL_SERVER_ERROR', 'Something went wrong'));
}
