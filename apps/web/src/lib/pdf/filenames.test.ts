import { describe, expect, it } from 'vitest';
import { buildPdfFilename } from './filenames.js';

describe('buildPdfFilename', () => {
  it('joins parts with dashes and appends .pdf', () => {
    expect(buildPdfFilename(['ERVE-Styles', '2026-09-12'])).toBe('ERVE-Styles-2026-09-12.pdf');
  });

  it('sanitizes an unusual style code so the filename can never break', () => {
    expect(buildPdfFilename(['ERVE-Style', 'STY/001 (v2)*?'])).toBe('ERVE-Style-STY-001-v2.pdf');
  });

  it('drops empty/undefined/null parts and collapses repeated separators', () => {
    expect(buildPdfFilename(['ERVE-Styles', undefined, '', null, '2026-09-12'])).toBe(
      'ERVE-Styles-2026-09-12.pdf',
    );
  });

  it('falls back to a safe default when every part is empty', () => {
    expect(buildPdfFilename([undefined, '', '   '])).toBe('document.pdf');
  });

  it('trims an excessively long filename', () => {
    const longPart = 'A'.repeat(300);
    const filename = buildPdfFilename(['ERVE-Style', longPart]);
    expect(filename.length).toBeLessThanOrEqual(154); // 150 + '.pdf'
    expect(filename.endsWith('.pdf')).toBe(true);
  });
});
