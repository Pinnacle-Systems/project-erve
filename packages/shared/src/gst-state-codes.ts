// Canonical Indian GST state/UT code list (the 2-digit prefix of a GSTIN),
// used by INV-006 to resolve a Place-of-Supply state code from the
// snapshotted Bill-To address's free-text state name, for cross-validation
// against the Bill-To GSTIN's own 2-digit prefix.
//
// Verified against the current official GST state code list (confirmed via
// live web search during implementation, not from memory alone — matches
// taxheal.com/caclubindia.com's published lists, plus the 1-Jan-2020 J&K/
// Ladakh bifurcation which reassigned UT code 38 to Ladakh). This is public
// statutory data, not a project-specific business assumption.
//
// Lookup is exact-match only (after trim + uppercase normalization) against
// an explicit, documented alias list. There is deliberately NO fuzzy
// matching — an unrecognized or ambiguous name must fail closed, never be
// guessed, per INV-006's confirmed design.
//
// Known, deliberately unresolved ambiguity: pre-2014 Andhra Pradesh GSTINs
// use state code 28; the current (post-bifurcation) state code is 37. Both
// are named "Andhra Pradesh" with no distinguishing text, so this map can
// only resolve the name to one code (37, the current code). A legacy GSTIN
// still prefixed 28 will correctly fail the GSTIN-consistency cross-check
// at finalize time rather than have this module silently pick a code for
// it — that mismatch requires human review, not an automatic guess.

const CANONICAL_NAME_TO_STATE_CODE: Readonly<Record<string, string>> = {
  'JAMMU AND KASHMIR': '01',
  'JAMMU & KASHMIR': '01',
  'HIMACHAL PRADESH': '02',
  PUNJAB: '03',
  CHANDIGARH: '04',
  UTTARAKHAND: '05',
  UTTARANCHAL: '05',
  HARYANA: '06',
  DELHI: '07',
  'NCT OF DELHI': '07',
  'NATIONAL CAPITAL TERRITORY OF DELHI': '07',
  RAJASTHAN: '08',
  'UTTAR PRADESH': '09',
  BIHAR: '10',
  SIKKIM: '11',
  'ARUNACHAL PRADESH': '12',
  NAGALAND: '13',
  MANIPUR: '14',
  MIZORAM: '15',
  TRIPURA: '16',
  MEGHALAYA: '17',
  ASSAM: '18',
  'WEST BENGAL': '19',
  JHARKHAND: '20',
  ODISHA: '21',
  ORISSA: '21',
  CHHATTISGARH: '22',
  CHATTISGARH: '22',
  'MADHYA PRADESH': '23',
  GUJARAT: '24',
  'DAMAN AND DIU': '25',
  'DAMAN & DIU': '25',
  'DADRA AND NAGAR HAVELI': '26',
  'DADRA & NAGAR HAVELI': '26',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU': '26',
  MAHARASHTRA: '27',
  KARNATAKA: '29',
  GOA: '30',
  LAKSHADWEEP: '31',
  KERALA: '32',
  'TAMIL NADU': '33',
  PUDUCHERRY: '34',
  PONDICHERRY: '34',
  'ANDAMAN AND NICOBAR ISLANDS': '35',
  'ANDAMAN & NICOBAR ISLANDS': '35',
  TELANGANA: '36',
  'ANDHRA PRADESH': '37',
  LADAKH: '38',
};

/**
 * Resolves a free-text Indian state/UT name to its canonical 2-digit GST
 * state code. Returns `null` for anything not an exact, documented match —
 * callers must fail closed on `null`, never substitute a guessed code.
 */
export function resolveGstStateCode(stateName: string | null | undefined): string | null {
  if (!stateName) return null;
  const normalized = stateName.trim().toUpperCase();
  if (!normalized) return null;
  return CANONICAL_NAME_TO_STATE_CODE[normalized] ?? null;
}
