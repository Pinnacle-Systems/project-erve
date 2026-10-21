import { describe, expect, it, vi } from 'vitest';
import type { GstComplianceValues, GstVerificationEvidence } from '@erve/types';
import {
  createGstinVerificationService,
  type VerificationRepository,
  type VerificationIntent,
} from './gstin-verification.service.js';
import { GstProviderError, type GstProvider } from '../../integrations/gst/gst-provider.js';
import type { CurrentUser } from '../../auth/current-user.js';

const actor = (roles: CurrentUser['roles'] = ['ACCOUNTANT']): CurrentUser => ({
  id: 'actor',
  name: 'Synthetic',
  email: 'synthetic@example.test',
  mobile: null,
  status: 'ACTIVE',
  authVersion: 1,
  roles,
  distributorIds: [],
  factoryIds: [],
});
const target = { gstin: '33AAAAA0000A1Z5' };
const now = new Date('2026-10-21T06:00:00Z');
const profile = {
  governmentStatus: 'ACTIVE' as const,
  legalName: 'Synthetic Co',
  tradeName: null,
  taxpayerType: 'Regular',
  registrationDate: null,
  registeredAddress: null,
  businessConstitution: null,
  filingFrequency: null,
  gstr1FiledTill: null,
  gstr3bFiledTill: null,
  partial: false,
  unavailable: [],
};
function setup() {
  let values: GstComplianceValues & { version: number } = {
    integrationMode: 'LIVE',
    onlineGstinVerificationEnabled: true,
    gstinVerificationLevel: 'BASIC',
    ewayBillGenerationEnabled: false,
    version: 1,
  };
  let live = true;
  let execution = true;
  const evidence: GstVerificationEvidence[] = [];
  const intents = new Map<string, VerificationIntent>();
  const claims = new Set<string>();
  const failures: string[] = [];
  const repository: VerificationRepository = {
    async evidence(gstin, mode) {
      return evidence.filter((row) => row.normalizedGstin === gstin && row.mode === mode);
    },
    async latestFailure() {
      return null;
    },
    async history() {
      return [];
    },
    async prepare(intent) {
      intents.set(intent.id, intent);
    },
    async intent(id) {
      return intents.get(id) ?? null;
    },
    async claim(intent, key) {
      if (intents.get(intent.id)?.outcome !== 'PREPARED' || claims.has(key)) return false;
      claims.add(key);
      intent.outcome = 'DISPATCHED';
      return true;
    },
    async complete(intent, result) {
      evidence.unshift(result);
      intent.outcome = 'SUCCEEDED';
      claims.delete(intent.key!);
    },
    async fail(intent, code, uncertain) {
      failures.push(code);
      intent.outcome = uncertain ? 'UNCERTAIN' : 'FAILED';
      if (!uncertain) claims.delete(intent.key!);
    },
    async cacheHit(intent) {
      intent.outcome = 'CACHE_HIT';
      claims.delete(intent.key!);
    },
  };
  const provider = {
    lookup: vi.fn<GstProvider['lookup']>(async () => ({
      ...profile,
      lookupGstin: target.gstin,
      returnedGstin: target.gstin,
      actualCredits: null,
      billingCategory: null,
      balance: null,
    })),
  };
  const authorizeTarget = vi.fn(async () => undefined);
  const service = createGstinVerificationService({
    repository,
    provider,
    settings: async () => values,
    authorizeTarget,
    liveActivationAuthorized: () => live,
    liveLookupAuthorized: () => execution,
    ttlSeconds: { BASIC: 604800, COMPLETE: 604800 },
    now: () => now,
  });
  const seed = (
    level: 'BASIC' | 'COMPLETE' = 'BASIC',
    expiresAt = '2026-10-28T06:00:00Z',
    mode: 'DEMO' | 'LIVE' = 'LIVE',
  ) => {
    evidence.push({
      ...profile,
      id: 'old',
      requestedGstin: target.gstin,
      normalizedGstin: target.gstin,
      lookupGstin: target.gstin,
      returnedGstin: target.gstin,
      mode,
      level,
      retrievedAt: now.toISOString(),
      expiresAt,
      ttlSeconds: 604800,
      estimatedCredits: 1,
      actualCredits: null,
      billingCategory: null,
    });
  };
  return {
    service,
    provider,
    repository,
    evidence,
    intents,
    failures,
    seed,
    authorizeTarget,
    values,
    setValues: (next: Partial<typeof values>) => {
      values = { ...values, ...next };
    },
    revoke: () => {
      live = false;
    },
    revokeExecution: () => {
      execution = false;
    },
  };
}
async function prepared(s: ReturnType<typeof setup>, refresh = false) {
  const result = await s.service.prepare(actor(), target, refresh);
  if (result.kind !== 'CONFIRMATION') throw new Error('Expected confirmation');
  return result;
}
describe('GSTIN verification orchestration', () => {
  it('does not mistake fallback to older Complete evidence for a newly completed refresh', async () => {
    const s = setup();
    s.seed('COMPLETE');
    s.evidence[0]!.id = 'older-complete';
    s.evidence[0]!.retrievedAt = '2026-10-20T06:00:00Z';
    s.evidence.unshift({
      ...s.evidence[0]!,
      id: 'newer-basic',
      level: 'BASIC',
      retrievedAt: '2026-10-21T05:59:30Z',
      expiresAt: '2026-10-21T06:00:30Z',
    });
    const intent = await prepared(s, true);
    s.evidence[0]!.expiresAt = '2026-10-21T05:59:59Z';
    await s.service.execute(actor(), intent.intentId);
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
    expect(s.evidence).toHaveLength(3);
  });
  it('coalesces two refresh confirmations prepared against the same old evidence', async () => {
    const s = setup();
    s.seed();
    const first = await prepared(s, true);
    const second = await prepared(s, true);
    await s.service.execute(actor(), first.intentId);
    await s.service.execute(actor(), second.intentId);
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
    expect(s.evidence).toHaveLength(2);
    expect(s.intents.get(second.intentId)?.outcome).toBe('CACHE_HIT');
  });
  it('allows Factory users to read minimal policy but does not grant lookup initiation', async () => {
    const s = setup();
    expect(await s.service.policy(actor(['FACTORY_USER']))).toMatchObject({
      enabled: true,
      mode: 'LIVE',
    });
    await expect(s.service.prepare(actor(['FACTORY_USER']), target)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it('Live settings activation alone cannot grant paid execution', async () => {
    const s = setup();
    s.revokeExecution();
    await expect(s.service.prepare(actor(), target)).rejects.toMatchObject({ statusCode: 403 });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
  it('rejects invalid GSTINs before cache or transport', async () => {
    const s = setup();
    await expect(s.service.prepare(actor(), { gstin: 'invalid' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
  it('binds confirmation to its actor and expires unused confirmations', async () => {
    const s = setup();
    const intent = await prepared(s);
    await expect(
      s.service.execute({ ...actor(), id: 'someone-else' }, intent.intentId),
    ).rejects.toMatchObject({ statusCode: 404 });
    s.intents.get(intent.intentId)!.expiresAt = new Date('2026-10-21T05:00:00Z');
    await expect(s.service.execute(actor(), intent.intentId)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
  it('deduplicates normalized same-key concurrent confirmed requests', async () => {
    const s = setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.provider.lookup.mockImplementation(async () => {
      await wait;
      return {
        ...profile,
        lookupGstin: target.gstin,
        returnedGstin: target.gstin,
        actualCredits: null,
        billingCategory: null,
        balance: null,
      };
    });
    const first = await prepared(s);
    const second = await s.service.prepare(actor(), { gstin: ' 33aaaaa0000a1z5 ' });
    if (second.kind !== 'CONFIRMATION') throw new Error('Expected intent');
    const pending = s.service.execute(actor(), first.intentId);
    await vi.waitFor(() => expect(s.provider.lookup).toHaveBeenCalledTimes(1));
    await expect(s.service.execute(actor(), second.intentId)).rejects.toMatchObject({
      code: 'GST_IN_PROGRESS',
    });
    release();
    await pending;
    expect(s.evidence).toHaveLength(1);
  });
  it('keeps successful Demo evidence separate from prior Live evidence', async () => {
    const s = setup();
    s.seed();
    s.setValues({ integrationMode: 'DEMO' });
    s.provider.lookup.mockResolvedValue({
      ...profile,
      lookupGstin: '00AAAAA0000A1ZT',
      returnedGstin: '00AAAAA0000A1ZT',
      actualCredits: 0,
      billingCategory: 'test',
      balance: null,
    });
    const intent = await prepared(s);
    expect(intent.estimatedCredits).toBe(0);
    await s.service.execute(actor(), intent.intentId);
    expect(s.evidence.map((row) => row.mode)).toEqual(['DEMO', 'LIVE']);
    expect(s.evidence[0]).toMatchObject({
      requestedGstin: target.gstin,
      normalizedGstin: target.gstin,
      lookupGstin: '00AAAAA0000A1ZT',
    });
  });
  it('preserves partial Complete information in cache without another request', async () => {
    const s = setup();
    s.setValues({ gstinVerificationLevel: 'COMPLETE' });
    s.provider.lookup.mockResolvedValue({
      ...profile,
      partial: true,
      unavailable: ['gstr1_filed_till'],
      lookupGstin: target.gstin,
      returnedGstin: target.gstin,
      actualCredits: 2,
      billingCategory: 'credits',
      balance: 10,
    });
    const intent = await prepared(s);
    await s.service.execute(actor(), intent.intentId);
    expect((await s.service.prepare(actor(), target)).kind).toBe('RESULT');
    expect(s.evidence[0]).toMatchObject({
      partial: true,
      actualCredits: 2,
      estimatedCredits: 2,
      unavailable: ['gstr1_filed_till'],
    });
    expect(s.evidence[0]).not.toHaveProperty('balance');
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
  });
  it('does not show a late response against a changed saved GSTIN', async () => {
    const s = setup();
    const intent = await prepared(s);
    s.provider.lookup.mockImplementation(async () => {
      s.authorizeTarget.mockRejectedValue(new Error('Saved identity changed'));
      return {
        ...profile,
        lookupGstin: target.gstin,
        returnedGstin: target.gstin,
        actualCredits: null,
        billingCategory: null,
        balance: null,
      };
    });
    await expect(s.service.execute(actor(), intent.intentId)).rejects.toThrow(
      'Saved identity changed',
    );
    expect(s.evidence).toHaveLength(1);
    expect(s.intents.get(intent.intentId)?.outcome).toBe('SUCCEEDED');
  });
  it('keeps destination requests read-only even for Accountants', async () => {
    const s = setup();
    await expect(
      s.service.prepare(actor(), { ...target, source: { type: 'DISPATCH_ORDER', id: 'dest' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it('does not call the provider on reads, prepare or history; executes a single confirmed intent once', async () => {
    const s = setup();
    expect((await s.service.read(actor(), target)).cacheState).toBe('NONE');
    const intent = await prepared(s);
    await s.service.history(actor(), target);
    expect(s.provider.lookup).not.toHaveBeenCalled();
    const result = await s.service.execute(actor(), intent.intentId);
    expect(result.evidence).toMatchObject({
      normalizedGstin: target.gstin,
      expiresAt: '2026-10-28T06:00:00.000Z',
      actualCredits: null,
    });
    await s.service.execute(actor(), intent.intentId);
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
  });
  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR'] as const)(
    'denies paid %s initiation',
    async (role) => {
      const s = setup();
      await expect(s.service.prepare(actor([role]), target, false)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(s.provider.lookup).not.toHaveBeenCalled();
    },
  );
  it('rechecks settings version, mode and runtime authorization after confirmation', async () => {
    const s = setup();
    const intent = await prepared(s);
    s.setValues({ gstinVerificationLevel: 'COMPLETE', version: 2 });
    await expect(s.service.execute(actor(), intent.intentId)).rejects.toMatchObject({
      statusCode: 409,
    });
    s.setValues({ gstinVerificationLevel: 'BASIC', version: 1 });
    s.revoke();
    await expect(s.service.execute(actor(), intent.intentId)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
  it('OFF blocks preparation and all provider execution', async () => {
    const s = setup();
    s.setValues({ onlineGstinVerificationEnabled: false });
    await expect(s.service.prepare(actor(), target, false)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
  it.each(['BASIC', 'COMPLETE'] as const)(
    'fresh %s satisfies Basic without confirmation or provider call',
    async (level) => {
      const s = setup();
      s.seed(level);
      expect((await s.service.prepare(actor(), target, false)).kind).toBe('RESULT');
      expect(s.provider.lookup).not.toHaveBeenCalled();
    },
  );
  it('Basic cannot satisfy Complete; Demo cannot satisfy Live; stale remains visible without refresh', async () => {
    const s = setup();
    s.seed();
    s.setValues({ gstinVerificationLevel: 'COMPLETE' });
    expect((await s.service.read(actor(), target)).cacheState).toBe('BASIC_ONLY');
    expect((await prepared(s)).estimatedCredits).toBe(2);
    s.evidence.length = 0;
    s.seed('COMPLETE', '2026-10-21T06:00:00Z');
    expect((await s.service.read(actor(), target)).cacheState).toBe('STALE');
    s.evidence.length = 0;
    s.seed('COMPLETE', undefined, 'DEMO');
    expect((await s.service.read(actor(), target)).cacheState).toBe('NONE');
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
  it('rechecks cache after claiming and preserves old evidence on explicit refresh', async () => {
    const s = setup();
    const pending = await prepared(s);
    s.seed();
    await s.service.execute(actor(), pending.intentId);
    expect(s.provider.lookup).not.toHaveBeenCalled();
    const refresh = await prepared(s, true);
    await s.service.execute(actor(), refresh.intentId);
    expect(s.evidence).toHaveLength(2);
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
  });
  it('blocks a second operation while an outcome is uncertain, preserving successful history', async () => {
    const s = setup();
    s.seed();
    s.provider.lookup.mockRejectedValue(new GstProviderError('TIMEOUT', true));
    const first = await prepared(s, true);
    await expect(s.service.execute(actor(), first.intentId)).rejects.toMatchObject({
      code: 'GST_TIMEOUT',
    });
    const second = await prepared(s, true);
    await expect(s.service.execute(actor(), second.intentId)).rejects.toMatchObject({
      code: 'GST_IN_PROGRESS',
    });
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
    expect(s.evidence).toHaveLength(1);
  });
  it('rejects changed record identity before execution and never associates a late response with it', async () => {
    const s = setup();
    const intent = await prepared(s);
    s.authorizeTarget.mockRejectedValueOnce(new Error('GSTIN changed'));
    await expect(s.service.execute(actor(), intent.intentId)).rejects.toThrow('GSTIN changed');
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });
});
