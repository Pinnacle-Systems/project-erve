// Stage 3: Factory Packing -> Packing Audit -> Factory Dispatch finalize -> Erve Packing List -> Erve Dispatch (+ transporter / LR).
import { api, prisma, state, save, record, expectStatus, dump, cfg } from './lib.mts';

const T = state.tokens;
const I = state.ids;
const date = new Date().toISOString().slice(0, 10);

// TEST ONLY commercial inputs the Erve Packing List finalize needs (the real Distributor pricing is not in any source).
for (const [key, name] of [
  ['V', 'Distributor V'],
  ['G', 'Distributor G'],
  ['B', 'Distributor B'],
] as const) {
  if (I[`price:${key}`]) continue;
  const pl = await api.expect(201, 'POST', '/price-lists', {
    token: T.ADMIN,
    json: {
      distributorId: I[key],
      name: `TEST ONLY 50% MRP - ${name}`,
      percentageOfMrp: 50,
      effectiveFrom: '2000-01-01',
    },
  });
  await api.expect(200, 'POST', `/price-lists/${pl.id}/actions/activate`, {
    token: T.ADMIN,
    json: {},
  });
  I[`price:${key}`] = pl.id;
}
save();

async function pack(
  label: string,
  saleOrderId: string,
  cartonPlan: { number: string; destinationId: string }[],
) {
  if (I[`packed:${label}`]) return;
  const so = await api.expect(200, 'GET', `/sale-orders/${saleOrderId}`, { token: T.MERCH });
  const cartons: Record<string, string> = {};
  let factoryDispatchId = '';
  for (const plan of cartonPlan) {
    const lines = so.lines
      .filter((l: any) => l.destinationId === plan.destinationId)
      .map((l: any) => ({ saleOrderLineId: l.id, quantity: l.quantity }));
    const created = await api.expect(
      200,
      'POST',
      `/sale-orders/${saleOrderId}/packing-list/cartons`,
      {
        token: T.FACTORY,
        json: {
          cartonNumber: plan.number,
          destinationId: plan.destinationId,
          netWeight: 6.5,
          grossWeight: 7.4,
          dimensions: '45 x 35 x 25 cm',
          lines,
        },
      },
    );
    factoryDispatchId = created.factoryDispatch.id;
    const destination = created.destinations.find((d: any) => d.id === plan.destinationId);
    cartons[plan.destinationId] = destination.cartons.find(
      (c: any) => c.cartonNumber === plan.number,
    ).id;
  }
  // QA audit every carton, then the Factory finalizes the Factory Packing List.
  for (const cartonId of Object.values(cartons))
    await api.expect(
      200,
      'POST',
      `/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}/audit`,
      { token: T.QA, json: {} },
    );
  const detail = await api.expect(200, 'GET', `/factory-dispatches/${factoryDispatchId}`, {
    token: T.FACTORY,
  });
  const fin = await api.expect(
    200,
    'POST',
    `/factory-dispatches/${factoryDispatchId}/actions/finalize`,
    {
      token: T.FACTORY,
      json: { expectedVersion: detail.factoryDispatch?.version ?? detail.version },
    },
  );
  I[`packed:${label}`] = {
    factoryDispatchId,
    cartons,
    status: fin.factoryDispatch?.status ?? fin.status,
  };
  record(
    `WF3-PACK-${label}`,
    'Factory Packing / Packing Audit',
    `${label}: ${cartonPlan.length} cartons packed by the Factory, each audited by QA, Factory Packing List finalized`,
    'PASS',
    `status ${I[`packed:${label}`].status}`,
  );
  save();
}
const destId = async (soId: string, storeName: string) => {
  const so = await api.expect(200, 'GET', `/sale-orders/${soId}`, { token: T.MERCH });
  return so.distributorGroups
    .flatMap((g: any) => g.destinations)
    .find((d: any) => d.label === storeName).id as string;
};
const d1 = I['do:DO1'],
  d2 = I['do:DO2'];
await pack('DO1', d1, [
  { number: 'AW26-V1-A', destinationId: await destId(d1, cfg.store.V1) },
  { number: 'AW26-V2-A', destinationId: await destId(d1, cfg.store.V2) },
  { number: 'AW26-B1-A', destinationId: await destId(d1, cfg.store.B1) },
]);
await pack('DO2', d2, [
  { number: 'AW26-G1-B', destinationId: await destId(d2, cfg.store.G1) },
  { number: 'AW26-G2-B', destinationId: await destId(d2, cfg.store.G2) },
  { number: 'AW26-V1-B', destinationId: await destId(d2, cfg.store.V1) },
]);

// ---- negative: an Erve Packing List must not mix Distributors
if (true) {
  const mixed = [
    I['packed:DO1'].cartons[await destId(d1, cfg.store.V1)],
    I['packed:DO1'].cartons[await destId(d1, cfg.store.B1)],
  ];
  const r = await api.call('POST', '/erve-packing-lists', {
    token: T.MERCH,
    json: { cartonIds: mixed },
  });
  record(
    'WF5-NEG1',
    'Erve Packing List',
    'Consolidating cartons of two different Distributors/destinations in one Erve Packing List is refused',
    r.status >= 400 && r.status < 500 ? 'PASS' : 'FAIL',
    `HTTP ${r.status} ${JSON.stringify(r.body?.error ?? '').slice(0, 160)}`,
  );
  I.mixCheck = true;
}

async function consolidate(
  label: string,
  cartonIds: string[],
  opts: { transporter?: boolean } = {},
) {
  if (I[`ed:${label}`]) return;
  const eipl = await api.expect(201, 'POST', '/erve-packing-lists', {
    token: T.MERCH,
    json: { cartonIds },
  });
  await api.expect(200, 'POST', `/erve-packing-lists/${eipl.id}/finalize`, {
    token: T.MERCH,
    json: {},
  });
  const ed = await api.expect(201, 'POST', '/erve-dispatches', {
    token: T.MERCH,
    json: { ervePackingListId: eipl.id, dispatchDate: date, remarks: `AW26 UAT ${label}` },
  });
  I[`eipl:${label}`] = eipl.id;
  I[`ed:${label}`] = ed.id;
  record(
    `WF5-${label}`,
    'Erve Consolidated Packing List / Erve Dispatch',
    `${label}: ${cartonIds.length} carton(s) consolidated, finalized, dispatched`,
    'PASS',
    `${eipl.ervePackingListNumber ?? ''} / ${ed.erveDispatchNumber}`,
  );
  save();
}
const c1 = I['packed:DO1'].cartons,
  c2 = I['packed:DO2'].cartons;
await consolidate('ED1-V-STORE1', [
  c1[await destId(d1, cfg.store.V1)],
  c2[await destId(d2, cfg.store.V1)],
]); // same store, two Dispatch Orders, two Styles
await consolidate('ED2-V-STORE2', [c1[await destId(d1, cfg.store.V2)]]);
await consolidate('ED3-B-STORE1', [c1[await destId(d1, cfg.store.B1)]]);
await consolidate('ED4-G-STORE1', [c2[await destId(d2, cfg.store.G1)]]);
await consolidate('ED5-G-STORE2', [c2[await destId(d2, cfg.store.G2)]]);

// ---- Transporter assignment + LR (workflow step 6)
if (!I.transport) {
  for (const label of [
    'ED1-V-STORE1',
    'ED2-V-STORE2',
    'ED3-B-STORE1',
    'ED4-G-STORE1',
    'ED5-G-STORE2',
  ]) {
    const edId = I[`ed:${label}`];
    let ed = await api.expect(200, 'GET', `/erve-dispatches/${edId}`, { token: T.MERCH });
    ed = await api.expect(200, 'PATCH', `/erve-dispatches/${edId}/transporter-assignment`, {
      token: T.MERCH,
      json: { expectedVersion: ed.version, transporterUserId: I['user:TRANSPORTER'] },
    });
    const lr = await api.expect(200, 'PATCH', `/erve-dispatches/${edId}/lr`, {
      token: T.TRANSPORTER,
      json: {
        expectedVersion: ed.version,
        transporter: 'TEST ONLY Carrier',
        vehicleNumber: 'TN 99 AW 2626',
        lrNumber: `LR-AW26-${label.slice(0, 3)}`,
      },
    });
    I[`lr:${label}`] = lr.lrNumber ?? 'set';
  }
  const assigned = await api.expect(200, 'GET', '/erve-dispatches/assigned-transport', {
    token: T.TRANSPORTER,
  });
  record(
    'WF6-1',
    'Erve Dispatch / transporter / LR',
    'Merchandiser assigns the Transporter account; the Transporter records vehicle and LR on 5 dispatches and sees them in Assigned Dispatches',
    (assigned.items ?? assigned).length >= 5 ? 'PASS' : 'FAIL',
    `${(assigned.items ?? assigned).length} assigned`,
  );
  I.transport = true;
  save();
}
dump('stage3-state', I);
await prisma.$disconnect();
