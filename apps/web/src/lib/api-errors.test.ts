import { describe, expect, it } from 'vitest';
import { getApiErrorCode, getApiErrorMessage } from './api-errors.js';

function axiosError(status: number, data: unknown): Error & { isAxiosError: boolean; response: unknown } {
  const error = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: unknown;
  };
  error.isAxiosError = true;
  error.response = { status, data, statusText: '', headers: {}, config: {} };
  return error;
}

function networkError(): Error & { isAxiosError: boolean } {
  const error = new Error('Network Error') as Error & { isAxiosError: boolean };
  error.isAxiosError = true;
  return error;
}

describe('getApiErrorMessage', () => {
  it('extracts the normalized backend business message from a 400 response', () => {
    const caught = axiosError(400, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Every purchase-order Style must have Seasons assigned' },
    });
    expect(getApiErrorMessage(caught, 'fallback')).toBe('Every purchase-order Style must have Seasons assigned');
  });

  it('does not fall back to the raw Axios transport message for a response with no business message', () => {
    const caught = axiosError(400, { success: false, error: {} });
    expect(getApiErrorMessage(caught, 'Unable to save. Please try again.')).toBe('Unable to save. Please try again.');
  });

  it('does not fall back to the raw Axios transport message for a network error with no response', () => {
    const caught = networkError();
    expect(getApiErrorMessage(caught, 'Unable to save. Please try again.')).toBe('Unable to save. Please try again.');
  });

  it('never returns the generic "Request failed with status code" text', () => {
    const caught = axiosError(500, { success: false, error: { code: 'INTERNAL', message: '' } });
    const message = getApiErrorMessage(caught, 'Something went wrong.');
    expect(message).not.toContain('status code');
  });

  it('uses a plain Error message for non-Axios errors', () => {
    expect(getApiErrorMessage(new Error('Distributor is required'), 'fallback')).toBe('Distributor is required');
  });

  it('falls back for non-Error thrown values', () => {
    expect(getApiErrorMessage('boom', 'fallback')).toBe('fallback');
  });
});

describe('getApiErrorCode', () => {
  it('extracts the backend error code from an Axios response', () => {
    const caught = axiosError(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'x' } });
    expect(getApiErrorCode(caught)).toBe('VALIDATION_ERROR');
  });

  it('returns undefined for non-Axios errors', () => {
    expect(getApiErrorCode(new Error('boom'))).toBeUndefined();
  });
});
