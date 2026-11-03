import type { GstVerificationView } from '@erve/types';

/**
 * What the GSTIN input may claim about the GSTIN currently typed into it.
 *
 * `verified` is deliberately narrow: fresh Live evidence, retrieved for exactly
 * this GSTIN, at the level settings require, for an active registration.
 * Everything else is either a clearly different state or no claim at all.
 */
export type GstinFieldStatus =
  | { kind: 'none' }
  | { kind: 'verified' }
  | { kind: 'demo' }
  | { kind: 'attention'; reason: 'stale' | 'basic-only' | 'registration'; message: string };

const NONE: GstinFieldStatus = { kind: 'none' };

/** `gstin` must already be normalized (trimmed, upper-case) and well-formed. */
export function deriveGstinFieldStatus(
  view: GstVerificationView | undefined,
  gstin: string,
  now: number = Date.now(),
): GstinFieldStatus {
  const evidence = view?.evidence;
  if (!view || !view.enabled || !evidence) return NONE;
  // Evidence is keyed by GSTIN. If the response is for any other value (a slow
  // response for a previously typed GSTIN, say), it says nothing about this one.
  if (evidence.normalizedGstin !== gstin) return NONE;
  if (evidence.mode !== view.mode) return NONE;

  if (evidence.mode === 'DEMO') return { kind: 'demo' };

  if (view.cacheState === 'STALE' || Date.parse(evidence.expiresAt) <= now)
    return {
      kind: 'attention',
      reason: 'stale',
      message: 'Verification is out of date. Verify again to refresh it.',
    };
  // Basic evidence never stands in for a Complete Profile requirement.
  if (
    view.cacheState === 'BASIC_ONLY' ||
    (view.level === 'COMPLETE' && evidence.level !== 'COMPLETE')
  )
    return {
      kind: 'attention',
      reason: 'basic-only',
      message: 'Only a Basic verification is available. The Complete Profile is not retrieved.',
    };
  // Live lookups are made for the GSTIN itself; a different returned GSTIN is
  // never accepted as verification of this one.
  if (evidence.returnedGstin !== gstin) return NONE;
  if (evidence.governmentStatus !== 'ACTIVE')
    return {
      kind: 'attention',
      reason: 'registration',
      message: `Registration status: ${
        evidence.governmentStatus === 'UNKNOWN'
          ? 'Unknown'
          : evidence.governmentStatus.charAt(0) + evidence.governmentStatus.slice(1).toLowerCase()
      }.`,
    };
  return { kind: 'verified' };
}
