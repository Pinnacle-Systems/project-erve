import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GST_DRAFT_SOURCE_ID } from '@erve/shared';
import type { GstComplianceValues, GstVerificationEvidence } from '@erve/types';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import type { GstProvider } from '../../integrations/gst/gst-provider.js';

const mocks = vi.hoisted(() => ({
  getDistributorById: vi.fn(),
  getFactoryById: vi.fn(),
  getRetailStore: vi.fn(),
  getSaleOrderDetail: vi.fn(),
  sellerFindUnique: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    sellerRegistration: { findUnique: mocks.sellerFindUnique },
    saleOrderDestination: { findUnique: vi.fn() },
  },
}));
vi.mock('../master-data/master-data.service.js', () => ({
  getDistributorById: mocks.getDistributorById,
  getFactoryById: mocks.getFactoryById,
}));
vi.mock('../master-data/retail-stores.service.js', () => ({ getRetailStore: mocks.getRetailStore }));
vi.mock('../sale-orders/sale-orders.service.js', () => ({
  getSaleOrderDetail: mocks.getSaleOrderDetail,
}));

import { authorizeGstVerificationTarget } from './gstin-verification.access.js';
import {
  createGstinVerificationService,
  type VerificationIntent,
  type VerificationRepository,
} from './gstin-verification.service.js';

const actor = (roles: CurrentUser['roles']): CurrentUser => ({
  id: `actor-${roles.join('-')}`,
  name: 'Synthetic',
  email: 'synthetic@example.test',
  mobile: null,
  status: 'ACTIVE',
  authVersion: 1,
  roles,
  distributorIds: [],
  factoryIds: [],
});
const GSTIN = '33AAAAA0000A1Z5';
const draft = (type: 'DISTRIBUTOR' | 'RETAIL_STORE' | 'SELLER_REGISTRATION' | 'FACTORY') => ({
  gstin: GSTIN,
  source: { type, id: GST_DRAFT_SOURCE_ID },
});

beforeEach(() => vi.clearAllMocks());

describe('unsaved (draft) GSTIN source authorization', () => {
  it.each([
    ['DISTRIBUTOR', ['ADMIN'], true],
    ['DISTRIBUTOR', ['MERCHANDISER'], true],
    ['DISTRIBUTOR', ['SENIOR_MANAGEMENT'], false],
    ['DISTRIBUTOR', ['DISTRIBUTOR'], false],
    ['DISTRIBUTOR', ['ACCOUNTANT'], false],
    ['FACTORY', ['ADMIN'], true],
    ['FACTORY', ['MERCHANDISER'], true],
    ['FACTORY', ['FACTORY_USER'], false],
    ['RETAIL_STORE', ['MERCHANDISER'], true],
    ['RETAIL_STORE', ['SENIOR_MANAGEMENT'], false],
    ['SELLER_REGISTRATION', ['ADMIN'], true],
    ['SELLER_REGISTRATION', ['MERCHANDISER'], false],
  ] as const)('%s with %j allowed=%s', async (type, roles, allowed) => {
    const result = authorizeGstVerificationTarget(actor([...roles]), draft(type));
    if (allowed) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toMatchObject({ statusCode: 403 });
    // No record exists, so no record is looked up.
    expect(mocks.getDistributorById).not.toHaveBeenCalled();
    expect(mocks.getFactoryById).not.toHaveBeenCalled();
    expect(mocks.getRetailStore).not.toHaveBeenCalled();
    expect(mocks.sellerFindUnique).not.toHaveBeenCalled();
  });

  it('never supports an unsaved Dispatch Order destination', async () => {
    await expect(
      authorizeGstVerificationTarget(actor(['ADMIN', 'ACCOUNTANT']), {
        gstin: GSTIN,
        source: { type: 'DISPATCH_ORDER', id: GST_DRAFT_SOURCE_ID },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('keeps source-less verification Accountant-only', async () => {
    await expect(
      authorizeGstVerificationTarget(actor(['ADMIN']), { gstin: GSTIN }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('saved Factory source', () => {
  it('requires the saved GSTIN to match and loads the Factory through the access-checked service', async () => {
    mocks.getFactoryById.mockResolvedValue({ gstin: GSTIN });
    await expect(
      authorizeGstVerificationTarget(actor(['MERCHANDISER']), {
        gstin: GSTIN,
        source: { type: 'FACTORY', id: 'fac-1' },
      }),
    ).resolves.toBeUndefined();
    mocks.getFactoryById.mockResolvedValue({ gstin: null });
    await expect(
      authorizeGstVerificationTarget(actor(['MERCHANDISER']), {
        gstin: GSTIN,
        source: { type: 'FACTORY', id: 'fac-1' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it('rejects roles that cannot view Factories', async () => {
    await expect(
      authorizeGstVerificationTarget(actor(['FACTORY_USER']), {
        gstin: GSTIN,
        source: { type: 'FACTORY', id: 'fac-1' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.getFactoryById).not.toHaveBeenCalled();
  });
});

function build(mode: 'DEMO' | 'LIVE') {
  const values: GstComplianceValues & { version: number } = {
    integrationMode: mode,
    onlineGstinVerificationEnabled: true,
    gstinVerificationLevel: 'COMPLETE',
    ewayBillGenerationEnabled: false,
    version: 1,
  };
  const evidence: GstVerificationEvidence[] = [];
  const intents = new Map<string, VerificationIntent>();
  const repository: VerificationRepository = {
    evidence: async (g, m) => evidence.filter((r) => r.normalizedGstin === g && r.mode === m),
    latestFailure: async () => null,
    history: async () => [],
    prepare: async (intent) => void intents.set(intent.id, intent),
    intent: async (id) => intents.get(id) ?? null,
    claim: async (intent) => {
      intent.outcome = 'DISPATCHED';
      return true;
    },
    complete: async (intent, result) => {
      evidence.unshift(result);
      intent.outcome = 'SUCCEEDED';
    },
    fail: async () => undefined,
    cacheHit: async () => undefined,
  };
  const provider = {
    lookup: vi.fn<GstProvider['lookup']>(async () => ({
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
      lookupGstin: GSTIN,
      returnedGstin: GSTIN,
      actualCredits: null,
      billingCategory: null,
      balance: null,
    })),
  };
  // The real authorizer, so the full gate (source + settings) is exercised.
  const service = createGstinVerificationService({
    repository,
    provider,
    settings: async () => values,
    authorizeTarget: authorizeGstVerificationTarget,
    liveActivationAuthorized: () => true,
    liveLookupAuthorized: () => true,
    ttlSeconds: { BASIC: 604800, COMPLETE: 604800 },
  });
  return { service, provider, evidence };
}

describe('verification before the record is saved', () => {
  it('Demo: an authorized Merchandiser prepares and executes from the create form', async () => {
    const s = build('DEMO');
    const user = actor(['MERCHANDISER']);
    const view = await s.service.read(user, draft('DISTRIBUTOR'));
    expect(view).toMatchObject({ canVerify: true, cacheState: 'NONE' });
    const prepared = await s.service.prepare(user, draft('DISTRIBUTOR'));
    if (prepared.kind !== 'CONFIRMATION') throw new Error('Expected confirmation');
    expect(s.provider.lookup).not.toHaveBeenCalled();
    const result = await s.service.execute(user, prepared.intentId);
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
    expect(result.evidence).toMatchObject({ mode: 'DEMO', normalizedGstin: GSTIN });
  });

  it('Live: prepare stops at a confirmation and never reaches the provider by itself', async () => {
    const s = build('LIVE');
    const user = actor(['ADMIN', 'ACCOUNTANT']);
    const prepared = await s.service.prepare(user, draft('FACTORY'));
    expect(prepared).toMatchObject({ kind: 'CONFIRMATION', mode: 'LIVE', estimatedCredits: 2 });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });

  it.each([['MERCHANDISER'], ['ADMIN']] as const)(
    'Live: a non-Accountant %s cannot verify from a create form and can only read the cache',
    async (role) => {
      const s = build('LIVE');
      const user = actor([role]);
      expect(await s.service.read(user, draft('DISTRIBUTOR'))).toMatchObject({
        canVerify: false,
        canRefresh: false,
      });
      await expect(s.service.prepare(user, draft('DISTRIBUTOR'))).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(s.provider.lookup).not.toHaveBeenCalled();
    },
  );

  it('rejects roles without create/edit rights on that master before touching settings or the provider', async () => {
    const s = build('DEMO');
    const user = actor(['SENIOR_MANAGEMENT']);
    await expect(s.service.read(user, draft('DISTRIBUTOR'))).rejects.toBeInstanceOf(HttpError);
    await expect(s.service.prepare(user, draft('DISTRIBUTOR'))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(s.provider.lookup).not.toHaveBeenCalled();
  });

  it('shares cached evidence with the saved record instead of looking the GSTIN up again', async () => {
    const s = build('DEMO');
    const user = actor(['ADMIN']);
    const prepared = await s.service.prepare(user, draft('SELLER_REGISTRATION'));
    if (prepared.kind !== 'CONFIRMATION') throw new Error('Expected confirmation');
    await s.service.execute(user, prepared.intentId);
    const again = await s.service.prepare(user, draft('SELLER_REGISTRATION'));
    expect(again.kind).toBe('RESULT');
    expect(s.provider.lookup).toHaveBeenCalledTimes(1);
  });

  it('cannot start a destination lookup even with a draft id', async () => {
    const s = build('DEMO');
    await expect(
      s.service.prepare(actor(['ADMIN', 'ACCOUNTANT']), {
        gstin: GSTIN,
        source: { type: 'DISPATCH_ORDER', id: GST_DRAFT_SOURCE_ID },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
