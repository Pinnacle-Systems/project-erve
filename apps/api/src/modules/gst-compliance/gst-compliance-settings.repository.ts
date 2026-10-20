import type { GstComplianceSettingsAudit } from '@erve/types';
import { prisma, type Prisma } from '../../db/prisma.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { HttpError } from '../../errors/http-error.js';
import type { SettingsRecord, SettingsRepository } from './gst-compliance-settings.service.js';

// A later seller-scope resolver can change repository lookup without coupling
// callers to storage keys or duplicating business authorization.
const APPLICATION_SCOPE = 'APPLICATION';
const include = { updatedBy: { select: { id: true, name: true } } } as const;
type Row = Prisma.GstComplianceSettingsGetPayload<{ include: typeof include }>;
function toRecord(row: Row): SettingsRecord {
  return {
    integrationMode: row.integrationMode,
    onlineGstinVerificationEnabled: row.onlineGstinVerificationEnabled,
    gstinVerificationLevel: row.gstinVerificationLevel,
    ewayBillGenerationEnabled: row.ewayBillGenerationEnabled,
    version: row.version, updatedAt: row.updatedAt.toISOString(), updatedBy: row.updatedBy,
  };
}

export const gstComplianceSettingsRepository: SettingsRepository = {
  async read() {
    const row = await prisma.gstComplianceSettings.findUnique({ where: { scope: APPLICATION_SCOPE }, include });
    return row ? toRecord(row) : null;
  },
  async history() {
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'GstComplianceSettings', entityId: APPLICATION_SCOPE, action: 'GST_COMPLIANCE_SETTINGS_UPDATED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, createdAt: true, actor: { select: { id: true, name: true } }, metadata: true },
    });
    return rows.map((row): GstComplianceSettingsAudit => {
      const metadata = row.metadata as unknown as Pick<GstComplianceSettingsAudit, 'previous' | 'next'>;
      return { id: row.id, createdAt: row.createdAt.toISOString(), actor: row.actor, previous: metadata.previous, next: metadata.next };
    });
  },
  async transaction(work) {
    return prisma.$transaction(async (tx) => {
      // Includes the absent-row case; two first writers must not both accept v0.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'gst-compliance-settings:APPLICATION'}))`;
      return work({
        read: async () => {
          const row = await tx.gstComplianceSettings.findUnique({ where: { scope: APPLICATION_SCOPE }, include });
          return row ? toRecord(row) : null;
        },
        save: async (values, expectedVersion, actor) => {
          if (expectedVersion === 0) {
            return toRecord(await tx.gstComplianceSettings.create({
              data: { scope: APPLICATION_SCOPE, ...values, updatedById: actor.id }, include,
            }));
          }
          const updated = await tx.gstComplianceSettings.updateMany({
            where: { scope: APPLICATION_SCOPE, version: expectedVersion },
            data: { ...values, updatedById: actor.id, version: { increment: 1 } },
          });
          if (updated.count !== 1) throw HttpError.conflict('GST Compliance Settings changed. Reload before saving.');
          return toRecord(await tx.gstComplianceSettings.findUniqueOrThrow({ where: { scope: APPLICATION_SCOPE }, include }));
        },
        audit: async (input) => recordAuditLog({
          actorId: input.actorId, action: input.action,
          entityType: 'GstComplianceSettings', entityId: APPLICATION_SCOPE,
          metadata: { previous: { ...input.metadata.previous }, next: { ...input.metadata.next } },
        }, tx),
      });
    });
  },
};
