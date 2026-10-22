import { describe, expect, it } from 'vitest';
import { sendToFactoryErrorMessage } from './job-order-detail-utils.js';

const failure = (status: number, code: string, message: string, details?: unknown) => ({
  isAxiosError: true, response: { status, data: { error: { code, message, details } } },
});
describe('Send-to-Factory feedback', () => {
  it('retains individual field validation problems', () => {
    expect(sendToFactoryErrorMessage(failure(400, 'VALIDATION_ERROR', 'Invalid request data', {
      issues: [{ field: 'expectedVersion', message: 'Expected a number' }, { field: 'disclaimerText', message: 'Terms are required' }],
    }))).toContain('expectedVersion: Expected a number');
    expect(sendToFactoryErrorMessage(failure(400, 'VALIDATION_ERROR', 'Invalid request data', {
      issues: [{ field: 'disclaimerText', message: 'Terms are required' }],
    }))).toContain('disclaimerText: Terms are required');
  });
  it.each([
    [400, 'DISCLAIMER_REQUIRED', 'Required', /commercial terms.*required/i],
    [409, 'STALE_VERSION', 'Changed', /reload/i],
    [400, 'VALIDATION_ERROR', 'Only DRAFT job orders can be sent to factory', /draft/i],
    [409, 'CONFLICT', 'An inactive factory cannot receive a job order', /active factory|activate/i],
    [403, 'FORBIDDEN', 'Denied', /permission/i],
    [401, 'UNAUTHORIZED', 'Expired', /sign in/i],
    [404, 'NOT_FOUND', 'Job order not found', /Job Order.*found/i],
  ])('handles existing %s/%s failures', (status, code, message, expected) => {
    expect(sendToFactoryErrorMessage(failure(status as number, code as string, message as string))).toMatch(expected as RegExp);
  });
  it.each([
    new Error('secret stack trace'),
    { isAxiosError: true, message: 'Network Error' },
    failure(500, 'INTERNAL_SERVER_ERROR', 'private database detail'),
    { isAxiosError: true, response: { status: 502, data: '<html>proxy error</html>' } },
    { isAxiosError: true, response: { status: 400, data: {} } },
    failure(400, 'VALIDATION_ERROR', ''),
  ])('gives recovery guidance without leaking unexpected errors', (error) => {
    const message = sendToFactoryErrorMessage(error);
    expect(message).toMatch(/try again|retry/i);
    expect(message).not.toMatch(/secret|private database|<html>|Network Error/);
  });
});
