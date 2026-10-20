import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { gstComplianceSettingsRepository } from './gst-compliance-settings.repository.js';

const db = vi.hoisted(() => ({
  gstComplianceSettings: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  auditLog: { findMany: vi.fn(), create: vi.fn() },
  $executeRaw: vi.fn(), $transaction: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({ prisma: db }));
const values = { integrationMode: 'DEMO', gstinVerificationLevel: 'COMPLETE', onlineGstinVerificationEnabled: false, ewayBillGenerationEnabled: false } as const;
const row = () => ({ ...values, scope: 'APPLICATION', version: 1, updatedAt: new Date('2026-10-20T10:00:00Z'), updatedById: 'accountant', updatedBy: { id: 'accountant', name: 'Accounts' } });
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((work) => work(db));
});

describe('Prisma repository contract without a database', () => {
  it('maps persisted settings to a safe DTO and reads no credentials', async () => {
    db.gstComplianceSettings.findUnique.mockResolvedValue(row());
    expect(await gstComplianceSettingsRepository.read()).toEqual({ ...values, version: 1, updatedAt: '2026-10-20T10:00:00.000Z', updatedBy: { id: 'accountant', name: 'Accounts' } });
    expect(db.gstComplianceSettings.findUnique).toHaveBeenCalledWith({ where: { scope: 'APPLICATION' }, include: { updatedBy: { select: { id: true, name: true } } } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('locks the application scope before reading and uses the same transaction for settings and audit', async () => {
    db.gstComplianceSettings.findUnique.mockResolvedValue(null);
    db.gstComplianceSettings.create.mockResolvedValue(row());
    await gstComplianceSettingsRepository.transaction(async (tx) => {
      expect(await tx.read()).toBeNull();
      await tx.save(values, 0, { id: 'accountant' } as CurrentUser);
      await tx.audit({ actorId: 'accountant', action: 'GST_COMPLIANCE_SETTINGS_UPDATED', metadata: { previous: { ...values, gstinVerificationLevel: 'BASIC', version: 0 }, next: { ...values, version: 1 } } });
    });
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.gstComplianceSettings.findUnique.mock.invocationCallOrder[0]!);
    expect(db.gstComplianceSettings.create).toHaveBeenCalledWith(expect.objectContaining({ data: { scope: 'APPLICATION', ...values, updatedById: 'accountant' } }));
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'accountant', action: 'GST_COMPLIANCE_SETTINGS_UPDATED', entityId: 'APPLICATION', entityType: 'GstComplianceSettings', metadata: { previous: { ...values, gstinVerificationLevel: 'BASIC', version: 0 }, next: { ...values, version: 1 } } }) });
  });
  it('uses a conditional version update and rejects lost writes', async () => {
    db.gstComplianceSettings.updateMany.mockResolvedValue({ count: 0 });
    await expect(gstComplianceSettingsRepository.transaction((tx) => tx.save(values, 4, { id: 'accountant' } as CurrentUser))).rejects.toMatchObject({ statusCode: 409 });
    expect(db.gstComplianceSettings.updateMany).toHaveBeenCalledWith({ where: { scope: 'APPLICATION', version: 4 }, data: { ...values, updatedById: 'accountant', version: { increment: 1 } } });
    expect(db.gstComplianceSettings.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('bounds and scopes audit reads and exposes only business history', async () => {
    db.auditLog.findMany.mockResolvedValue([{ id: 'event', createdAt: new Date('2026-10-20T10:00:00Z'), actor: { id: 'accountant', name: 'Accounts' }, metadata: { previous: { ...values, version: 0 }, next: { ...values, version: 1 }, internal: 'not exposed' } }]);
    const history = await gstComplianceSettingsRepository.history();
    expect(history[0]).not.toHaveProperty('internal');
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100, where: { entityType: 'GstComplianceSettings', entityId: 'APPLICATION', action: 'GST_COMPLIANCE_SETTINGS_UPDATED' } }));
  });
});
