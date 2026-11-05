// QA-only API for the E-Way Bill browser acceptance harness (Track B / B5).
//
// It mounts the REAL application (routes, auth, RBAC, services, Prisma) against
// the disposable acceptance database. The only double is the E-Way Bill provider,
// injected through createApp. Nothing here can reach GSTINAPI: the provider is a
// local mock with a call journal, and the process refuses every non-loopback
// fetch. A separate loopback control port steers the mock, toggles the server's
// Demo authorization flag and exposes read-only database evidence; those routes
// do not exist on the application port.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  EWAY_ACCEPTANCE_SYNTHETIC_KEY,
  requireEwayAcceptanceEnvironment,
} from './eway-bill-acceptance-guard.js';

requireEwayAcceptanceEnvironment(process.env);
const controlToken = process.env.EWAY_ACCEPTANCE_CONTROL_TOKEN;
if (!controlToken || controlToken.length < 16) {
  throw new Error('E-Way Bill acceptance refused: EWAY_ACCEPTANCE_CONTROL_TOKEN is required');
}
const controlPort = Number(process.env.EWAY_ACCEPTANCE_CONTROL_PORT);
if (!Number.isInteger(controlPort) || controlPort <= 0) {
  throw new Error('E-Way Bill acceptance refused: EWAY_ACCEPTANCE_CONTROL_PORT is required');
}

const { default: express } = await import('express');
const { createApp } = await import('../app.js');
const { env } = await import('../config/env.js');
const { prisma } = await import('../db/prisma.js');
const { initFileStorage } = await import('../storage/index.js');
const { EwayBillProviderError } = await import('../integrations/gst/eway-bill-provider.js');
type EwayBillProvider = import('../integrations/gst/eway-bill-provider.js').EwayBillProvider;
type EwayBillGenerateResult = import('../integrations/gst/eway-bill-provider.js').EwayBillGenerateResult;

if (env.GST_VERIFICATION_API_KEY !== EWAY_ACCEPTANCE_SYNTHETIC_KEY || env.EWAY_BILL_PORTAL_USERNAME) {
  throw new Error('E-Way Bill acceptance refused: unexpected provider credential in the loaded environment');
}
// The server starts NOT authorized for Demo generation; the runner enables it.
env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED = false;

await initFileStorage();

// ---- Network fence -------------------------------------------------------
// Anything that tries to leave the machine through fetch is refused and counted.
const blockedExternalRequests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    blockedExternalRequests.push(`${target.origin}${target.pathname}`);
    throw new Error('E-Way Bill acceptance harness refuses external network access');
  }
  return realFetch(input, init);
}) as typeof fetch;

// ---- Mock E-Way Bill provider --------------------------------------------
type MockMode = 'success' | 'reject' | 'timeout' | 'ambiguous' | 'hold';
interface JournalEntry {
  sequence: number;
  at: string;
  kind: 'generate' | 'lookup';
  mode: MockMode;
  documentNumber?: string;
  transDistance?: string;
  transMode?: string;
  totalInvoiceValue?: number;
}
const journal: JournalEntry[] = [];
let mode: MockMode = 'success';
const held: Array<(outcome: Exclude<MockMode, 'hold'>) => void> = [];

const SYNTHETIC_NUMBER = 'TEST-100000000001';
const syntheticResult = (documentNumber: string): EwayBillGenerateResult => ({
  ewayBillNumber: SYNTHETIC_NUMBER,
  ewayBillDate: new Date(),
  validUpto: new Date(Date.now() + 24 * 60 * 60 * 1000),
  documentNumber,
  alreadyExisted: false,
  synthetic: true,
  creditsRemaining: 25,
});

function settle(outcome: Exclude<MockMode, 'hold'>, documentNumber: string): EwayBillGenerateResult {
  switch (outcome) {
    case 'success':
      return syntheticResult(documentNumber);
    case 'reject':
      // A definitive refusal: the provider answered and nothing was created.
      throw new EwayBillProviderError('INVALID_REQUEST', false, 400);
    case 'timeout':
      throw new EwayBillProviderError('TIMEOUT', true);
    case 'ambiguous':
      // An answer that is not provably a synthetic confirmation.
      throw new EwayBillProviderError('NOT_SYNTHETIC_RESPONSE', true);
  }
}

const provider: EwayBillProvider = {
  async generate(payload) {
    const entry: JournalEntry = {
      sequence: journal.length + 1,
      at: new Date().toISOString(),
      kind: 'generate',
      mode,
      documentNumber: payload.docNo,
      transDistance: payload.transDistance,
      transMode: payload.transMode,
      totalInvoiceValue: payload.totInvValue,
    };
    journal.push(entry);
    if (mode === 'hold') {
      const outcome = await new Promise<Exclude<MockMode, 'hold'>>((resolve) => held.push(resolve));
      return settle(outcome, payload.docNo);
    }
    return settle(mode, payload.docNo);
  },
  async lookup() {
    journal.push({ sequence: journal.length + 1, at: new Date().toISOString(), kind: 'lookup', mode });
    throw new Error('lookup is never expected during acceptance');
  },
};

// ---- Application port ----------------------------------------------------
// GET read faults let the runner prove that a failed status refresh keeps
// generation blocked. Only matching GETs fail; preflights and writes pass through.
const readFaults = new Set<string>();
// Read gates hold matching GETs until released, so the loading state can be
// observed deterministically instead of racing a timer.
const readGates = new Set<string>();
let releaseReadGate: () => void = () => undefined;
let readGate = Promise.resolve();
const appOrigin = process.env.CORS_ORIGIN?.split(',')[0] ?? '';
const server = express();
server.use(async (request, _response, next) => {
  if (request.method === 'GET' && [...readGates].some((suffix) => request.path.endsWith(suffix))) await readGate;
  next();
});
server.use((request, response, next) => {
  if (request.method === 'GET' && [...readFaults].some((suffix) => request.path.endsWith(suffix))) {
    response.setHeader('Access-Control-Allow-Origin', appOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.status(503).json({ success: false, error: { code: 'QA_INJECTED_FAULT', message: 'Injected read fault' } });
    return;
  }
  next();
});
server.use(createApp({ ewayBillProvider: provider }));
server.listen(env.PORT, env.HOST, () => {
  console.log(`E-Way Bill acceptance API on http://${env.HOST}:${env.PORT}; MOCK provider only`);
});

// ---- Control port (loopback only) ----------------------------------------
async function databaseEvidence(invoiceId: string) {
  const [bills, attempts, audit, dispatch] = await Promise.all([
    prisma.ewayBill.findMany({ where: { taxInvoiceId: invoiceId }, orderBy: { createdAt: 'asc' } }),
    prisma.ewayBillRequestAttempt.findMany({ where: { taxInvoiceId: invoiceId }, orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({ where: { entityType: 'TaxInvoiceEwayBill', entityId: invoiceId } }),
    prisma.erveDispatch.findMany(),
  ]);
  const movement = await prisma.ewayBillMovement.findUnique({ where: { taxInvoiceId: invoiceId } });
  return {
    bills: bills.map((b) => ({
      id: b.id,
      ewayBillNumber: b.ewayBillNumber,
      integrationMode: b.integrationMode,
      source: b.source,
      verificationStatus: b.verificationStatus,
      verifiedAt: b.verifiedAt,
      status: b.status,
      requestAttemptId: b.requestAttemptId,
    })),
    attempts: attempts.map((a) => ({
      id: a.id,
      integrationMode: a.integrationMode,
      outcome: a.outcome,
      failureCode: a.failureCode,
      resolvedById: a.resolvedById,
      resolutionReason: a.resolutionReason,
    })),
    auditActions: audit.map((row) => row.action).sort(),
    movement: movement && {
      version: movement.version,
      approximateDistanceKm: movement.approximateDistanceKm,
      transportMode: movement.transportMode,
      vehicleNumber: movement.vehicleNumber,
    },
    erveDispatchCount: dispatch.length,
  };
}

const control = http.createServer((request, response) => {
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (request.headers['x-qa-control-token'] !== controlToken) {
    reply(403, { error: 'forbidden' });
    return;
  }
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', async () => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (request.method === 'GET' && url.pathname === '/state') {
        reply(200, {
          mocked: true,
          mode,
          demoAuthorized: env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED,
          heldRequests: held.length,
          readFaults: [...readFaults],
          readGates: [...readGates],
          journal,
          blockedExternalRequests,
        });
      } else if (request.method === 'POST' && url.pathname === '/mode') {
        mode = body.mode as MockMode;
        reply(200, { mode });
      } else if (request.method === 'POST' && url.pathname === '/release') {
        const outcome = body.outcome as Exclude<MockMode, 'hold'>;
        const waiting = held.splice(0);
        for (const resolve of waiting) resolve(outcome);
        reply(200, { released: waiting.length, outcome });
      } else if (request.method === 'POST' && url.pathname === '/demo-authorized') {
        env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED = body.value === true;
        reply(200, { demoAuthorized: env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED });
      } else if (request.method === 'POST' && url.pathname === '/read-faults') {
        readFaults.clear();
        for (const suffix of (body.suffixes as string[]) ?? []) readFaults.add(suffix);
        reply(200, { readFaults: [...readFaults] });
      } else if (request.method === 'POST' && url.pathname === '/read-gate') {
        releaseReadGate();
        readGates.clear();
        for (const suffix of (body.suffixes as string[]) ?? []) readGates.add(suffix);
        readGate = readGates.size > 0 ? new Promise<void>((resolve) => (releaseReadGate = resolve)) : Promise.resolve();
        reply(200, { readGates: [...readGates] });
      } else if (request.method === 'POST' && url.pathname === '/read-gate/release') {
        releaseReadGate();
        readGates.clear();
        reply(200, { readGates: [] });
      } else if (request.method === 'POST' && url.pathname === '/journal/reset') {
        journal.length = 0;
        reply(200, { journal: 0 });
      } else if (request.method === 'GET' && url.pathname.startsWith('/db/invoice/')) {
        reply(200, await databaseEvidence(url.pathname.split('/').pop()!));
      } else if (request.method === 'GET' && url.pathname === '/db/dispatches') {
        const rows = await prisma.erveDispatch.findMany({ orderBy: { createdAt: 'asc' } });
        reply(
          200,
          rows.map((row) => ({ id: row.id, ervePackingListId: row.ervePackingListId, status: row.status, version: row.version, lrUpdatedAt: row.lrUpdatedAt, createdAt: row.createdAt })),
        );
      } else if (request.method === 'GET' && url.pathname === '/db/settings') {
        reply(200, await prisma.gstComplianceSettings.findFirst());
      } else if (request.method === 'GET' && url.pathname === '/db/ewaybill-totals') {
        reply(200, {
          bills: await prisma.ewayBill.count(),
          attempts: await prisma.ewayBillRequestAttempt.count(),
          liveBills: await prisma.ewayBill.count({ where: { integrationMode: 'LIVE' } }),
        });
      } else {
        reply(404, { error: 'unknown control route', id: randomUUID() });
      }
    } catch (error) {
      reply(500, { error: error instanceof Error ? error.message : 'control failure' });
    }
  });
});
control.listen(controlPort, '127.0.0.1', () => {
  console.log(`Acceptance control port on http://127.0.0.1:${controlPort}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    control.close();
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
