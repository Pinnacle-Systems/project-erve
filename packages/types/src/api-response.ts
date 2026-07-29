export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

import type { StableApiErrorCode } from './operations.js';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: StableApiErrorCode | (string & {});
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
