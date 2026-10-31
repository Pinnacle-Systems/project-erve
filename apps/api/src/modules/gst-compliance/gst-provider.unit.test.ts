import { describe, it, expect, vi } from 'vitest';
import { GstinApiProvider } from '../../integrations/gst/gstin-api.provider.js';

const gstin = '33AAAAA0000A1Z5';
function body(complete = false, demo = false) {
  const id = demo ? '00AAAAA0000A1ZT' : gstin;
  const profile = {
    gstin: id,
    legal_name: 'Synthetic Company',
    trade_name: null,
    status: 'Active',
    taxpayer_type: 'Regular',
    registration_date: '2021-04-15',
    address: 'Synthetic address',
    filing_frequency: 'Monthly',
    gstr1_filed_till: '2026-08',
    gstr3b_filed_till: null,
  };
  return {
    success: true,
    gstin: id,
    ...(complete
      ? { profile, partial: true, unavailable: ['gstr3b_filed_till'] }
      : { data: profile }),
    ...(demo ? { test: true, billed_to: 'test', credits_charged: 0 } : {}),
    credits_remaining: 25,
  };
}
function setup(payload: unknown, status = 200) {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(payload), { status }),
  );
  return {
    fetcher,
    provider: new GstinApiProvider({ apiKey: 'secret-test-key', timeoutMs: 1000 }, fetcher),
  };
}
describe('GST verification adapter', () => {
  it('bounds streamed payload size and classifies successful malformed responses as uncertain', async () => {
    const { provider, fetcher } = setup({ ...body(), padding: 'x'.repeat(140000) });
    await expect(provider.lookup({ gstin, mode: 'LIVE', level: 'BASIC' })).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      uncertain: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds the entire request with a timeout and never retries uncertain network failures', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted synthetic request')),
          );
        }),
    );
    const provider = new GstinApiProvider({ apiKey: 'synthetic', timeoutMs: 10 }, fetcher);
    await expect(provider.lookup({ gstin, mode: 'LIVE', level: 'BASIC' })).rejects.toMatchObject({
      code: 'TIMEOUT',
      uncertain: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['Cancelled', 'CANCELLED'],
    ['Suspended', 'SUSPENDED'],
    ['Unexpected status', 'UNKNOWN'],
  ])('normalizes %s separately from internal master status', async (status, expected) => {
    const original = body();
    const { provider } = setup({
      ...original,
      data: { gstin, legal_name: 'Synthetic Company', status },
    });
    expect((await provider.lookup({ gstin, mode: 'LIVE', level: 'BASIC' })).governmentStatus).toBe(
      expected,
    );
  });
  it.each(['BASIC', 'COMPLETE'] as const)(
    'uses exactly one %s endpoint and header authentication',
    async (level) => {
      const { provider, fetcher } = setup(body(level === 'COMPLETE'));
      const result = await provider.lookup({ gstin, mode: 'LIVE', level });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]).toEqual([
        `https://www.gstinapi.in/v1/gstin/${gstin}${level === 'COMPLETE' ? '/complete' : ''}`,
        expect.objectContaining({
          headers: { 'x-api-key': 'secret-test-key', Accept: 'application/json' },
          redirect: 'error',
        }),
      ]);
      expect(result).toMatchObject({
        returnedGstin: gstin,
        governmentStatus: 'ACTIVE',
        legalName: 'Synthetic Company',
        actualCredits: null,
      });
    },
  );
  it('substitutes only the free identity in Demo and accepts explicit free markers', async () => {
    const { provider, fetcher } = setup(body(true, true));
    const result = await provider.lookup({ gstin, mode: 'DEMO', level: 'COMPLETE' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://www.gstinapi.in/v1/gstin/00AAAAA0000A1ZT/complete',
    );
    expect(result).toMatchObject({
      lookupGstin: '00AAAAA0000A1ZT',
      returnedGstin: '00AAAAA0000A1ZT',
      billingCategory: 'test',
      actualCredits: 0,
      partial: true,
      unavailable: ['gstr3b_filed_till'],
    });
  });
  it.each([{ test: false }, { billed_to: 'credits' }, { credits_charged: 1 }, { gstin }])(
    'rejects unsafe Demo markers/identity %j without retry',
    async (changes) => {
      const { provider, fetcher } = setup({ ...body(true, true), ...changes });
      await expect(
        provider.lookup({ gstin, mode: 'DEMO', level: 'COMPLETE' }),
      ).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'AUTHENTICATION'],
    [402, 'INSUFFICIENT_CREDITS'],
    [403, 'AUTHENTICATION'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [502, 'UNAVAILABLE'],
  ] as const)('sanitizes HTTP %s failures', async (status, code) => {
    const { provider, fetcher } = setup(
      { success: false, error: 'secret-test-key vendor internals' },
      status,
    );
    const error = await provider
      .lookup({ gstin, mode: 'LIVE', level: 'BASIC' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toMatch(/secret-test-key|vendor/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { success: true, gstin, data: { status: {} } },
    { ...body(), gstin: '27AAAAA0000A1Z5' },
  ])('rejects malformed or mismatched identities', async (payload) => {
    await expect(
      setup(payload).provider.lookup({ gstin, mode: 'LIVE', level: 'BASIC' }),
    ).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });
  it('rejects missing credentials before transport', async () => {
    const fetcher = vi.fn();
    await expect(
      new GstinApiProvider({ apiKey: '', timeoutMs: 1000 }, fetcher).lookup({
        gstin,
        mode: 'DEMO',
        level: 'BASIC',
      }),
    ).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// Responses observed from the real GSTINAPI sample GSTIN (2026-10). Not invented mocks.
const SAMPLE = '00AAAAA0000A1ZT';
const observedBasicDemo = () => ({
  success: true,
  gstin: SAMPLE,
  test: true,
  data: {
    gstin: SAMPLE,
    legal_name: 'GSTINAPI TEST PRIVATE LIMITED',
    trade_name: 'GSTINAPI SANDBOX',
    status: 'Active',
    taxpayer_type: 'Regular',
    business_constitution: null,
    registration_date: '2020-01-01',
    address: '1, Test Building, Test Street, Test Locality',
  },
  profile_complete: true,
  billed_to: 'test',
  credits_remaining: 24,
  free_remaining: 0,
  response_ms: 0,
});
const observedCompleteDemo = () => ({
  success: true,
  gstin: SAMPLE,
  profile: {
    legal_name: 'GSTINAPI TEST PRIVATE LIMITED',
    trade_name: 'GSTINAPI SANDBOX',
    registration_date: '2020-01-01',
    business_constitution: 'Private Limited Company',
    status: 'Active',
    taxpayer_type: 'Regular',
    address: '1, Test Building, Test Street, Test Locality',
    filing_frequency: 'Monthly',
    gstr3b_filed_till: '2026-09',
    gstr1_filed_till: '2026-09',
  },
  partial: false,
  unavailable: [],
  billed_to: 'test',
  credits_remaining: 24,
  free_remaining: 0,
  response_ms: 0,
});
type Payload = Record<string, unknown>;
const without = (payload: Payload, key: string) => {
  const { [key]: _removed, ...rest } = payload;
  return rest;
};
const withProfile = (payload: Payload, changes: Payload) => ({
  ...payload,
  profile: { ...(payload.profile as Payload), ...changes },
});
const withData = (payload: Payload, changes: Payload) => ({
  ...payload,
  data: { ...(payload.data as Payload), ...changes },
});

describe('GST-01: observed GSTINAPI sample (Demo) responses', () => {
  it('accepts the observed Basic Demo response and keeps actual credits unknown', async () => {
    const { provider, fetcher } = setup(observedBasicDemo());
    const result = await provider.lookup({ gstin, mode: 'DEMO', level: 'BASIC' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://www.gstinapi.in/v1/gstin/${SAMPLE}`);
    expect(result).toMatchObject({
      lookupGstin: SAMPLE,
      returnedGstin: SAMPLE,
      governmentStatus: 'ACTIVE',
      legalName: 'GSTINAPI TEST PRIVATE LIMITED',
      billingCategory: 'test',
      actualCredits: null,
      balance: 24,
    });
  });
  it('accepts the observed Complete Demo response without a test property', async () => {
    const payload = observedCompleteDemo();
    expect('test' in payload).toBe(false);
    const { provider, fetcher } = setup(payload);
    const result = await provider.lookup({ gstin, mode: 'DEMO', level: 'COMPLETE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://www.gstinapi.in/v1/gstin/${SAMPLE}/complete`);
    expect(result).toEqual({
      lookupGstin: SAMPLE,
      returnedGstin: SAMPLE,
      governmentStatus: 'ACTIVE',
      legalName: 'GSTINAPI TEST PRIVATE LIMITED',
      tradeName: 'GSTINAPI SANDBOX',
      taxpayerType: 'Regular',
      registrationDate: '2020-01-01',
      registeredAddress: '1, Test Building, Test Street, Test Locality',
      businessConstitution: 'Private Limited Company',
      filingFrequency: 'Monthly',
      gstr1FiledTill: '2026-09',
      gstr3bFiledTill: '2026-09',
      partial: false,
      unavailable: [],
      actualCredits: null,
      billingCategory: 'test',
      balance: 24,
    });
  });
  it('accepts an explicitly true test property on Complete Demo', async () => {
    const { provider } = setup({ ...observedCompleteDemo(), test: true });
    await expect(
      provider.lookup({ gstin, mode: 'DEMO', level: 'COMPLETE' }),
    ).resolves.toMatchObject({ returnedGstin: SAMPLE });
  });
  it('rejects an explicitly false test property on Complete Demo', async () => {
    const { provider, fetcher } = setup({ ...observedCompleteDemo(), test: false });
    await expect(provider.lookup({ gstin, mode: 'DEMO', level: 'COMPLETE' })).rejects.toMatchObject(
      { code: 'UNEXPECTED_RESPONSE', uncertain: true },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['missing', (p: Payload) => without(p, 'test')],
    ['false', (p: Payload) => ({ ...p, test: false })],
  ])('rejects a %s test property on Basic Demo', async (_name, change) => {
    const { provider, fetcher } = setup(change(observedBasicDemo()));
    await expect(provider.lookup({ gstin, mode: 'DEMO', level: 'BASIC' })).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  describe.each([
    ['BASIC', observedBasicDemo, withData],
    ['COMPLETE', observedCompleteDemo, withProfile],
  ] as const)('%s Demo safeguards', (level, fixture, nested) => {
    const reject = async (payload: Payload) => {
      const { provider, fetcher } = setup(payload);
      await expect(provider.lookup({ gstin, mode: 'DEMO', level })).rejects.toMatchObject({
        code: 'UNEXPECTED_RESPONSE',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    };
    it('rejects an incorrect or missing billed_to', async () => {
      await reject({ ...fixture(), billed_to: 'paid' });
      await reject(without(fixture(), 'billed_to'));
    });
    it('rejects an unexpected positive credits_charged', () =>
      reject({ ...fixture(), credits_charged: 1 }));
    it('accepts an explicit zero credits_charged and records it', async () => {
      const { provider } = setup({ ...fixture(), credits_charged: 0 });
      await expect(provider.lookup({ gstin, mode: 'DEMO', level })).resolves.toMatchObject({
        actualCredits: 0,
      });
    });
    it('rejects a mismatched envelope GSTIN', () =>
      reject({ ...fixture(), gstin: '33AAAAA0000A1Z5' }));
    it('rejects a mismatched nested GSTIN and accepts a matching one', async () => {
      await reject(nested(fixture(), { gstin: '33AAAAA0000A1Z5' }));
      const { provider } = setup(nested(fixture(), { gstin: SAMPLE }));
      await expect(provider.lookup({ gstin, mode: 'DEMO', level })).resolves.toMatchObject({
        returnedGstin: SAMPLE,
      });
    });
    it('rejects unsuccessful envelopes', () => reject({ ...fixture(), success: false }));
  });
  it('keeps unavailable Complete filing fields unavailable rather than inventing values', async () => {
    const payload = withProfile(observedCompleteDemo(), { gstr3b_filed_till: null });
    const { provider } = setup({
      ...payload,
      partial: true,
      unavailable: ['gstr3b_filed_till', 'filing_frequency'],
    });
    await expect(
      provider.lookup({ gstin, mode: 'DEMO', level: 'COMPLETE' }),
    ).resolves.toMatchObject({
      filingFrequency: null,
      gstr1FiledTill: '2026-09',
      gstr3bFiledTill: null,
      partial: true,
      unavailable: ['gstr3b_filed_till', 'filing_frequency'],
    });
  });
});

describe('GST-01: Live protection is unchanged', () => {
  const live = (level: 'BASIC' | 'COMPLETE') => ({ gstin, mode: 'LIVE' as const, level });
  it.each([
    ['BASIC', (p: Payload) => ({ ...p, test: true })],
    ['COMPLETE', (p: Payload) => ({ ...p, test: true })],
    ['BASIC', (p: Payload) => ({ ...p, billed_to: 'test' })],
    ['COMPLETE', (p: Payload) => ({ ...p, billed_to: 'test' })],
  ] as const)('%s Live rejects a response carrying test-only markers', async (level, mark) => {
    const { provider, fetcher } = setup(mark(body(level === 'COMPLETE')));
    await expect(provider.lookup(live(level))).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      uncertain: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('Live rejects the sample GSTIN before any transport', async () => {
    const { provider, fetcher } = setup(observedCompleteDemo());
    await expect(
      provider.lookup({ gstin: SAMPLE, mode: 'LIVE', level: 'COMPLETE' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('Live Complete never sends the sample identity and accepts an unmarked response', async () => {
    const { provider, fetcher } = setup(body(true));
    await provider.lookup(live('COMPLETE'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      `https://www.gstinapi.in/v1/gstin/${gstin}/complete`,
    );
  });
});
