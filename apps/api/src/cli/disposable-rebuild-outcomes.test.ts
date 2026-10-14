import { describe, expect, it } from 'vitest';
import { summarizeRebuildIssues } from './disposable-rebuild-outcomes.js';
describe('rebuild reporting after committed writes', () => {
  it('accepts migration stages without a return value', () => {
    expect(summarizeRebuildIssues([{ stage: 'migrations', result: undefined }])).toEqual({
      exceptions: 0,
      failures: 0,
    });
  });
  it('distinguishes source rejections from newly failed or image-pending Style operations', () => {
    expect(
      summarizeRebuildIssues([
        {
          stage: 'styles',
          result: {
            preview: [{ rowNumber: 2, status: 'REJECTED' }],
            execution: {
              results: [
                { rowNumber: 2, outcome: 'FAILED' },
                { rowNumber: 3, outcome: 'IMAGE_PENDING' },
                { rowNumber: 4, outcome: 'FAILED' },
              ],
            },
            warnings: [],
          },
        },
      ]),
    ).toEqual({ exceptions: 1, failures: 2 });
  });
  it('ignores outcome-looking customer values while counting actual business row outcomes', () => {
    expect(
      summarizeRebuildIssues([
        {
          stage: 'factories',
          result: {
            summary: { CREATE: 1, REJECTED: 2, NEEDS_REVIEW: 3, FAILED: 1 },
            rows: [{ raw: { Name: 'FAILED' }, outcome: 'CREATE' }],
          },
        },
      ]),
    ).toEqual({ exceptions: 5, failures: 1 });
  });
});
