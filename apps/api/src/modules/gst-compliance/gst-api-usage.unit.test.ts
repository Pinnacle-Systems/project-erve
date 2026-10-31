import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { GstinApiUsageProvider } from '../../integrations/gst/gstin-api-usage.provider.js';
import type { GstUsageProvider } from '../../integrations/gst/gst-provider.js';
import { createGstApiUsageRouter } from './gst-api-usage.routes.js';
import { createGstApiUsageService } from './gst-api-usage.service.js';

// Authentication is the boundary double; no app/db/config module is loaded.
vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers['x-test-roles'];
    if (!header) {
      res.status(401).end();
      return;
    }
    req.user = { id: 'user-1', name: 'Tester', roles: String(header).split(',') } as CurrentUser;
    next();
  },
}));

const KEY = 'secret-test-key';
const USAGE_URL = 'https://www.gstinapi.in/v1/gstin/stats/me';
const counters = { total_calls: 42, success: 40, errors: 2, credits_used: 40 };
function transport(payload: string | object, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status }),
  );
}
function provider(fetcher: typeof fetch, apiKey = KEY, timeoutMs = 1000) {
  return new GstinApiUsageProvider({ apiKey, timeoutMs }, fetcher);
}

describe('GSTINAPI usage provider', () => {
  it('makes exactly one fixed GET with header-only authentication and maps all four counters', async () => {
    const fetcher = transport(counters);
    const result = await provider(fetcher).usageToday();
    expect(result).toEqual({ totalCalls: 42, successfulCalls: 40, errorCalls: 2, creditsUsed: 40 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      USAGE_URL,
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-api-key': KEY, Accept: 'application/json' },
        redirect: 'error',
      }),
    ]);
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain(KEY);
  });
  it('preserves legitimate zero counters rather than treating them as missing', async () => {
    const result = await provider(
      transport({ total_calls: 0, success: 0, errors: 0, credits_used: 0 }),
    ).usageToday();
    expect(result).toEqual({ totalCalls: 0, successfulCalls: 0, errorCalls: 0, creditsUsed: 0 });
  });
  it('ignores unknown extra provider fields', async () => {
    await expect(
      provider(transport({ ...counters, extra: 'x' })).usageToday(),
    ).resolves.toMatchObject({
      totalCalls: 42,
    });
  });
  it.each(Object.keys(counters))(
    'rejects a response missing %s without defaulting to zero',
    async (field) => {
      const { [field]: _removed, ...rest } = counters as Record<string, number>;
      const fetcher = transport(rest);
      await expect(provider(fetcher).usageToday()).rejects.toMatchObject({
        code: 'UNEXPECTED_RESPONSE',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ['negative', '{"total_calls":-1,"success":0,"errors":0,"credits_used":0}'],
    ['fractional', '{"total_calls":1.5,"success":0,"errors":0,"credits_used":0}'],
    ['non-finite', '{"total_calls":1e999,"success":0,"errors":0,"credits_used":0}'],
    ['string', '{"total_calls":"42","success":0,"errors":0,"credits_used":0}'],
    ['null', '{"total_calls":null,"success":0,"errors":0,"credits_used":0}'],
    ['boolean success', '{"total_calls":1,"success":true,"errors":0,"credits_used":0}'],
    ['array', '[]'],
    ['empty object', '{}'],
  ])('rejects %s counter values', async (_name, payload) => {
    await expect(provider(transport(payload)).usageToday()).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
  });
  it('handles malformed JSON safely', async () => {
    await expect(provider(transport('{not json')).usageToday()).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
  });
  it('rejects oversized streamed responses', async () => {
    const fetcher = transport({ ...counters, padding: 'x'.repeat(20000) });
    await expect(provider(fetcher).usageToday()).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, 'AUTHENTICATION'],
    [403, 'AUTHENTICATION'],
    [429, 'RATE_LIMITED'],
    [400, 'UNAVAILABLE'],
    [404, 'UNAVAILABLE'],
    [500, 'UNAVAILABLE'],
    [502, 'UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s without retry or leakage', async (status, code) => {
    const fetcher = transport({ error: `${KEY} vendor internals` }, status);
    const error = await provider(fetcher)
      .usageToday()
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toMatch(/secret-test-key|vendor/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds the whole request with a timeout and never retries', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(provider(fetcher, KEY, 10).usageToday()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('classifies network failures without retry', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(`connect failed with ${KEY}`);
    });
    const error = await provider(fetcher)
      .usageToday()
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NETWORK' });
    expect(String(error)).not.toContain(KEY);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['', '   '])('fails safely on a missing API key before any transport', async (apiKey) => {
    const fetcher = transport(counters);
    await expect(provider(fetcher, apiKey).usageToday()).rejects.toMatchObject({
      code: 'AUTHENTICATION',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('GET /gst-compliance/usage HTTP contract (no database)', () => {
  const fetchedAt = new Date('2026-10-31T06:30:00.000Z');
  let fetcher: ReturnType<typeof transport>;
  let app: express.Express;
  function build(usage: GstUsageProvider) {
    app = express();
    app.use(
      '/gst-compliance/usage',
      createGstApiUsageRouter(createGstApiUsageService({ provider: usage, now: () => fetchedAt })),
    );
    app.use(errorHandler);
  }
  beforeEach(() => {
    fetcher = transport(counters);
    build(provider(fetcher));
  });
  const get = (roles?: string) => {
    const call = request(app).get('/gst-compliance/usage');
    return roles ? call.set('x-test-roles', roles) : call;
  };

  it('requires authentication and never reaches the provider unauthenticated', async () => {
    await get().expect(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('gives an ACCOUNTANT the sanitized usage DTO, uncached, with one provider request', async () => {
    const response = await get('ACCOUNTANT').expect(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        totalCalls: 42,
        successfulCalls: 40,
        errorCalls: 2,
        creditsUsed: 40,
        fetchedAt: '2026-10-31T06:30:00.000Z',
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toMatch(
      /secret-test-key|x-api-key|balance|remaining/i,
    );
  });
  it('allows a user holding ACCOUNTANT among other roles', async () => {
    await get('ADMIN,ACCOUNTANT').expect(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR', 'FACTORY_USER', 'QA_USER'])(
    'denies %s without contacting the provider',
    async (role) => {
      await get(role).expect(403);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('ignores caller-supplied provider URLs, keys and query parameters', async () => {
    await request(app)
      .get('/gst-compliance/usage?url=https://evil.example&apiKey=attacker&key=x')
      .set('x-test-roles', 'ACCOUNTANT')
      .set('x-api-key', 'attacker')
      .expect(200);
    expect(fetcher.mock.calls[0]?.[0]).toBe(USAGE_URL);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { 'x-api-key': KEY } });
  });
  it('rejects non-GET methods', async () => {
    await request(app).post('/gst-compliance/usage').set('x-test-roles', 'ACCOUNTANT').expect(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('is not affected by repeated requests beyond one provider call each', async () => {
    await get('ACCOUNTANT').expect(200);
    await get('ACCOUNTANT').expect(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['missing key', () => provider(transport(counters), ''), 'GST_USAGE_AUTHENTICATION'],
    ['malformed body', () => provider(transport('{bad')), 'GST_USAGE_UNEXPECTED_RESPONSE'],
    [
      'HTTP 502',
      () => provider(transport({ error: 'secret-test-key' }, 502)),
      'GST_USAGE_UNAVAILABLE',
    ],
    ['HTTP 429', () => provider(transport({}, 429)), 'GST_USAGE_RATE_LIMITED'],
  ])('returns a controlled 503 for %s with no provider internals', async (_name, make, code) => {
    build(make());
    const response = await get('ACCOUNTANT').expect(503);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toMatch(/secret-test-key|vendor|x-api-key|stack/i);
  });
  it('turns an unexpected provider exception into a controlled 503', async () => {
    build({
      usageToday: async () => {
        throw new Error('boom with secret-test-key');
      },
    });
    const response = await get('ACCOUNTANT').expect(503);
    expect(response.body.error.code).toBe('GST_USAGE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('secret-test-key');
  });
});

describe('usage service authorization (independent of route middleware)', () => {
  const actor = (roles: string[]) => ({ id: 'user-1', name: 'Tester', roles }) as CurrentUser;
  it.each([['ADMIN'], ['MERCHANDISER'], ['SENIOR_MANAGEMENT'], ['DISTRIBUTOR'], ['FACTORY_USER']])(
    'denies %s at the service without calling the provider',
    async (role) => {
      const usageToday = vi.fn();
      const service = createGstApiUsageService({ provider: { usageToday } });
      await expect(service.usageToday(actor([role]))).rejects.toMatchObject({ statusCode: 403 });
      expect(usageToday).not.toHaveBeenCalled();
    },
  );
  it('allows an Accountant and stamps the server clock', async () => {
    const usageToday = vi.fn(async () => ({
      totalCalls: 1,
      successfulCalls: 1,
      errorCalls: 0,
      creditsUsed: 1,
    }));
    const service = createGstApiUsageService({
      provider: { usageToday },
      now: () => new Date('2026-10-31T06:30:00.000Z'),
    });
    await expect(service.usageToday(actor(['ACCOUNTANT']))).resolves.toEqual({
      totalCalls: 1,
      successfulCalls: 1,
      errorCalls: 0,
      creditsUsed: 1,
      fetchedAt: '2026-10-31T06:30:00.000Z',
    });
    expect(usageToday).toHaveBeenCalledTimes(1);
  });
});

describe('usage module isolation', () => {
  // Direct imports only: the router necessarily uses the shared auth middleware, which
  // itself loads the user store. The usage code adds no database or verification access.
  it('directly imports no database, verification, settings or repository code', () => {
    for (const file of [
      './gst-api-usage.service.ts',
      './gst-api-usage.routes.ts',
      '../../integrations/gst/gstin-api-usage.provider.ts',
    ]) {
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      expect(imports.length).toBeGreaterThan(0);
      expect(imports.join('\n')).not.toMatch(/prisma|verification|settings|repository|env\.js/i);
    }
  });
});
