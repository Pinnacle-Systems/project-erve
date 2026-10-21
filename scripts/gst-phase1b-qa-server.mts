// Local QA only. Always uses mocked transport, never the external provider.
// Run from apps/api after explicit disposable-DB authorization and migration.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from '../apps/api/node_modules/express/index.js';
import { createApp } from '../apps/api/src/app.js';
import { env } from '../apps/api/src/config/env.js';
import { prisma } from '../apps/api/src/db/prisma.js';
import { hashPassword } from '../apps/api/src/auth/password.js';
import { requirePhase1bQaDatabase } from '../apps/api/src/test/phase1b-database-safety.js';
import { GstinApiProvider } from '../apps/api/src/integrations/gst/gstin-api.provider.js';

requirePhase1bQaDatabase(env.DATABASE_URL, process.env.GST_PHASE1B_QA_AUTHORIZED);
const artifact = path.resolve('../../.artifacts/gst-phase1b-qa');
const credentials = JSON.parse(fs.readFileSync(path.join(artifact, 'private.json'), 'utf8'));
const roles = ['ADMIN', 'ACCOUNTANT', 'MERCHANDISER'] as const;
for (const role of roles)
  await prisma.role.upsert({
    where: { name: role },
    update: {},
    create: { id: randomUUID(), name: role },
  });
for (const [label, names] of [
  ['accountant', ['ACCOUNTANT']],
  ['admin', ['ADMIN']],
  ['merchandiser', ['MERCHANDISER']],
  ['accountant-admin', ['ACCOUNTANT', 'ADMIN']],
] as const) {
  await prisma.user.upsert({
    where: { email: `gst-phase1b-${label}@qa.erve.local` },
    update: {},
    create: {
      id: randomUUID(),
      email: `gst-phase1b-${label}@qa.erve.local`,
      name: `Synthetic GST QA ${label}`,
      passwordHash: await hashPassword(credentials.qaPassword),
      userRoles: {
        create: names.map((name) => ({ id: randomUUID(), role: { connect: { name } } })),
      },
    },
  });
}
// These flags authorize the mocked transport only in this separate QA entrypoint.
env.GST_COMPLIANCE_LIVE_AUTHORIZED = true;
env.GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED = true;
env.NODE_ENV = 'test';
const calls: { url: string; gstin: string; level: string; at: string }[] = [];
let failureStatus = 200;
let partial = false;
const provider = new GstinApiProvider(
  { apiKey: 'synthetic-qa-key-never-transmitted', timeoutMs: 1000 },
  async (url) => {
    const parts = new URL(String(url)).pathname.split('/');
    const gstin = parts[3]!;
    if (!['00AAAAA0000A1ZT', '33AAAAA0000A1Z5', '27AAAAA0000A1Z5'].includes(gstin))
      throw new Error('QA refuses non-synthetic lookup identities');
    const complete = parts[4] === 'complete';
    calls.push({
      url: String(url),
      gstin,
      level: complete ? 'COMPLETE' : 'BASIC',
      at: new Date().toISOString(),
    });
    fs.writeFileSync(
      path.join(artifact, 'mock-provider-calls.json'),
      JSON.stringify(calls, null, 2),
    );
    const profile = {
      gstin,
      legal_name: 'SYNTHETIC GST QA COMPANY',
      trade_name: 'Synthetic QA Trade',
      status: 'Active',
      taxpayer_type: 'Regular',
      registration_date: '2021-04-15',
      address: 'Synthetic address, Chennai',
      filing_frequency: 'Monthly',
      gstr1_filed_till: '2026-08',
      gstr3b_filed_till: partial ? null : '2026-08',
    };
    return new Response(
      JSON.stringify(
        failureStatus === 200
          ? {
              success: true,
              gstin,
              ...(complete
                ? { profile, partial, unavailable: partial ? ['gstr3b_filed_till'] : [] }
                : { data: profile }),
              ...(gstin.startsWith('00')
                ? { test: true, billed_to: 'test', credits_charged: 0 }
                : { billed_to: 'synthetic_mock', credits_charged: complete ? 2 : 1 }),
              credits_remaining: 100,
            }
          : { success: false, error: 'Synthetic QA failure' },
      ),
      { status: failureStatus },
    );
  },
);
const server = express();
server.use(express.json());
// Loopback-only QA controls. These routes are absent from the production app.
server.get('/__qa/state', (_req, res) => res.json({ mocked: true, calls }));
server.post('/__qa/reset-verification', async (_req, res) => {
  // Explicit synthetic-fixture setup, never run automatically at server restart.
  await prisma.gstVerificationClaim.deleteMany();
  await prisma.gstVerificationEvidence.deleteMany();
  await prisma.gstVerificationOperation.deleteMany();
  calls.length = 0;
  failureStatus = 200;
  partial = false;
  res.json({ mocked: true });
});
server.post('/__qa/provider', (req, res) => {
  failureStatus = [200, 400, 401, 402, 404, 429, 502].includes(req.body.status)
    ? req.body.status
    : 200;
  partial = req.body.partial === true;
  res.json({ mocked: true, status: failureStatus, partial });
});
server.post('/__qa/expire', async (_req, res) => {
  await prisma.gstVerificationEvidence.updateMany({
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  res.json({ mocked: true });
});
server.use(createApp({ gstProvider: provider }));
server.listen(4101, '127.0.0.1', () =>
  console.log('Phase 1B QA API at 127.0.0.1:4101; isolated DB; MOCKED provider only'),
);
