import {
  canManageGstComplianceSettings, canViewGstComplianceSettings,
} from '@erve/shared';
import type { GstComplianceSettings, GstComplianceSettingsAudit, GstComplianceValues, UpdateGstComplianceSettings } from '@erve/types';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { updateGstComplianceSettingsSchema } from './gst-compliance-settings.validation.js';

export type SettingsRecord = GstComplianceValues & Pick<GstComplianceSettings, 'version' | 'updatedAt' | 'updatedBy'>;
export interface SettingsAuditInput {
  actorId: string;
  action: 'GST_COMPLIANCE_SETTINGS_UPDATED';
  metadata: { previous: GstComplianceValues & { version: number }; next: GstComplianceValues & { version: number } };
}
export interface SettingsTransaction {
  read(): Promise<SettingsRecord | null>;
  save(values: GstComplianceValues, expectedVersion: number, actor: CurrentUser): Promise<SettingsRecord>;
  audit(input: SettingsAuditInput): Promise<void>;
}
export interface SettingsRepository {
  read(): Promise<SettingsRecord | null>;
  history(): Promise<GstComplianceSettingsAudit[]>;
  transaction<T>(work: (tx: SettingsTransaction) => Promise<T>): Promise<T>;
}

export const DEFAULT_GST_COMPLIANCE_VALUES: Readonly<GstComplianceValues> = Object.freeze({
  integrationMode: 'DEMO', onlineGstinVerificationEnabled: false,
  gstinVerificationLevel: 'BASIC', ewayBillGenerationEnabled: false,
});

function valuesOf(record: GstComplianceValues): GstComplianceValues {
  return {
    integrationMode: record.integrationMode,
    onlineGstinVerificationEnabled: record.onlineGstinVerificationEnabled,
    gstinVerificationLevel: record.gstinVerificationLevel,
    ewayBillGenerationEnabled: record.ewayBillGenerationEnabled,
  };
}

export function createGstComplianceSettingsService(repository: SettingsRepository, liveAuthorized: () => boolean) {
  const effective = (record: SettingsRecord | null): SettingsRecord => record ?? {
    ...DEFAULT_GST_COMPLIANCE_VALUES, version: 0, updatedAt: null, updatedBy: null,
  };
  const view = (record: SettingsRecord): GstComplianceSettings => ({
    ...record,
    capabilities: {
      liveActivationAvailable: liveAuthorized(), onlineVerificationAvailable: false, ewayBillGenerationAvailable: false,
    },
  });
  function assertRead(actor: CurrentUser) {
    if (!canViewGstComplianceSettings(actor)) throw HttpError.forbidden('You do not have permission to view GST Compliance Settings');
  }
  return {
    async read(actor: CurrentUser): Promise<GstComplianceSettings> {
      assertRead(actor);
      return view(effective(await repository.read()));
    },
    async history(actor: CurrentUser) {
      assertRead(actor);
      return repository.history();
    },
    async update(actor: CurrentUser, input: UpdateGstComplianceSettings): Promise<GstComplianceSettings> {
      if (!canManageGstComplianceSettings(actor)) throw HttpError.forbidden('Only an Accountant may modify GST Compliance Settings');
      // Validate again for direct service callers and future background operations.
      const { expectedVersion, confirmLiveActivation, ...changes } = updateGstComplianceSettingsSchema.parse(input);
      return repository.transaction(async (tx) => {
        const previous = effective(await tx.read());
        if (previous.version !== expectedVersion) {
          throw HttpError.conflict('GST Compliance Settings changed. Reload the latest settings before saving.', { currentVersion: previous.version });
        }
        const next = { ...valuesOf(previous), ...changes };
        if (next.ewayBillGenerationEnabled) throw HttpError.badRequest('E-Way Bill generation is not yet available');
        if (next.integrationMode === 'LIVE' && !liveAuthorized()) {
          throw HttpError.forbidden('Live Mode cannot be activated because server-side production authorization is not enabled. Demo Mode remains available.');
        }
        if (next.integrationMode === 'LIVE' && previous.integrationMode !== 'LIVE' && confirmLiveActivation !== true) {
          throw HttpError.badRequest('Confirm activation of Live Mode before saving');
        }
        if (JSON.stringify(valuesOf(previous)) === JSON.stringify(next)) return view(previous);
        const saved = await tx.save(next, expectedVersion, actor);
        await tx.audit({
          actorId: actor.id, action: 'GST_COMPLIANCE_SETTINGS_UPDATED',
          metadata: { previous: { ...valuesOf(previous), version: previous.version }, next: { ...next, version: saved.version } },
        });
        return view(saved);
      });
    },
  };
}

export type GstComplianceSettingsService = ReturnType<typeof createGstComplianceSettingsService>;
