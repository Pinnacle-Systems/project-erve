import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { createGstComplianceSettingsService } from './gst-compliance-settings.service.js';
import { updateGstComplianceSettingsSchema } from './gst-compliance-settings.validation.js';
import { createMemorySettingsRepository } from './test/memory-settings-repository.js';

const actor = (roles: CurrentUser['roles'] = ['ACCOUNTANT']): CurrentUser => ({
  id: 'accountant', name: 'Accounts', email: 'accounts@example.test', mobile: null,
  status: 'ACTIVE', authVersion: 1, roles, distributorIds: [], factoryIds: [],
});
const setup = (authorized = false) => {
  const repository = createMemorySettingsRepository();
  const service = createGstComplianceSettingsService(repository, () => authorized);
  return { repository, service };
};

describe('GST compliance settings', () => {
  it('reads safe defaults without persisting or auditing', async () => {
    const { service, repository } = setup();
    expect(await service.read(actor())).toMatchObject({
      integrationMode: 'DEMO', gstinVerificationLevel: 'BASIC',
      onlineGstinVerificationEnabled: false, ewayBillGenerationEnabled: false,
      version: 0, updatedAt: null, updatedBy: null,
      capabilities: { liveActivationAvailable: false, onlineVerificationAvailable: false, ewayBillGenerationAvailable: false },
    });
    expect(repository.snapshot()).toEqual({ row: null, audits: [] });
  });

  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER', 'DISTRIBUTOR'] as const)(
    'rejects %s writes at the service boundary', async (role) => {
      const { service, repository } = setup();
      await expect(service.update(actor([role]), { expectedVersion: 0, gstinVerificationLevel: 'COMPLETE' }))
        .rejects.toMatchObject({ statusCode: 403 });
      expect(repository.snapshot().row).toBeNull();
    },
  );

  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER', 'DISTRIBUTOR'] as const)(
    'rejects %s configuration and audit reads', async (role) => {
      const { service } = setup();
      await expect(service.read(actor([role]))).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.history(actor([role]))).rejects.toMatchObject({ statusCode: 403 });
    },
  );

  it('persists independent preferences, preserves them across reads and audits before/after', async () => {
    const { service, repository } = setup();
    const saved = await service.update(actor(), { expectedVersion: 0, gstinVerificationLevel: 'COMPLETE' });
    expect(saved).toMatchObject({ version: 1, gstinVerificationLevel: 'COMPLETE', onlineGstinVerificationEnabled: false });
    expect(saved.updatedBy).toEqual({ id: 'accountant', name: 'Accounts' });
    expect(saved.updatedAt).toBeTruthy();
    await service.update(actor(), { expectedVersion: 1, onlineGstinVerificationEnabled: true });
    expect(await service.read(actor(['ADMIN']))).toMatchObject({ version: 2, gstinVerificationLevel: 'COMPLETE', onlineGstinVerificationEnabled: true });
    expect(repository.snapshot().audits[0]).toMatchObject({
      actorId: 'accountant', action: 'GST_COMPLIANCE_SETTINGS_UPDATED',
      metadata: { previous: { gstinVerificationLevel: 'BASIC', version: 0 }, next: { gstinVerificationLevel: 'COMPLETE', version: 1 } },
    });
    expect(await service.history(actor())).toHaveLength(2);
  });

  it('rejects stale initial and subsequent updates without changing state', async () => {
    const { service, repository } = setup();
    await expect(service.update(actor(), { expectedVersion: 3, onlineGstinVerificationEnabled: true })).rejects.toMatchObject({ statusCode: 409 });
    await service.update(actor(), { expectedVersion: 0, gstinVerificationLevel: 'COMPLETE' });
    const before = repository.snapshot();
    await expect(service.update(actor(), { expectedVersion: 0, onlineGstinVerificationEnabled: true })).rejects.toMatchObject({ statusCode: 409 });
    expect(repository.snapshot()).toEqual(before);
  });

  it('does not rewrite or audit a no-op', async () => {
    const { service, repository } = setup();
    await service.update(actor(), { expectedVersion: 0, integrationMode: 'DEMO' });
    expect(repository.snapshot()).toEqual({ row: null, audits: [] });
  });

  it('rolls back the settings when auditing fails', async () => {
    const { service, repository } = setup();
    repository.failAudit = true;
    await expect(service.update(actor(), { expectedVersion: 0, onlineGstinVerificationEnabled: true })).rejects.toThrow('Audit unavailable');
    expect(repository.snapshot()).toEqual({ row: null, audits: [] });
  });

  it('rejects Live activation without server authorization even with confirmation', async () => {
    const { service, repository } = setup();
    await expect(service.update(actor(), { expectedVersion: 0, integrationMode: 'LIVE', confirmLiveActivation: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.snapshot().row).toBeNull();
  });

  it('requires confirmation, then permits authorized Live activation and return to Demo without external calls', async () => {
    const fetch = vi.fn(() => { throw new Error('No network permitted'); });
    vi.stubGlobal('fetch', fetch);
    try {
      const { service } = setup(true);
      await expect(service.update(actor(), { expectedVersion: 0, integrationMode: 'LIVE' })).rejects.toMatchObject({ statusCode: 400 });
      expect(await service.update(actor(), { expectedVersion: 0, integrationMode: 'LIVE', confirmLiveActivation: true })).toMatchObject({ integrationMode: 'LIVE', version: 1 });
      expect(await service.update(actor(), { expectedVersion: 1, integrationMode: 'DEMO', gstinVerificationLevel: 'COMPLETE' })).toMatchObject({ integrationMode: 'DEMO', version: 2 });
      await service.read(actor());
      await service.history(actor());
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects unsupported generation even when Live is authorized', async () => {
    const { service, repository } = setup(true);
    await expect(service.update(actor(), { expectedVersion: 0, ewayBillGenerationEnabled: true })).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.snapshot().row).toBeNull();
  });

  it.each([
    { expectedVersion: 0, apiKey: 'secret' },
    { expectedVersion: 0, integrationMode: 'SANDBOX' },
    { expectedVersion: 0, gstinVerificationLevel: 'ALL' },
    { expectedVersion: 0, onlineGstinVerificationEnabled: 'false' },
    { expectedVersion: -1, integrationMode: 'DEMO' },
    { expectedVersion: 0 },
    { expectedVersion: 0, confirmLiveActivation: true },
  ])('rejects malformed or unsupported update %j', (input) => {
    expect(updateGstComplianceSettingsSchema.safeParse(input).success).toBe(false);
  });
});
