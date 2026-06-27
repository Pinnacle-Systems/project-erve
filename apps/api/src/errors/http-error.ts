export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication required', details?: unknown): HttpError {
    return new HttpError(401, 'UNAUTHORIZED', message, details);
  }

  static forbidden(
    message = 'You do not have permission to access this resource',
    details?: unknown,
  ): HttpError {
    return new HttpError(403, 'FORBIDDEN', message, details);
  }

  static notFound(message: string, details?: unknown): HttpError {
    return new HttpError(404, 'NOT_FOUND', message, details);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, 'CONFLICT', message, details);
  }

  static internal(message = 'Something went wrong', details?: unknown): HttpError {
    return new HttpError(500, 'INTERNAL_SERVER_ERROR', message, details);
  }
}
