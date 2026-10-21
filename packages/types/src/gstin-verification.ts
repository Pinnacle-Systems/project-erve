import type { GstIntegrationMode, GstinVerificationLevel } from './gst-compliance.js';

export type GstGovernmentStatus = 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'UNKNOWN';
export type GstVerificationFailure =
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION'
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNEXPECTED_RESPONSE';
export type GstSourceType =
  'DISTRIBUTOR' | 'SELLER_REGISTRATION' | 'RETAIL_STORE' | 'DISPATCH_ORDER';
export interface GstVerificationSource {
  type: GstSourceType;
  id: string;
}
export interface GstVerificationTarget {
  gstin: string;
  source?: GstVerificationSource;
}
export interface GstRegistrationProfile {
  governmentStatus: GstGovernmentStatus;
  legalName: string | null;
  tradeName: string | null;
  taxpayerType: string | null;
  registrationDate: string | null;
  registeredAddress: string | null;
  businessConstitution: string | null;
  filingFrequency: string | null;
  gstr1FiledTill: string | null;
  gstr3bFiledTill: string | null;
  partial: boolean;
  unavailable: string[];
}
export interface GstVerificationEvidence extends GstRegistrationProfile {
  id: string;
  requestedGstin: string;
  normalizedGstin: string;
  lookupGstin: string;
  returnedGstin: string;
  mode: GstIntegrationMode;
  level: GstinVerificationLevel;
  retrievedAt: string;
  expiresAt: string;
  ttlSeconds: number;
  estimatedCredits: number;
  actualCredits: number | null;
  billingCategory: string | null;
}
export interface GstVerificationView {
  enabled: boolean;
  mode: GstIntegrationMode;
  level: GstinVerificationLevel;
  canVerify: boolean;
  canRefresh: boolean;
  cacheState: 'NONE' | 'FRESH' | 'STALE' | 'BASIC_ONLY';
  evidence: GstVerificationEvidence | null;
  latestFailure: GstVerificationFailure | null;
}
export type GstVerificationPreparation =
  | { kind: 'RESULT'; view: GstVerificationView }
  | {
      kind: 'CONFIRMATION';
      intentId: string;
      gstin: string;
      mode: GstIntegrationMode;
      level: GstinVerificationLevel;
      estimatedCredits: number;
      freshCacheAvailable: boolean;
      refresh: boolean;
      expiresAt: string;
    };
export interface GstVerificationAttempt {
  id: string;
  createdAt: string;
  outcome: string;
  failureCode: GstVerificationFailure | null;
  refresh: boolean;
  estimatedCredits: number;
  evidence: GstVerificationEvidence | null;
}
