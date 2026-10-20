import type { GstComplianceSettingsAudit } from '@erve/types';
import type { SettingsAuditInput, SettingsRecord, SettingsRepository } from '../gst-compliance-settings.service.js';

// Transactional test double: exceptions discard both the settings and audit.
export function createMemorySettingsRepository() {
  let row: SettingsRecord | null = null;
  let audits: (SettingsAuditInput & { id: string; createdAt: string })[] = [];
  const repository: SettingsRepository & { failAudit: boolean; snapshot(): { row: SettingsRecord | null; audits: typeof audits } } = {
    failAudit: false,
    snapshot: () => structuredClone({ row, audits }),
    read: async () => structuredClone(row),
    history: async () => audits.map((event): GstComplianceSettingsAudit => ({
      id: event.id, createdAt: event.createdAt, actor: { id: event.actorId, name: 'Accounts' },
      ...event.metadata,
    })).reverse(),
    async transaction(work) {
      let nextRow = structuredClone(row);
      const nextAudits = structuredClone(audits);
      const result = await work({
        read: async () => structuredClone(nextRow),
        save: async (values, version, actor) => {
          nextRow = { ...values, version: version + 1, updatedAt: new Date().toISOString(), updatedBy: { id: actor.id, name: actor.name } };
          return structuredClone(nextRow);
        },
        audit: async (input) => {
          if (repository.failAudit) throw new Error('Audit unavailable');
          nextAudits.push({ ...input, id: `audit-${nextAudits.length + 1}`, createdAt: new Date().toISOString() });
        },
      });
      row = nextRow;
      audits = nextAudits;
      return result;
    },
  };
  return repository;
}
