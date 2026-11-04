import { describe, expect, it, vi } from 'vitest';
import {
  GstinApiEwayBillProvider,
  parseProviderDateTime,
} from '../../integrations/gst/gstin-api-eway-bill.provider.js';
import type { EwayBillGeneratePayload } from '../../integrations/gst/eway-bill-provider.js';
import { prepareEwayBillRequest } from './eway-bill-request.mapper.js';
import { requestFacts } from './test/eway-bill-request-fixtures.js';

const prepared = prepareEwayBillRequest(requestFacts(), { now: () => new Date('2026-11-05T00:00:00.000Z') });
if (!prepared.ok) throw new Error('fixture must map');
const payload: EwayBillGeneratePayload = prepared.payload;

const API_KEY = 'secret-api-key-123';
const PASSWORD = 'secret-portal-password';
const config = { apiKey: API_KEY, timeoutMs: 1000, portalUsername: 'portal-user', portalPassword: PASSWORD };

const sample = (extra: Record<string, unknown> = {}) => ({
  success: true,
  ewaybill_no: 'TEST-100000000001',
  ewaybill_date: '04/11/2026 11:30:00 AM',
  valid_upto: '05/11/2026 11:59:00 PM',
  doc_no: payload.docNo,
  billed_to: 'test',
  credits_remaining: 25,
  ...extra,
});

function setup(body: unknown, status = 200, cfg = config) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  return { fetcher, provider: new GstinApiEwayBillProvider(cfg, fetcher) };
}
const sentBody = (fetcher: ReturnType<typeof setup>['fetcher']) =>
  JSON.parse(String(fetcher.mock.calls[0]![1]!.body)) as Record<string, unknown>;
const lookupInput = { sellerGstin: payload.fromGstin, documentType: 'INV', documentNumber: payload.docNo } as const;

describe('GSTINAPI E-Way Bill adapter — request', () => {
  it('always sends test_mode=true to the fixed generate URL with safe transport options', async () => {
    const { provider, fetcher } = setup(sample());
    await provider.generate(payload);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://www.gstinapi.in/v1/ewaybill');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe(API_KEY);
    const body = sentBody(fetcher);
    expect(body).toMatchObject({
      gstin: payload.fromGstin,
      gstin_username: 'portal-user',
      password: PASSWORD,
      test_mode: true,
    });
    expect(body.payload).toEqual(JSON.parse(JSON.stringify(payload)));
    // The key travels only in the header, never in the body.
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it('omits portal credentials that are not configured', async () => {
    const { provider, fetcher } = setup(sample(), 200, { apiKey: API_KEY, timeoutMs: 1000 } as typeof config);
    await provider.generate(payload);
    const body = sentBody(fetcher);
    expect(body).not.toHaveProperty('gstin_username');
    expect(body).not.toHaveProperty('password');
    expect(body.test_mode).toBe(true);
  });

  it('sends lookup with the original document identity and test_mode=true', async () => {
    const { provider, fetcher } = setup(sample());
    const result = await provider.lookup(lookupInput);
    expect(fetcher.mock.calls[0]![0]).toBe('https://www.gstinapi.in/v1/ewaybill/lookup');
    expect(sentBody(fetcher)).toMatchObject({ doc_type: 'INV', doc_no: payload.docNo, test_mode: true });
    expect(result).toMatchObject({ synthetic: true, authoritative: false });
  });

  it('does not call the provider without an API key', async () => {
    const { provider, fetcher } = setup(sample(), 200, { apiKey: '  ', timeoutMs: 1000 } as typeof config);
    await expect(provider.generate(payload)).rejects.toMatchObject({ code: 'NOT_CONFIGURED', uncertain: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('GSTINAPI E-Way Bill adapter — success handling', () => {
  it('normalizes a synthetic response and parses IST timestamps', async () => {
    const { provider } = setup(sample());
    await expect(provider.generate(payload)).resolves.toEqual({
      ewayBillNumber: 'TEST-100000000001',
      ewayBillDate: new Date('2026-11-04T06:00:00.000Z'),
      validUpto: new Date('2026-11-05T18:29:00.000Z'),
      documentNumber: payload.docNo,
      alreadyExisted: false,
      synthetic: true,
      creditsRemaining: 25,
    });
  });

  it.each([
    ['test flag', { ewaybill_no: '123456789012', billed_to: undefined, test: true }],
    ['billed_to test with a realistic 12-digit number', { ewaybill_no: '123456789012' }],
    ['TEST- prefix alone', { billed_to: undefined }],
  ])('accepts a response identified as synthetic by its %s', async (_label, extra) => {
    const { provider } = setup(sample(extra));
    const result = await provider.generate(payload);
    // A realistic-looking number never changes the classification.
    expect(result.synthetic).toBe(true);
  });

  it.each([
    ['billed_to paid', { billed_to: 'paid', ewaybill_no: '123456789012' }],
    ['no synthetic marker at all', { billed_to: undefined, ewaybill_no: '123456789012' }],
    ['explicit test=false', { test: false }],
    ['credits charged', { credits_charged: 3 }],
  ])('treats %s as uncertain, never as a Demo success', async (_label, extra) => {
    const { provider } = setup(sample(extra));
    await expect(provider.generate(payload)).rejects.toMatchObject({ code: 'NOT_SYNTHETIC_RESPONSE', uncertain: true });
  });

  it('refuses a reply about a different document', async () => {
    const { provider } = setup(sample({ doc_no: 'EI/26-27/9999' }));
    await expect(provider.generate(payload)).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE', uncertain: true });
  });

  it('rejects oversized, malformed and unparseable success bodies as uncertain', async () => {
    await expect(setup({ ...sample(), padding: 'x'.repeat(300_000) }).provider.generate(payload)).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      uncertain: true,
    });
    const malformed = vi.fn<typeof fetch>(async () => new Response('not json', { status: 200 }));
    await expect(new GstinApiEwayBillProvider(config, malformed).generate(payload)).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      uncertain: true,
    });
    await expect(setup({ success: true }).provider.generate(payload)).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      uncertain: true,
    });
  });
});

describe('GSTINAPI E-Way Bill adapter — failures', () => {
  it.each([
    [401, {}, 'AUTHENTICATION', false],
    [402, {}, 'INSUFFICIENT_CREDITS', false],
    [403, { error: 'paid_account_required' }, 'PAID_ACCOUNT_REQUIRED', false],
    [403, {}, 'AUTHENTICATION', false],
    [400, { code: 108 }, 'CREDENTIALS_REJECTED', false],
    [400, {}, 'INVALID_REQUEST', false],
    [422, {}, 'INVALID_REQUEST', false],
    [429, {}, 'RATE_LIMITED', false],
    [500, {}, 'UNAVAILABLE', true],
    [502, {}, 'UNAVAILABLE', true],
    [404, {}, 'UNAVAILABLE', true],
  ])('maps generate HTTP %i %j to %s (uncertain=%s)', async (status, body, code, uncertain) => {
    const { provider, fetcher } = setup(body, status);
    await expect(provider.generate(payload)).rejects.toMatchObject({ code, uncertain });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats a 200 success=false with the invalid-credentials code as a definitive rejection', async () => {
    const { provider } = setup({ success: false, code: '108' });
    await expect(provider.generate(payload)).rejects.toMatchObject({
      code: 'CREDENTIALS_REJECTED',
      uncertain: false,
      providerCode: 108,
    });
  });

  it('maps a lookup with no record to NOT_FOUND without claiming anything about filing', async () => {
    await expect(setup({ code: 418 }, 400).provider.lookup(lookupInput)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      uncertain: false,
    });
    await expect(setup({}, 404).provider.lookup(lookupInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('bounds the whole request with a timeout and never retries', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const provider = new GstinApiEwayBillProvider({ ...config, timeoutMs: 10 }, fetcher);
    await expect(provider.generate(payload)).rejects.toMatchObject({ code: 'TIMEOUT', uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats a network failure or refused redirect after sending as uncertain, once', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = new GstinApiEwayBillProvider(config, fetcher);
    await expect(provider.generate(payload)).rejects.toMatchObject({ code: 'NETWORK', uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never leaks credentials, payload or provider text through an error', async () => {
    const hostile = { error: `bad ${API_KEY} ${PASSWORD} ${payload.docNo}`, message: PASSWORD };
    const { provider } = setup(hostile, 500);
    const error = await provider.generate(payload).catch((caught: unknown) => caught);
    const rendered = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(rendered).not.toContain(API_KEY);
    expect(rendered).not.toContain(PASSWORD);
    expect(rendered).not.toContain(payload.docNo);
    expect((error as Error).message).toBe('E-Way Bill provider request could not be completed');
  });
});

describe('parseProviderDateTime', () => {
  it('reads IST 12-hour timestamps, with either separator after the hour', () => {
    expect(parseProviderDateTime('04/11/2026 11:30:00 AM')?.toISOString()).toBe('2026-11-04T06:00:00.000Z');
    expect(parseProviderDateTime('04/11/2026 12.00:00 PM')?.toISOString()).toBe('2026-11-04T06:30:00.000Z');
    expect(parseProviderDateTime('04/11/2026 12:15:00 AM')?.toISOString()).toBe('2026-11-03T18:45:00.000Z');
    expect(parseProviderDateTime('04/11/2026')?.toISOString()).toBe('2026-11-03T18:30:00.000Z');
  });
  it('returns null for anything else', () => {
    expect(parseProviderDateTime('31/02/2026 10:00:00 AM')).toBeNull();
    expect(parseProviderDateTime('2026-11-04T10:00:00Z')).toBeNull();
    expect(parseProviderDateTime('13/13/2026')).toBeNull();
    expect(parseProviderDateTime(null)).toBeNull();
  });
});
