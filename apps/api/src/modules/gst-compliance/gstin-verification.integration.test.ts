import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { GstinApiProvider } from '../../integrations/gst/gstin-api.provider.js';
import { gstinVerificationRepository } from './gstin-verification.repository.js';

const gstin = '33AAAAA0000A1Z5';
let token: string;
let userId: string;
let status = 200;
let partial = false;
let wait: Promise<void> = Promise.resolve();
const fetcher = vi.fn<typeof fetch>(async (url) => {
  await wait;
  const demo = String(url).includes('00AAAAA0000A1ZT');
  const complete = String(url).endsWith('/complete');
  const id = demo ? '00AAAAA0000A1ZT' : gstin;
  const profile = {
    gstin: id,
    status: 'Active',
    legal_name: 'Synthetic QA Company',
    trade_name: null,
    taxpayer_type: 'Regular',
    filing_frequency: 'Monthly',
    gstr1_filed_till: '2026-08',
    gstr3b_filed_till: partial ? null : '2026-08',
  };
  return new Response(
    JSON.stringify(
      status === 200
        ? {
            success: true,
            gstin: id,
            ...(complete
              ? { profile, partial, unavailable: partial ? ['gstr3b_filed_till'] : [] }
              : { data: profile }),
            ...(demo
              ? { test: true, billed_to: 'test', credits_charged: 0 }
              : { credits_charged: complete ? 2 : 1 }),
            credits_remaining: 50,
          }
        : { success: false, error: 'not exposed' },
    ),
    { status },
  );
});
const provider = () =>
  new GstinApiProvider({ apiKey: 'synthetic-mock-key-no-real-network', timeoutMs: 1000 }, fetcher);
let app = createApp({ gstProvider: provider() });
const auth = () => ({ Authorization: `Bearer ${token}` });
const target = { gstin };
async function prepare(
  refresh = false,
  actualTarget: typeof target & { source?: { type: string; id: string } } = target,
) {
  return (
    await request(app)
      .post('/gst-compliance/verification/prepare')
      .set(auth())
      .send({ target: actualTarget, refresh })
      .expect(200)
  ).body.data;
}
async function execute(id: string, code = 200) {
  return request(app)
    .post('/gst-compliance/verification/execute')
    .set(auth())
    .send({ intentId: id })
    .expect(code);
}
async function read() {
  return (
    await request(app).get('/gst-compliance/verification').query({ gstin }).set(auth()).expect(200)
  ).body.data;
}
async function settings(data: {
  integrationMode?: 'LIVE' | 'DEMO';
  gstinVerificationLevel?: 'BASIC' | 'COMPLETE';
  onlineGstinVerificationEnabled?: boolean;
}) {
  await prisma.gstComplianceSettings.update({
    where: { scope: 'APPLICATION' },
    data: { ...data, version: { increment: 1 } },
  });
}
beforeEach(async () => {
  await resetDatabase();
  fetcher.mockClear();
  status = 200;
  partial = false;
  wait = Promise.resolve();
  ({ userId, token } = await createTestUserAndToken({
    email: 'gst-synthetic@example.test',
    password: 'SyntheticTestOnly!',
    roles: ['ACCOUNTANT', 'ADMIN'],
  }));
  await prisma.gstComplianceSettings.create({
    data: {
      scope: 'APPLICATION',
      integrationMode: 'LIVE',
      onlineGstinVerificationEnabled: true,
      gstinVerificationLevel: 'BASIC',
      updatedById: userId,
    },
  });
  // LIVE is exercised only through a transport double with no network path.
  env.GST_COMPLIANCE_LIVE_AUTHORIZED = true;
  env.GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED = true;
  app = createApp({ gstProvider: provider() });
});
afterAll(async () => {
  env.GST_COMPLIANCE_LIVE_AUTHORIZED = false;
  env.GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED = false;
  await prisma.$disconnect();
});

describe('Phase 1B PostgreSQL integration with mocked provider transport', () => {
  it('enforces the new-account ten-per-minute limit globally across actors and instances', async () => {
    const prepared = await prepare();
    const intent = (await gstinVerificationRepository.intent(prepared.intentId))!;
    const now = new Date();
    await prisma.gstVerificationOperation.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `rate-fixture-${index}`,
        actorId: `other-synthetic-actor-${index}`,
        requestedGstin: gstin,
        normalizedGstin: gstin,
        mode: 'LIVE' as const,
        level: 'BASIC' as const,
        settingsVersion: intent.settingsVersion,
        estimatedCredits: 1,
        expiresAt: intent.expiresAt,
        outcome: 'FAILED',
        dispatchedAt: now,
      })),
    });
    await expect(gstinVerificationRepository.claim(intent, 'rate-test')).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(await prisma.gstVerificationClaim.count()).toBe(0);
    await prisma.gstVerificationOperation.update({
      where: { id: 'rate-fixture-0' },
      data: { dispatchedAt: new Date(now.getTime() - 61_000) },
    });
    expect(await gstinVerificationRepository.claim(intent, 'rate-test')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('coalesces sequential refresh intents confirmed against the same saved evidence', async () => {
    await execute((await prepare()).intentId);
    const first = await prepare(true);
    const second = await prepare(true);
    await execute(first.intentId);
    await execute(second.intentId);
    expect(fetcher).toHaveBeenCalledTimes(2); // initial lookup plus one refresh
    expect(await prisma.gstVerificationEvidence.count()).toBe(2);
    expect(
      (await prisma.gstVerificationOperation.findUniqueOrThrow({ where: { id: second.intentId } }))
        .outcome,
    ).toBe('CACHE_HIT');
  });
  it('persists evidence and cache across app recreation without additional provider calls', async () => {
    expect((await read()).cacheState).toBe('NONE');
    const intent = await prepare();
    expect(fetcher).not.toHaveBeenCalled();
    await execute(intent.intentId);
    expect(await prisma.gstVerificationEvidence.count()).toBe(1);
    app = createApp({ gstProvider: provider() });
    expect((await read()).cacheState).toBe('FRESH');
    expect((await prepare()).kind).toBe('RESULT');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await prisma.gstVerificationEvidence.findFirstOrThrow();
    expect(row.expiresAt.getTime() - row.retrievedAt.getTime()).toBe(604800000);
    expect(row.actualCredits).toBe(1);
  });
  it('Basic cannot satisfy Complete, but Complete satisfies Basic without enrichment calls', async () => {
    await execute((await prepare()).intentId);
    await settings({ gstinVerificationLevel: 'COMPLETE' });
    expect((await read()).cacheState).toBe('BASIC_ONLY');
    const complete = await prepare();
    expect(complete.estimatedCredits).toBe(2);
    await execute(complete.intentId);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `https://www.gstinapi.in/v1/gstin/${gstin}`,
      `https://www.gstinapi.in/v1/gstin/${gstin}/complete`,
    ]);
    await settings({ gstinVerificationLevel: 'BASIC' });
    expect((await prepare()).kind).toBe('RESULT');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('stores Demo and Live separately and never sends the business identity in Demo', async () => {
    await execute((await prepare()).intentId);
    await settings({ integrationMode: 'DEMO' });
    expect((await read()).evidence).toBeNull();
    await execute((await prepare()).intentId);
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://www.gstinapi.in/v1/gstin/00AAAAA0000A1ZT');
    const rows = await prisma.gstVerificationEvidence.findMany({ orderBy: { retrievedAt: 'asc' } });
    expect(rows.map((row) => row.mode)).toEqual(['LIVE', 'DEMO']);
    expect(rows[1]).toMatchObject({
      normalizedGstin: gstin,
      lookupGstin: '00AAAAA0000A1ZT',
      returnedGstin: '00AAAAA0000A1ZT',
      actualCredits: 0,
    });
    await settings({ integrationMode: 'LIVE' });
    expect((await read()).evidence.returnedGstin).toBe(gstin);
  });
  it('uses persistent coordination across two app instances and rechecks cache after claim', async () => {
    const first = await prepare();
    const second = await prepare();
    let release!: () => void;
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstRequest = execute(first.intentId);
    const running = firstRequest.then((r) => r);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    app = createApp({ gstProvider: provider() });
    await execute(second.intentId, 409);
    expect(await prisma.gstVerificationClaim.count()).toBe(1);
    release();
    await running;
    await execute(second.intentId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.gstVerificationClaim.count()).toBe(0);
    expect(
      (await prisma.gstVerificationOperation.findUniqueOrThrow({ where: { id: second.intentId } }))
        .outcome,
    ).toBe('CACHE_HIT');
  });
  it('retains an uncertain operation across app recreation and after reviewAfter expires', async () => {
    fetcher.mockRejectedValueOnce(new Error('Synthetic connection lost after dispatch'));
    const first = await prepare();
    await execute(first.intentId, 503);
    await prisma.gstVerificationClaim.updateMany({
      data: { reviewAfter: new Date('2020-01-01T00:00:00Z') },
    });
    app = createApp({ gstProvider: provider() });
    const second = await prepare();
    await execute(second.intentId, 409);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.gstVerificationClaim.count()).toBe(1);
    expect(await prisma.gstVerificationEvidence.count()).toBe(0);
  });
  it('preserves success on a Not Found refresh and appends failure history separately', async () => {
    await execute((await prepare()).intentId);
    status = 404;
    await execute((await prepare(true)).intentId, 404);
    const view = await read();
    expect(view.cacheState).toBe('FRESH');
    expect(view.latestFailure).toBe('NOT_FOUND');
    expect(await prisma.gstVerificationEvidence.count()).toBe(1);
    expect(await prisma.gstVerificationOperation.count({ where: { outcome: 'FAILED' } })).toBe(1);
  });
  it('does not refresh stale evidence on reads and preserves previous results on explicit refresh', async () => {
    await execute((await prepare()).intentId);
    // Test-only expiry fixture; normal evidence writes remain append-only.
    await prisma.gstVerificationEvidence.updateMany({
      data: { expiresAt: new Date('2020-01-01T00:00:00Z') },
    });
    expect((await read()).cacheState).toBe('STALE');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await execute((await prepare(true)).intentId);
    expect(await prisma.gstVerificationEvidence.count()).toBe(2);
  });
  it('caches partial Complete responses and does not chain or retry missing fields', async () => {
    partial = true;
    await settings({ gstinVerificationLevel: 'COMPLETE' });
    await execute((await prepare()).intentId);
    expect((await read()).evidence).toMatchObject({
      partial: true,
      gstr3bFiledTill: null,
      unavailable: ['gstr3b_filed_till'],
    });
    expect((await prepare()).kind).toBe('RESULT');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('revalidates saved identity and settings after confirmation, leaving master data unchanged', async () => {
    const distributor = await createTestDistributor({ gstin });
    const intent = await prepare(false, {
      gstin,
      source: { type: 'DISTRIBUTOR', id: distributor.id },
    });
    await prisma.distributor.update({
      where: { id: distributor.id },
      data: { gstin: '27AAAAA0000A1Z5' },
    });
    await execute(intent.intentId, 409);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (await prisma.distributor.findUniqueOrThrow({ where: { id: distributor.id } })).gstin,
    ).toBe('27AAAAA0000A1Z5');
  });
  it('requires independent Live execution authorization and rejects other-role paid requests', async () => {
    env.GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED = false;
    await request(app)
      .post('/gst-compliance/verification/prepare')
      .set(auth())
      .send({ target })
      .expect(403);
    env.GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED = true;
    const admin = await createTestUserAndToken({
      email: 'gst-admin@example.test',
      password: 'SyntheticTestOnly!',
      roles: ['ADMIN'],
    });
    const distributor = await createTestDistributor({ gstin });
    await request(app)
      .post('/gst-compliance/verification/prepare')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ target: { gstin, source: { type: 'DISTRIBUTOR', id: distributor.id } } })
      .expect(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
