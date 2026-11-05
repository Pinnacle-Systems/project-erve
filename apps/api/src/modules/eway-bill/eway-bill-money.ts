// Exact decimal-string -> whole-paise conversion for the E-Way Bill request
// mapper. Pure BigInt: no floating point is touched until the final, already
// rounded paise value is divided by 100 for the JSON number.

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * Rounds a decimal string to 2 decimal places, ROUND_HALF_UP (ties away from
 * zero, matching the invoice calculation), and returns the value in paise.
 * Returns null when the string is not a plain decimal.
 */
export function toPaiseHalfUp(value: string): bigint | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const padded = `${fraction}000`;
  let paise = BigInt(whole!) * 100n + BigInt(padded.slice(0, 2));
  if (padded.charCodeAt(2) >= 53 /* '5' */) paise += 1n;
  return sign === '-' ? -paise : paise;
}

/** Exact for any realistic invoice amount: the shortest decimal form of paise/100. */
export function paiseToNumber(paise: bigint): number {
  return Number(paise) / 100;
}

export function absPaise(paise: bigint): bigint {
  return paise < 0n ? -paise : paise;
}
