import type {
  GstIntegrationMode,
  GstinVerificationLevel,
  GstRegistrationProfile,
  GstVerificationFailure,
} from '@erve/types';

export interface GstProviderResult extends GstRegistrationProfile {
  lookupGstin: string;
  returnedGstin: string;
  actualCredits: number | null;
  billingCategory: string | null;
  balance: number | null;
}
export interface GstProvider {
  lookup(input: {
    gstin: string;
    mode: GstIntegrationMode;
    level: GstinVerificationLevel;
  }): Promise<GstProviderResult>;
}
/** Raw provider counters for today. Not a balance; carries no credentials. */
export interface GstUsageCounters {
  totalCalls: number;
  successfulCalls: number;
  errorCalls: number;
  creditsUsed: number;
}
/** Read-only monitoring, deliberately separate from `GstProvider` lookups. */
export interface GstUsageProvider {
  usageToday(): Promise<GstUsageCounters>;
}
export class GstProviderError extends Error {
  constructor(
    public code: GstVerificationFailure,
    public uncertain = false,
  ) {
    super('GST verification could not be completed');
  }
}
