import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { errorResponse } from '../utils/response.js';
import { HttpError } from '../errors/http-error.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(errorResponse('NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json(errorResponse(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid request data', err.flatten()));
    return;
  }

  console.error(err);
  res.status(500).json(errorResponse('INTERNAL_SERVER_ERROR', 'Something went wrong'));
}
