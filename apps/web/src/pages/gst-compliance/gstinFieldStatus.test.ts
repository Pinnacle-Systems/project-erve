import { describe, expect, it } from 'vitest';
import type { GstVerificationEvidence, GstVerificationView } from '@erve/types';
import { deriveGstinFieldStatus } from './gstinFieldStatus.js';

const GSTIN = '33AAAAA0000A1Z5';
const NOW = Date.parse('2026-11-03T06:00:00Z');
const evidence = (overrides: Partial<GstVerificationEvidence> = {}): GstVerificationEvidence => ({
  id: 'e1',
  requestedGstin: GSTIN,
  normalizedGstin: GSTIN,
  lookupGstin: GSTIN,
  returnedGstin: GSTIN,
  mode: 'LIVE',
  level: 'COMPLETE',
  governmentStatus: 'ACTIVE',
  legalName: 'Synthetic Co',
  tradeName: null,
  taxpayerType: 'Regular',
  registrationDate: null,
  registeredAddress: null,
  businessConstitution: null,
  filingFrequency: 'Monthly',
  gstr1FiledTill: '2026-10',
  gstr3bFiledTill: '2026-10',
  partial: false,
  unavailable: [],
  retrievedAt: '2026-11-02T06:00:00Z',
  expiresAt: '2026-11-09T06:00:00Z',
  ttlSeconds: 604800,
  estimatedCredits: 2,
  actualCredits: null,
  billingCategory: null,
  ...overrides,
});
const view = (overrides: Partial<GstVerificationView> = {}): GstVerificationView => ({
  enabled: true,
  mode: 'LIVE',
  level: 'COMPLETE',
  canVerify: true,
  canRefresh: false,
  cacheState: 'FRESH',
  evidence: evidence(),
  latestFailure: null,
  ...overrides,
});

describe('deriveGstinFieldStatus', () => {
  it('is verified only for fresh Live evidence of this GSTIN at the required level', () => {
    expect(deriveGstinFieldStatus(view(), GSTIN, NOW)).toEqual({ kind: 'verified' });
  });
  it('makes no claim without a view, evidence, or when verification is off', () => {
    expect(deriveGstinFieldStatus(undefined, GSTIN, NOW).kind).toBe('none');
    expect(deriveGstinFieldStatus(view({ evidence: null, cacheState: 'NONE' }), GSTIN, NOW).kind).toBe('none');
    expect(deriveGstinFieldStatus(view({ enabled: false }), GSTIN, NOW).kind).toBe('none');
  });
  it('never associates evidence with a different GSTIN', () => {
    expect(deriveGstinFieldStatus(view(), '29AAAAA0000A1Z5', NOW).kind).toBe('none');
  });
  it('does not accept a different returned GSTIN as verification', () => {
    const odd = view({ evidence: evidence({ returnedGstin: '00AAAAA0000A1ZT' }) });
    expect(deriveGstinFieldStatus(odd, GSTIN, NOW).kind).toBe('none');
  });
  it('flags expired evidence as stale, even when the last server read said fresh', () => {
    const expired = view({ evidence: evidence({ expiresAt: '2026-11-03T05:59:59Z' }) });
    expect(deriveGstinFieldStatus(expired, GSTIN, NOW)).toMatchObject({ kind: 'attention', reason: 'stale' });
    const serverStale = view({ cacheState: 'STALE' });
    expect(deriveGstinFieldStatus(serverStale, GSTIN, NOW)).toMatchObject({ reason: 'stale' });
  });
  it('does not let Basic evidence stand in for a required Complete Profile', () => {
    const basic = view({ cacheState: 'BASIC_ONLY', evidence: evidence({ level: 'BASIC' }) });
    expect(deriveGstinFieldStatus(basic, GSTIN, NOW)).toMatchObject({ kind: 'attention', reason: 'basic-only' });
    // Even if a server response were to claim FRESH.
    const claimedFresh = view({ evidence: evidence({ level: 'BASIC' }) });
    expect(deriveGstinFieldStatus(claimedFresh, GSTIN, NOW)).toMatchObject({ reason: 'basic-only' });
  });
  it('accepts Basic evidence when Basic is the required level', () => {
    const basic = view({ level: 'BASIC', evidence: evidence({ level: 'BASIC' }) });
    expect(deriveGstinFieldStatus(basic, GSTIN, NOW)).toEqual({ kind: 'verified' });
  });
  it('treats Demo evidence as a sample, never as verification', () => {
    const demo = view({ mode: 'DEMO', evidence: evidence({ mode: 'DEMO', returnedGstin: '00AAAAA0000A1ZT' }) });
    expect(deriveGstinFieldStatus(demo, GSTIN, NOW)).toEqual({ kind: 'demo' });
  });
  it('ignores Demo evidence when the current mode is Live', () => {
    const mixed = view({ mode: 'LIVE', evidence: evidence({ mode: 'DEMO' }) });
    expect(deriveGstinFieldStatus(mixed, GSTIN, NOW).kind).toBe('none');
  });
  it.each(['CANCELLED', 'SUSPENDED', 'UNKNOWN'] as const)(
    'does not show a green check for a %s registration',
    (governmentStatus) => {
      const result = deriveGstinFieldStatus(view({ evidence: evidence({ governmentStatus }) }), GSTIN, NOW);
      expect(result).toMatchObject({ kind: 'attention', reason: 'registration' });
    },
  );
});
