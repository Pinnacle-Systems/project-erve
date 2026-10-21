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
