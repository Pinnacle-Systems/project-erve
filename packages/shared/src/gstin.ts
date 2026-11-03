// Structure only: deliberately preserves the established acceptance rules.
// This is not checksum validation or government registration verification.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidGstinFormat(value: string): boolean {
  return GSTIN_REGEX.test(normalizeGstin(value));
}

/**
 * Reserved source id for verification requested from an unsaved (or edited and
 * not-yet-saved) GSTIN on an authorized master form. Real record ids are
 * generated and can never equal it; authorization for it is role-based per
 * source type, never "any source".
 */
export const GST_DRAFT_SOURCE_ID = 'NEW';
