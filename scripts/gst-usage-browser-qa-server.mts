// Local QA only: DB-free API harness for the GST usage / Complete Demo browser acceptance.
// It mounts the REAL routers, services, auth middleware and GSTINAPI adapters. The only
// doubles are (1) the user lookup behind requireAuth, (2) in-memory repositories and
// (3) the provider transport, which never leaves this process. No database is contacted
// and no external provider request is possible.
import { randomUUID } from 'node:crypto';
import express from '../apps/api/node_modules/express/index.js';

const QA_DATABASE_URL = 'postgresql://qa:qa@127.0.0.1:1/gst_usage_qa_unreachable';
if (process.env.GST_USAGE_QA_AUTHORIZED !== 'true' || process.env.DATABASE_URL !== QA_DATABASE_URL)
  throw new Error('Refusing to start: this harness requires its exact unreachable database guard');

const { env } = await import('../apps/api/src/config/env.js');
const { prisma } = await import('../apps/api/src/db/prisma.js');
const { signAccessToken } = await import('../apps/api/src/auth/jwt.js');
const { requireAuth } = await import('../apps/api/src/auth/auth.middleware.js');
const { errorHandler } = await import('../apps/api/src/middleware/error-handler.js');
const { HttpError } = await import('../apps/api/src/errors/http-error.js');
const { GstinApiProvider } = await import('../apps/api/src/integrations/gst/gstin-api.provider.js');
const { GstinApiUsageProvider } =
  await import('../apps/api/src/integrations/gst/gstin-api-usage.provider.js');
const { createGstApiUsageRouter } =
  await import('../apps/api/src/modules/gst-compliance/gst-api-usage.routes.js');
const { createGstApiUsageService } =
  await import('../apps/api/src/modules/gst-compliance/gst-api-usage.service.js');
const { createGstComplianceSettingsRouter } =
  await import('../apps/api/src/modules/gst-compliance/gst-compliance-settings.routes.js');
const { createGstComplianceSettingsService, DEFAULT_GST_COMPLIANCE_VALUES } =
  await import('../apps/api/src/modules/gst-compliance/gst-compliance-settings.service.js');
const { createMemorySettingsRepository } =
  await import('../apps/api/src/modules/gst-compliance/test/memory-settings-repository.js');
const { createGstinVerificationRouter } =
  await import('../apps/api/src/modules/gst-compliance/gstin-verification.routes.js');
const { createGstinVerificationService } =
  await import('../apps/api/src/modules/gst-compliance/gstin-verification.service.js');

const SYNTHETIC_KEY = 'qa-synthetic-key-never-transmitted';
const SAMPLE = '00AAAAA0000A1ZT';
const port = Number(process.env.PORT);
const appOrigin = process.env.QA_APP_ORIGIN!;

// 1) Authentication double: real JWT verification and requireAuth; only the user row is local.
const users: Record<string, { id: string; name: string; roles: string[] }> = {
  ACCOUNTANT: { id: 'qa-accountant', name: 'QA Accountant', roles: ['ACCOUNTANT'] },
  ADMIN: { id: 'qa-admin', name: 'QA Admin', roles: ['ADMIN'] },
  MERCHANDISER: { id: 'qa-merch', name: 'QA Merchandiser', roles: ['MERCHANDISER'] },
};
const userRecord = (u: (typeof users)[string]) => ({
  id: u.id,
  email: `${u.id}@qa.invalid`,
  mobile: null,
  name: u.name,
  status: 'ACTIVE',
  authVersion: 1,
  userRoles: u.roles.map((name) => ({ role: { name } })),
  userDistributors: [],
  userFactories: [],
});
Object.defineProperty(prisma, 'user', {
  configurable: true,
  value: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const found = Object.values(users).find((u) => u.id === where.id);
      return found ? userRecord(found) : null;
    },
  },
});

// 3) Provider transport double with an inspectable journal. Keys are never recorded.
type Mode = 'ok' | 'ok2' | 'fail502' | 'malformed' | 'slow';
let usageMode: Mode = 'ok';
const calls: { path: string; keyPresent: boolean }[] = [];
const observedBasic = {
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
};
const observedComplete = {
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
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const transport = (async (url: string | URL | Request, init?: RequestInit) => {
  const target = new URL(String(url));
  if (target.origin !== 'https://www.gstinapi.in') throw new Error('QA refuses unknown origins');
  const key = new Headers(init?.headers).get('x-api-key');
  calls.push({ path: target.pathname, keyPresent: key === SYNTHETIC_KEY });
  if (target.pathname === '/v1/gstin/stats/me') {
    if (usageMode === 'fail502') return json({ error: `vendor internals ${SYNTHETIC_KEY}` }, 502);
    if (usageMode === 'malformed') return new Response('{not json');
    if (usageMode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1500));
    return json(
      usageMode === 'ok2'
        ? { total_calls: 50, success: 47, errors: 3, credits_used: 47 }
        : { total_calls: 42, success: 40, errors: 2, credits_used: 40 },
    );
  }
  if (target.pathname === `/v1/gstin/${SAMPLE}`) return json(observedBasic);
  if (target.pathname === `/v1/gstin/${SAMPLE}/complete`) return json(observedComplete);
  throw new Error('QA refuses non-sample lookup identities');
}) as typeof fetch;

// 2) In-memory verification repository (the verification path is exercised end to end).
const evidenceRows: any[] = [];
const operations = new Map<string, any>();
const claims = new Set<string>();
const verificationRepository = {
  async evidence(gstin: string, mode: string) {
    return (['BASIC', 'COMPLETE'] as const)
      .map((level) =>
        evidenceRows.find(
          (r) => r.normalizedGstin === gstin && r.mode === mode && r.level === level,
        ),
      )
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt));
  },
  async latestFailure() {
    return null;
  },
  async history() {
    return [];
  },
  async prepare(intent: any) {
    operations.set(intent.id, { ...intent });
  },
  async intent(id: string) {
    return operations.get(id) ?? null;
  },
  async claim(intent: any, key: string) {
    if (claims.has(key) || operations.get(intent.id)?.outcome !== 'PREPARED') return false;
    claims.add(key);
    operations.get(intent.id).outcome = 'DISPATCHED';
    return true;
  },
  async complete(intent: any, evidence: any) {
    evidenceRows.unshift(evidence);
    operations.get(intent.id).outcome = 'SUCCEEDED';
    claims.clear();
  },
  async fail(intent: any, _code: string, uncertain: boolean) {
    operations.get(intent.id).outcome = uncertain ? 'UNCERTAIN' : 'FAILED';
    if (!uncertain) claims.clear();
  },
  async cacheHit(intent: any) {
    operations.get(intent.id).outcome = 'CACHE_HIT';
    claims.clear();
  },
};

const settingsRepository = createMemorySettingsRepository();
const settingsService = createGstComplianceSettingsService(
  settingsRepository,
  () => false,
  () => true,
);
const timeoutMs = env.GST_VERIFICATION_TIMEOUT_MS;
const app = express();
app.use((req: any, res: any, next: any) => {
  res.setHeader('Access-Control-Allow-Origin', appOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.json());
app.get('/health', (_req: any, res: any) => res.json({ success: true }));
app.get('/auth/me', requireAuth, (req: any, res: any) =>
  res.json({
    success: true,
    data: {
      id: req.user.id,
      email: req.user.email,
      mobile: null,
      name: req.user.name,
      roles: req.user.roles,
    },
  }),
);
app.use('/gst-compliance/settings', createGstComplianceSettingsRouter(settingsService));
app.use(
  '/gst-compliance/usage',
  createGstApiUsageRouter(
    createGstApiUsageService({
      provider: new GstinApiUsageProvider({ apiKey: SYNTHETIC_KEY, timeoutMs }, transport),
    }),
  ),
);
app.use(
  '/gst-compliance/verification',
  createGstinVerificationRouter(
    createGstinVerificationService({
      repository: verificationRepository as any,
      provider: new GstinApiProvider({ apiKey: SYNTHETIC_KEY, timeoutMs }, transport),
      settings: async () =>
        (await settingsRepository.read()) ?? { ...DEFAULT_GST_COMPLIANCE_VALUES, version: 0 },
      // Standalone reads are Accountant-only, exactly as the real access policy requires.
      authorizeTarget: async (actor: any, target: any) => {
        if (!target.source && !actor.roles.includes('ACCOUNTANT'))
          throw HttpError.forbidden('Standalone verification is available to Accountants only');
      },
      liveActivationAuthorized: () => false,
      liveLookupAuthorized: () => false,
      ttlSeconds: { BASIC: 604800, COMPLETE: 604800 },
    }),
  ),
);
// QA controls: not part of the product. Mint tokens, drive the transport double, read the journal.
app.get('/__qa/token', (req: any, res: any) => {
  const user = users[String(req.query.role)];
  if (!user) return res.status(404).end();
  const now = Date.now();
  res.json({
    accessToken: signAccessToken({ sub: user.id, roles: user.roles as any, authVersion: 1 }),
    session: {
      userId: user.id,
      accessExpiresAt: now + 55 * 60_000,
      idleExpiresAt: now + 55 * 60_000,
      absoluteExpiresAt: now + 8 * 3_600_000,
      idleTimeoutMs: 55 * 60_000,
      clockOffsetMs: 0,
    },
  });
});
app.post('/__qa/usage-mode', (req: any, res: any) => {
  usageMode = req.body.mode as Mode;
  res.json({ mode: usageMode });
});
app.get('/__qa/calls', (_req: any, res: any) => res.json({ calls, operations: operations.size }));
app.use(errorHandler);
app.listen(port, '127.0.0.1', () =>
  console.log(`GST usage QA harness ready on ${port} (${randomUUID().slice(0, 8)})`),
);
