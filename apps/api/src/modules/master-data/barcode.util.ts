// The single authoritative Style + Size barcode generator. Server-side only:
// the web never derives a barcode, it only shows what the API stored.
//
//   Season barcode serials 1-2: <serial><LMIX digits><size number> (legacy)
//   Season barcode serials 3+:  <serial><space><LMIX digits><size number padded to 2+ digits>
//   e.g. serial 3 + LMIX12345678 + size "3Y"  -> "3 1234567803"
//        serial 3 + LMIX12345678 + size "10Y" -> "3 1234567810"
// Historical/persisted barcodes are NEVER reformatted by this generator.
//
// Parts are concatenated as strings (never added), and each part is parsed
// strictly: a value that is not unambiguously one of the recognised shapes is
// reported, never "cleaned up" into something that merely looks plausible.

/** Why a barcode could not be generated; also the dry-run report categories. */
export type BarcodeSourceProblem = 'MISSING_SEASON_SERIAL' | 'INVALID_LMIX' | 'AMBIGUOUS_SIZE';

export type GeneratedBarcodeResult =
  | { ok: true; barcode: string }
  | { ok: false; problem: BarcodeSourceProblem; message: string };

export interface BarcodeSource {
  seasonSerial: number | null | undefined;
  lmixNumber: string | null | undefined;
  sizeLabel: string;
  sizeType: string;
}

// Supplied/historical barcodes are kept verbatim. Existing printable,
// space-free historical values stay valid. From serial 3 onward, also allow
// exactly ONE ASCII space after a valid Season serial, followed by numeric
// LMIX+size digits (at least one LMIX digit and two size digits). Do not open
// validation to arbitrary whitespace or free-text values with spaces.
export const SUPPLIED_BARCODE_PATTERN =
  /^(?=.{1,64}$)(?:[\x21-\x7E]+|(?:[3-9]|[1-9]\d{1,4}) \d{3,})$/;
export const SUPPLIED_BARCODE_MESSAGE =
  'Barcode must be 1-64 printable characters without spaces, or use the Season 3+ format "<season serial> <LMIX digits><2-digit size>"';

const LMIX_PATTERN = /^LMIX(\d+)$/i;
// Age sizes as printed on the master: "3", "10", or with a years suffix
// ("3Y", "10 YRS"). No leading zero, at most 3 digits. Anything else
// ("3-8 YEARS", "S", "FREE") has no confirmed numeric semantics.
const SIZE_PATTERN = /^([1-9]\d{0,2})\s*(?:Y|YR|YRS|YEAR|YEARS)?$/i;
// Only these Size types have a confirmed numeric barcode meaning.
const NUMERIC_SIZE_TYPES = new Set(['AGE', 'NUMERIC']);

/** "LMIX1234" -> "1234"; null when the value is not exactly LMIX + digits. */
export function parseLmixDigits(lmixNumber: string | null | undefined): string | null {
  const match = LMIX_PATTERN.exec((lmixNumber ?? '').trim());
  return match ? match[1]! : null;
}

/** "3Y" -> "3", "10" -> "10"; null when the label/type is not a plain age size. */
export function parseSizeNumber(sizeLabel: string, sizeType: string): string | null {
  if (!NUMERIC_SIZE_TYPES.has(sizeType)) return null;
  const match = SIZE_PATTERN.exec(sizeLabel.trim());
  return match ? match[1]! : null;
}

export function generateStyleSizeBarcode(source: BarcodeSource): GeneratedBarcodeResult {
  const { seasonSerial, lmixNumber, sizeLabel, sizeType } = source;
  if (seasonSerial === null || seasonSerial === undefined || !Number.isInteger(seasonSerial) || seasonSerial <= 0) {
    return { ok: false, problem: 'MISSING_SEASON_SERIAL', message: 'its Season has no Barcode Serial' };
  }
  const lmixDigits = parseLmixDigits(lmixNumber);
  if (!lmixDigits) {
    return {
      ok: false,
      problem: 'INVALID_LMIX',
      message: `the Style LMIX ${lmixNumber ? `"${lmixNumber}"` : '(blank)'} is not in the form LMIX<digits>`,
    };
  }
  const sizeNumber = parseSizeNumber(sizeLabel, sizeType);
  if (!sizeNumber) {
    return {
      ok: false,
      problem: 'AMBIGUOUS_SIZE',
      message: `Size "${sizeLabel}" (${sizeType}) has no unambiguous numeric value`,
    };
  }
  // New format is applied only when generating a barcode. Saved/manual
  // barcodes remain exactly as entered and Season 1-2 retain their legacy
  // concatenated format.
  const barcode = seasonSerial >= 3
    ? `${seasonSerial} ${lmixDigits}${sizeNumber.padStart(2, '0')}`
    : `${seasonSerial}${lmixDigits}${sizeNumber}`;
  return { ok: true, barcode };
}

/** Trims a supplied barcode; blank means "not supplied" (null). Format is checked separately. */
export function normalizeSuppliedBarcode(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}
