// Structure only: deliberately preserves the established acceptance rules.
// This is not checksum validation or government registration verification.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function normalizeGstin(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidGstinFormat(value: string): boolean {
  return GSTIN_REGEX.test(normalizeGstin(value));
}
