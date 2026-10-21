export type GstIntegrationMode = 'DEMO' | 'LIVE';
export type GstinVerificationLevel = 'BASIC' | 'COMPLETE';

export interface GstComplianceValues {
  integrationMode: GstIntegrationMode;
  onlineGstinVerificationEnabled: boolean;
  gstinVerificationLevel: GstinVerificationLevel;
  ewayBillGenerationEnabled: boolean;
}

export interface GstComplianceSettings extends GstComplianceValues {
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  capabilities: {
    liveActivationAvailable: boolean;
    onlineVerificationAvailable: boolean;
    ewayBillGenerationAvailable: false;
  };
}

export interface UpdateGstComplianceSettings extends Partial<GstComplianceValues> {
  expectedVersion: number;
  confirmLiveActivation?: boolean;
}

export interface GstComplianceSettingsAudit {
  id: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  previous: GstComplianceValues & { version: number };
  next: GstComplianceValues & { version: number };
}
