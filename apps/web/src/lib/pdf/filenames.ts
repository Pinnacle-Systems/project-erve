const MAX_FILENAME_LENGTH = 150;

/**
 * Builds a safe PDF filename from parts, e.g. buildPdfFilename(['ERVE-Styles', '2026-09-12'])
 * -> "ERVE-Styles-2026-09-12.pdf". Strips anything outside [A-Za-z0-9-_], collapses repeated
 * separators, and trims to a safe length — so an unusual style code or document number can
 * never produce a broken/unsafe filename.
 */
export function buildPdfFilename(parts: Array<string | null | undefined>): string {
  const sanitizedParts = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map(sanitizeFilenameSegment)
    .filter((part) => part.length > 0);

  const base = sanitizedParts.join('-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const safeBase = base.length > 0 ? base : 'document';
  return `${safeBase.slice(0, MAX_FILENAME_LENGTH)}.pdf`;
}

function sanitizeFilenameSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[^A-Za-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}
