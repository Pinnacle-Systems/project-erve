import type { ApiErrorResponse, ApiSuccessResponse } from '@erve/types';

export function successResponse<T>(data: T, message?: string): ApiSuccessResponse<T> {
  return { success: true, data, message };
}

export function errorResponse(code: string, message: string, details?: unknown): ApiErrorResponse {
  return { success: false, error: { code, message, details } };
}
