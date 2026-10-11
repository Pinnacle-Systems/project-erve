import { describe, expect, it } from 'vitest';
import { resolveJobOrderPrimaryStyle, type JobOrderPrimaryStyle } from './resolveJobOrderPrimaryStyle.js';

function line(overrides: Partial<JobOrderPrimaryStyle> = {}): JobOrderPrimaryStyle {
  return { styleId: 'style-1', styleNumber: 'STY-0001', styleName: 'Basic Tee', primaryImage: null, ...overrides };
}

describe('resolveJobOrderPrimaryStyle', () => {
  it('resolves consistent when every line shares one styleId, even with multiple lines', () => {
    const result = resolveJobOrderPrimaryStyle([line(), line({ styleId: 'style-1', styleNumber: 'STY-0001' })]);
    expect(result).toEqual({ consistent: true, style: line() });
  });

  it('is inconsistent when lines reference different Styles — never guesses one', () => {
    const result = resolveJobOrderPrimaryStyle([line(), line({ styleId: 'style-2', styleNumber: 'STY-0002' })]);
    expect(result).toEqual({ consistent: false });
  });

  it('is inconsistent (not a crash) for an empty lines array', () => {
    expect(resolveJobOrderPrimaryStyle([])).toEqual({ consistent: false });
  });

  it('resolves consistent for the common single-line case', () => {
    const only = line({ primaryImage: { id: 'img-1', styleId: 'style-1', fileId: 'f1', fileName: 'x', mimeType: 'image/png', sizeBytes: 1, isPrimary: true, sortOrder: 0, createdAt: '', updatedAt: '' } });
    expect(resolveJobOrderPrimaryStyle([only])).toEqual({ consistent: true, style: only });
  });
});
