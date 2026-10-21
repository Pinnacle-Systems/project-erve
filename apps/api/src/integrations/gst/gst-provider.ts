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
export class GstProviderError extends Error {
  constructor(
    public code: GstVerificationFailure,
    public uncertain = false,
  ) {
    super('GST verification could not be completed');
  }
}
