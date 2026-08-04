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

  static staleVersion(currentVersion: number): HttpError {
    return new HttpError(409, 'STALE_VERSION', 'The job order changed since it was loaded', {
      currentVersion,
    });
  }

  static disclaimerRequired(): HttpError {
    return new HttpError(400, 'DISCLAIMER_REQUIRED', 'A factory commercial terms / disclaimer is required');
  }

  static acknowledgementRequired(): HttpError {
    return new HttpError(400, 'ACKNOWLEDGEMENT_REQUIRED', 'Explicit disclaimer acknowledgement is required');
  }

  static staleDisclaimerRevision(currentRevision: number): HttpError {
    return new HttpError(
      409,
      'STALE_DISCLAIMER_REVISION',
      'The disclaimer changed since it was loaded',
      { currentRevision },
    );
  }

  static idempotencyKeyReused(): HttpError {
    return new HttpError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used for a different request',
    );
  }

  static factoryMappingRequired(): HttpError {
    return new HttpError(
      403,
      'FACTORY_MAPPING_REQUIRED',
      'A single active factory mapping is required',
    );
  }

  static factoryMappingAmbiguous(): HttpError {
    return new HttpError(
      403,
      'FACTORY_MAPPING_AMBIGUOUS',
      'Multiple factory mappings are not supported',
    );
  }

  static internal(message = 'Something went wrong', details?: unknown): HttpError {
    return new HttpError(500, 'INTERNAL_SERVER_ERROR', message, details);
  }
}
