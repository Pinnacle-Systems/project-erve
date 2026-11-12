// Stage 1: actors -> Order Sheets -> Job Orders -> production -> QA release (workflow steps 1-2). HTTP only.
//   cd apps/api && AW26_WORKSPACE=... npx tsx ../../tools/aw26-post-dispatch-verification/stage1-production.mts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  api,
  prisma,
  state,
  save,
  record,
  expectStatus,
  dump,
  ensureUser,
  adminToken,
  passingQualityPayload,
  WS,
  cfg,
} from './lib.mts';

const admin = await adminToken();
const rahaa = await prisma.factory.findFirstOrThrow({ where: { name: 'Rahaa' } });
const massKnit = await prisma.factory.findFirstOrThrow({
  where: { name: { contains: 'MASS KNIT', mode: 'insensitive' } },
});
const dist = Object.fromEntries((await prisma.distributor.findMany()).map((d) => [d.name, d]));
const V = dist[cfg.dist.V]!,
  G = dist[cfg.dist.G]!,
  B = dist[cfg.dist.B]!;
const styleA = await prisma.style.findFirstOrThrow({
  where: { styleNumber: 'AW26-5826005' },
  include: { styleSizes: { include: { size: true } } },
}); // sizes 3-8
const styleB = await prisma.style.findFirstOrThrow({
  where: { styleNumber: 'AW26-5526026' },
  include: { styleSizes: { include: { size: true } } },
}); // sizes 9-14
Object.assign(state.ids, {
  rahaa: rahaa.id,
  massKnit: massKnit.id,
  V: V.id,
  G: G.id,
  B: B.id,
  styleA: styleA.id,
  styleB: styleB.id,
});

// ---- actors (disposable accounts; passwords stay in the external runtime folder)
await ensureUser(admin, 'MERCH', 'AW26 Merchandiser', ['MERCHANDISER']);
await ensureUser(admin, 'FACTORY', 'AW26 Rahaa Factory User', ['FACTORY_USER'], {
  factoryId: rahaa.id,
});
await ensureUser(admin, 'FACTORY2', 'AW26 Mass Knit Factory User', ['FACTORY_USER'], {
  factoryId: massKnit.id,
});
await ensureUser(admin, 'QA', 'AW26 QA User', ['QA_USER']);
await ensureUser(admin, 'ACCOUNTANT', 'AW26 Accountant', ['ACCOUNTANT']);
await ensureUser(admin, 'SENIOR', 'AW26 Senior Management', ['SENIOR_MANAGEMENT']);
await ensureUser(admin, 'TRANSPORTER', 'AW26 Transporter', ['TRANSPORTER']);
await ensureUser(admin, 'DIST_V', 'AW26 Distributor V User', ['DISTRIBUTOR'], {
  distributorId: V.id,
});
await ensureUser(admin, 'DIST_G', 'AW26 Distributor G User', ['DISTRIBUTOR'], {
  distributorId: G.id,
});
await ensureUser(admin, 'DIST_B', 'AW26 Distributor B User', ['DISTRIBUTOR'], {
  distributorId: B.id,
});
record(
  'SETUP-1',
  'Setup',
  'Create role accounts: Merchandiser, 2 Factory, QA, Accountant, Senior Mgmt, Transporter, 3 Distributor users',
  'PASS',
  '10 accounts created through POST /users and mapped via /users/:id/distributors',
);

const T = state.tokens;
const date = new Date().toISOString().slice(0, 10);
const flow = await prisma.processFlowVersion.findFirstOrThrow({
  where: { status: 'ACTIVE', processFlow: { code: 'ERVE_PRODUCTION_QUALITY' } },
  orderBy: { versionNumber: 'desc' },
  include: { stages: true },
});
const imageBytes = readFileSync(
  path.join(WS, '02-aw26-extracted-data', 'images', 'AW26-5826005.png'),
);

async function produce(label: string, style: typeof styleA, perSize: Record<string, number>) {
  const sizes = style.styleSizes
    .filter((s) => s.status === 'ACTIVE')
    .sort((a, b) => Number(a.size.code) - Number(b.size.code));
  const mapping = await prisma.styleFactoryMapping.findFirstOrThrow({
    where: { styleId: style.id, factoryId: rahaa.id },
  });
  const total = sizes.length * Object.values(perSize).reduce((a, b) => a + b, 0);
  const orderSheetIds: string[] = [];
  for (const [distName, qty] of Object.entries(perSize)) {
    const os = await api.expect(201, 'POST', '/purchase-orders', {
      token: T.MERCH,
      json: {
        distributorId: dist[distName]!.id,
        poDate: date,
        lines: [
          {
            styleId: style.id,
            sizes: sizes.map((s) => ({ sizeId: s.sizeId, orderedQuantity: qty })),
          },
        ],
      },
    });
    orderSheetIds.push(os.id);
  }
  const perSizeQty = Object.values(perSize).reduce((a, b) => a + b, 0);
  let job = await api.expect(201, 'POST', '/job-orders', {
    token: T.MERCH,
    json: {
      orderSheetIds,
      sizes: sizes.map((s) => ({ sizeId: s.sizeId, quantity: perSizeQty })),
      factoryId: rahaa.id,
      processFlowVersionId: flow.id,
      unitPrice: mapping.exFactoryPrice.toString(),
      disclaimerText: 'AW26 UAT run; no commercial commitments.',
    },
  });
  state.ids[`jo:${label}`] = job.id;
  state.ids[`os:${label}`] = orderSheetIds;
  record(
    `WF1-${label}`,
    'Order Sheet / Job Order linkage',
    `${label}: ${orderSheetIds.length} Order Sheet(s) from different Distributors -> one Job Order (${perSizeQty} per size x ${sizes.length} sizes)`,
    'PASS',
    `JO ${job.id}`,
  );
  job = await api.expect(200, 'POST', `/job-orders/${job.id}/actions/send-to-factory`, {
    token: T.MERCH,
    json: { expectedVersion: job.version },
  });
  job = await api.expect(200, 'POST', `/job-orders/${job.id}/actions/confirm`, {
    token: T.FACTORY,
    json: {
      expectedVersion: job.version,
      expectedDisclaimerRevision: job.disclaimerRevision ?? 1,
      acknowledgeDisclaimer: true,
    },
  });
  const fresh = () => api.expect(200, 'GET', `/job-orders/${job.id}`, { token: T.MERCH });
  const quality = async (code: string) => {
    job = await fresh();
    const activity = flow.stages.find((a) => a.code === code)!;
    const lineSize = job.lines[0].sizes[0];
    const started = await api.expect(
      201,
      'POST',
      `/job-orders/${job.id}/quality-activities/${activity.id}/executions`,
      {
        token: T.QA,
        json:
          code === 'PP_SAMPLE'
            ? { sampleJobOrderLineSizeId: lineSize.id, sampleQuantity: 2 }
            : code === 'FINAL'
              ? {
                  allocations: job.lines.flatMap((l: any) =>
                    l.sizes.map((s: any) => ({ jobOrderLineSizeId: s.id, quantity: perSizeQty })),
                  ),
                }
              : {},
      },
    );
    const ex = await api.expect(200, 'GET', `/quality-executions/${started.id}`, { token: T.QA });
    if (ex.status === 'FINALIZED') return;
    if (code === 'PP_SAMPLE') {
      const qa = await api.expect(200, 'GET', `/qa/job-orders/${job.id}`, { token: T.QA });
      const session = qa.sessions.find((s: any) => s.id === started.ppSample.sessionId);
      const form = session.forms[0];
      const f = new FormData();
      f.append('inspectionLineId', form.id);
      f.append('image', new Blob([imageBytes], { type: 'image/png' }), 'aw26-reference.png');
      await api
        .expect(201, 'POST', `/qa/inspections/${session.id}/evidence`, { token: T.QA, form: f })
        .catch(async () =>
          api.expect(200, 'POST', `/qa/inspections/${session.id}/evidence`, {
            token: T.QA,
            form: f,
          }),
        );
      await api.expect(200, 'PUT', `/qa/inspections/${session.id}/forms/${form.id}`, {
        token: T.QA,
        json: {
          expectedVersion: form.version,
          sampleQuantity: 2,
          inspectionRemarks: 'AW26 UAT',
          checklist: form.checklist.map((i: any) => ({
            itemCode: i.itemCode,
            status: 'YES',
            remarks: null,
          })),
        },
      });
      const again = await api.expect(200, 'GET', `/qa/job-orders/${job.id}`, { token: T.QA });
      const cur = again.sessions
        .find((s: any) => s.id === session.id)
        .forms.find((x: any) => x.id === form.id);
      await api.expect(200, 'POST', `/qa/inspections/${session.id}/forms/${form.id}/finalize`, {
        token: T.QA,
        json: { expectedVersion: cur.version },
      });
    } else {
      const exec = await api.expect(200, 'GET', `/quality-executions/${started.id}`, {
        token: T.QA,
      });
      await api.expect(200, 'POST', `/quality-executions/${started.id}/finalize`, {
        token: T.QA,
        json: passingQualityPayload(exec, date, perSizeQty),
      });
    }
  };
  await quality('PP_SAMPLE');
  await quality('PPM');
  for (const code of ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING']) {
    job = await fresh();
    const stage = job.stages.find(
      (s: any) => s.processFlowVersionStageId === flow.stages.find((d) => d.code === code)!.id,
    );
    job = await api.expect(200, 'POST', `/job-orders/${job.id}/actions/start-stage`, {
      token: T.FACTORY,
      json: { expectedVersion: job.version, stageStatusId: stage.id },
    });
    if (code === 'SEWING') await quality('INLINE');
    if (code === 'FINISHING') {
      job = await fresh();
      job = await api.expect(
        200,
        'POST',
        `/job-orders/${job.id}/actions/update-prepared-quantity`,
        {
          token: T.FACTORY,
          json: {
            expectedVersion: job.version,
            sizes: job.lines.flatMap((l: any) =>
              l.sizes.map((s: any) => ({ jobOrderLineSizeId: s.id, preparedQuantity: perSizeQty })),
            ),
          },
        },
      );
      await quality('FINAL');
    }
    job = await fresh();
    if (job.stages.find((s: any) => s.id === stage.id)?.status !== 'COMPLETED')
      await api.expect(200, 'POST', `/job-orders/${job.id}/actions/complete-stage`, {
        token: T.FACTORY,
        json: { expectedVersion: job.version, stageStatusId: stage.id },
      });
  }
  job = await fresh();
  if (job.status !== 'PRODUCTION_COMPLETE')
    job = await api.expect(200, 'POST', `/job-orders/${job.id}/actions/mark-production-complete`, {
      token: T.MERCH,
      json: { expectedVersion: job.version },
    });
  const released = await prisma.qaReleaseLine.findMany({
    where: { release: { jobOrderId: job.id } },
    include: { release: { include: { sourceQualityExecution: true } } },
  });
  const releasedTotal = released.reduce((s, l) => s + l.quantity, 0);
  const allPass = released.every(
    (l) =>
      l.release.sourceQualityExecution.status === 'FINALIZED' &&
      l.release.sourceQualityExecution.outcome === 'PASS',
  );
  record(
    `WF2-${label}`,
    'Production completion / QA release',
    `${label}: production complete; QA-released stock ${releasedTotal} of ${total} (all from finalized PASS Final QA)`,
    releasedTotal === total && allPass ? 'PASS' : 'FAIL',
    `status ${job.status}`,
  );
  state.ids[`released:${label}`] = releasedTotal;
  save();
}

if (!state.ids['released:A']) await produce('A', styleA, { [cfg.dist.V]: 5, [cfg.dist.B]: 2 }); // 7 per size, sizes 3-8
if (!state.ids['released:B']) await produce('B', styleB, { [cfg.dist.G]: 4, [cfg.dist.V]: 3 }); // 7 per size, sizes 9-14
dump('stage1-state', state.ids);
await prisma.$disconnect();
