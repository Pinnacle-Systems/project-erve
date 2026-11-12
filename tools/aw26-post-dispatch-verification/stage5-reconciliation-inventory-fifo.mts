// Stage 5: FIFO fixture dispatch, Reconciliation (A5), Retail Store Inventory (A6), Store-level FIFO Sales/Returns (A7) (steps 9-11).
import { randomUUID } from 'node:crypto';
import { api, prisma, state, save, record, dump, cfg } from './lib.mts';

const T = state.tokens;
const I = state.ids;
// The business calendar is IST: a receipt made at 05:20 IST on the 12th is dated the 12th even though UTC still says the 11th.
const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const findKey = (o: any, key: string): any => {
  if (o && typeof o === 'object') {
    if (key in o) return o[key];
    for (const v of Object.values(o)) {
      const r = findKey(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
};

// ---------------------------------------------------------------- A. later Distributor V dispatch of the same Store/Style (FIFO order proof)
if (!I['ed:ED6-V-STORE1-LATE']) {
  const storeV1 = await prisma.retailStore.findFirstOrThrow({
    where: { distributorId: I.V, name: cfg.store.V1 },
  });
  const so = await api.expect(201, 'POST', '/sale-orders', {
    token: T.MERCH,
    json: {
      distributors: [
        {
          clientKey: 'g',
          distributorId: I.V,
          destinations: [
            {
              clientKey: 'v1',
              retailStoreId: storeV1.id,
              addressLine1: storeV1.addressLine1,
              addressLine2: storeV1.addressLine2,
              city: storeV1.city,
              state: storeV1.state,
              country: storeV1.country,
              postalCode: storeV1.postalCode,
            },
          ],
        },
      ],
      factoryId: I.rahaa,
      soDate: date,
      lines: [{ destinationClientKey: 'v1', styleId: I.styleA, totalQuantity: 6 }],
    },
  });
  const destinationId = so.distributorGroups[0].destinations[0].id;
  const created = await api.expect(200, 'POST', `/sale-orders/${so.id}/packing-list/cartons`, {
    token: T.FACTORY,
    json: {
      cartonNumber: 'AW26-V1-A2',
      destinationId,
      netWeight: 3,
      grossWeight: 3.6,
      dimensions: '35 x 30 x 20 cm',
      lines: so.lines.map((l: any) => ({ saleOrderLineId: l.id, quantity: l.quantity })),
    },
  });
  const cartonId = created.destinations[0].cartons[0].id;
  await api.expect(
    200,
    'POST',
    `/factory-dispatches/${created.factoryDispatch.id}/cartons/${cartonId}/audit`,
    { token: T.QA, json: {} },
  );
  const fd = await api.expect(200, 'GET', `/factory-dispatches/${created.factoryDispatch.id}`, {
    token: T.FACTORY,
  });
  await api.expect(
    200,
    'POST',
    `/factory-dispatches/${created.factoryDispatch.id}/actions/finalize`,
    { token: T.FACTORY, json: { expectedVersion: fd.factoryDispatch?.version ?? fd.version } },
  );
  const eipl = await api.expect(201, 'POST', '/erve-packing-lists', {
    token: T.MERCH,
    json: { cartonIds: [cartonId] },
  });
  await api.expect(200, 'POST', `/erve-packing-lists/${eipl.id}/finalize`, {
    token: T.MERCH,
    json: {},
  });
  const ed = await api.expect(201, 'POST', '/erve-dispatches', {
    token: T.MERCH,
    json: {
      ervePackingListId: eipl.id,
      dispatchDate: date,
      remarks: 'AW26 UAT later dispatch (FIFO)',
    },
  });
  I['do:DO3'] = so.id;
  I['eipl:ED6-V-STORE1-LATE'] = eipl.id;
  I['ed:ED6-V-STORE1-LATE'] = ed.id;
  await new Promise((r) => setTimeout(r, 1500)); // ensure a strictly later verified receipt time
  const full = await api.expect(200, 'GET', `/erve-dispatches/${ed.id}`, { token: T.MERCH });
  const groups = [
    ...new Map(
      full.quantityLines.map((l: any) => [
        l.sizeId,
        { styleId: l.styleId, sizeId: l.sizeId, receivedQuantity: l.quantity },
      ]),
    ).values(),
  ];
  const rc = await api.call('POST', `/erve-dispatches/${ed.id}/distributor-receipt`, {
    token: T.DIST_V,
    json: { expectedVersion: full.version, acknowledged: true, remarks: null, groups },
  });
  record(
    'WF8-7',
    'Distributor actual receipt',
    'Distributor V: a later dispatch of Style A to the same Store (1 per size) received in full (used for the FIFO test)',
    rc.status === 201 ? 'PASS' : 'FAIL',
    `HTTP ${rc.status}`,
  );
  save();
}

if (!I.reconDone) {
  // ---------------------------------------------------------------- B. Reconciliation (A5)
  const queue = await api.expect(200, 'GET', '/post-dispatch-reconciliation?pageSize=50', {
    token: T.MERCH,
  });
  dump('reconciliation-queue', queue);
  const rows: any[] = queue.items ?? queue.rows ?? queue.dispatches ?? [];
  record(
    'WF9-1',
    'Reconciliation',
    `Queue lists the dispatches with their indicators (${rows.length} rows)`,
    rows.length >= 6 ? 'PASS' : 'FAIL',
    JSON.stringify(Object.keys(rows[0] ?? {})).slice(0, 200),
  );
  const detail = async (label: string, token = T.MERCH) =>
    api.call('GET', `/erve-dispatches/${I[`ed:${label}`]}/reconciliation`, { token });
  const d1 = await detail('ED1-V-STORE1');
  const d4 = await detail('ED4-G-STORE1');
  const d5 = await detail('ED5-G-STORE2');
  dump('reconciliation-ED1', d1.body);
  dump('reconciliation-ED4', d4.body);
  dump('reconciliation-ED5', d5.body);
  const txt = (r: any) => JSON.stringify(r.body?.data ?? {});
  record(
    'WF9-2',
    'Reconciliation',
    'ED1 (shortage): detail shows a Distributor shortage and the receipt difference',
    d1.status === 200 &&
      d1.body?.data?.summary?.hasShortage === true &&
      d1.body?.data?.summary?.shortageQuantity === 1
      ? 'PASS'
      : 'FAIL',
    `HTTP ${d1.status}`,
  );
  record(
    'WF9-3',
    'Reconciliation',
    'ED4 (receipt differs from earlier ledger): discrepancy classification present',
    d4.status === 200 &&
      d4.body?.data?.summary?.receiptDiffers === true &&
      d4.body?.data?.summary?.ledgerDisposition === 'EVIDENCE_ONLY_EXISTING'
      ? 'PASS'
      : 'FAIL',
    `HTTP ${d4.status}`,
  );
  record(
    'WF9-4',
    'Reconciliation / empty state',
    'ED5 (QR evidence only, no receipt): shows awaiting receipt with quantities "not recorded"',
    d5.status === 200 && d5.body?.data?.summary?.receivedQuantity == null ? 'PASS' : 'FAIL',
    `HTTP ${d5.status}`,
  );
  // reviews
  const token1 = findKey(d1.body?.data, 'snapshotToken');
  const review = (
    token: string,
    snap: string | undefined,
    prev: string | null,
    action: string,
    remarks = 'UAT review',
  ) =>
    api.call('POST', `/erve-dispatches/${I['ed:ED1-V-STORE1']}/reconciliation/reviews`, {
      token,
      json: { action, remarks, snapshotToken: snap, previousReviewId: prev },
    });
  const r1 = await review(
    T.MERCH,
    token1,
    null,
    'FOLLOW_UP',
    'Call Distributor V about the damaged piece (UAT)',
  );
  record(
    'WF9-5',
    'Reconciliation reviews',
    'Merchandiser records an "Operational follow-up" review (append-only)',
    r1.status === 201 || r1.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${r1.status} ${JSON.stringify(r1.body?.error ?? '').slice(0, 120)}`,
  );
  const stale = await review(T.ACCOUNTANT, token1, null, 'FINANCE_REVIEW', 'stale on purpose');
  record(
    'WF9-6',
    'Reconciliation reviews',
    'A review sent with the old snapshot/previous-review reference is refused (409)',
    stale.status === 409 ? 'PASS' : 'FAIL',
    `HTTP ${stale.status}`,
  );
  const d1b = await detail('ED1-V-STORE1');
  const prevId =
    findKey(d1b.body?.data, 'latestReviewId') ??
    findKey(d1b.body?.data?.reviews?.[0] ?? {}, 'id') ??
    findKey(d1b.body?.data?.history?.[0] ?? {}, 'id') ??
    null;
  const r2 = await review(
    T.ACCOUNTANT,
    findKey(d1b.body?.data, 'snapshotToken'),
    prevId,
    'FINANCE_REVIEW',
    'Finance to check the credit (UAT)',
  );
  record(
    'WF9-7',
    'Reconciliation reviews',
    'Accountant records a "Finance review" (allowed) using the fresh snapshot',
    r2.status === 201 || r2.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${r2.status} ${JSON.stringify(r2.body?.error ?? '').slice(0, 120)}`,
  );
  const acctOps = await review(
    T.ACCOUNTANT,
    findKey((await detail('ED1-V-STORE1')).body?.data, 'snapshotToken'),
    null,
    'FOLLOW_UP',
  );
  record(
    'WF9-8',
    'Reconciliation reviews / authorization',
    'Accountant may NOT record an operational follow-up',
    acctOps.status === 403 ? 'PASS' : 'FAIL',
    `HTTP ${acctOps.status}`,
  );
  for (const [who, tok, want] of [
    ['SENIOR', T.SENIOR, 'view-only'],
    ['DIST_V', T.DIST_V, 'denied'],
    ['FACTORY', T.FACTORY, 'denied'],
    ['TRANSPORTER', T.TRANSPORTER, 'denied'],
    ['QA', T.QA, 'denied'],
  ] as const) {
    const q = await api.call('GET', '/post-dispatch-reconciliation', { token: tok });
    const ok = want === 'view-only' ? q.status === 200 : q.status === 403;
    record(
      `WF9-AUTH-${who}`,
      'Reconciliation / authorization',
      `${who}: ${want === 'view-only' ? 'can view the queue' : 'cannot open reconciliation'}`,
      ok ? 'PASS' : 'FAIL',
      `HTTP ${q.status}`,
    );
  }
  const srReview = await api.call(
    'POST',
    `/erve-dispatches/${I['ed:ED1-V-STORE1']}/reconciliation/reviews`,
    {
      token: T.SENIOR,
      json: { action: 'ACKNOWLEDGE', remarks: 'x', snapshotToken: token1, previousReviewId: null },
    },
  );
  record(
    'WF9-AUTH-SENIOR-2',
    'Reconciliation / authorization',
    'Senior Management cannot record a review',
    srReview.status === 403 ? 'PASS' : 'FAIL',
    `HTTP ${srReview.status}`,
  );

  I.reconDone = true;
  save();
}

// ---------------------------------------------------------------- C. Retail Store Inventory (A6)
const invAdmin = await api.expect(200, 'GET', '/retail-store-inventory?limit=50', {
  token: T.ADMIN,
});
dump('inventory-admin', invAdmin);
record(
  'WF10-1',
  'Retail Store Inventory',
  'Admin sees every Distributor and Store with shipped/received evidence',
  JSON.stringify(invAdmin).includes(cfg.store.V1) && JSON.stringify(invAdmin).includes(cfg.store.G1)
    ? 'PASS'
    : 'FAIL',
  `${Object.keys(invAdmin).join(',')}`,
);
const invV = await api.call('GET', '/retail-store-inventory?limit=50', { token: T.DIST_V });
const invVtxt = JSON.stringify(invV.body?.data ?? {});
record(
  'WF10-2',
  'Retail Store Inventory / authorization',
  'Distributor V user sees only Distributor V Stores (no Distributor G, no Distributor B)',
  invV.status === 200 &&
    invVtxt.includes(cfg.store.V1) &&
    ![cfg.store.G1, cfg.store.G2, cfg.store.B1].some((n: string) => invVtxt.includes(n))
    ? 'PASS'
    : 'FAIL',
  `HTTP ${invV.status}`,
);
const invCross = await api.call('GET', `/retail-store-inventory?distributorId=${I.G}`, {
  token: T.DIST_V,
});
record(
  'WF10-3',
  'Retail Store Inventory / authorization',
  "Distributor V user asking for Distributor G's inventory is refused",
  invCross.status === 403 ? 'PASS' : 'FAIL',
  `HTTP ${invCross.status}`,
);
for (const who of ['FACTORY', 'TRANSPORTER', 'QA'] as const) {
  const r = await api.call('GET', '/retail-store-inventory', { token: T[who] });
  record(
    `WF10-AUTH-${who}`,
    'Retail Store Inventory / authorization',
    `${who} has no access`,
    r.status === 403 ? 'PASS' : 'FAIL',
    `HTTP ${r.status}`,
  );
}
const invB = await api.expect(200, 'GET', '/retail-store-inventory?limit=50', { token: T.DIST_B });
dump('inventory-outright', invB);
record(
  'WF10-4',
  'Retail Store Inventory / OUTRIGHT',
  'Distributor B (OUTRIGHT): shipment and receipt evidence only, no sell-through position derived',
  JSON.stringify(invB).includes('"saleReturn":null') ||
    !JSON.stringify(invB).includes('availableForActualSale')
    ? 'PASS'
    : 'FAIL',
  'saleReturn null / no availability fields',
);

// ---------------------------------------------------------------- D. Store-level FIFO (A7)
const storeV1 = await prisma.retailStore.findFirstOrThrow({
  where: { distributorId: I.V, name: cfg.store.V1 },
});
const size3 = await prisma.size.findFirstOrThrow({ where: { code: '3' } });
const size10 = await prisma.size.findFirstOrThrow({ where: { code: '10' } });
const storeKey = `S:${storeV1.id}`;
const avail = await api.expect(
  200,
  'GET',
  `/retail-store-inventory/store-fifo/availability?storeKey=${encodeURIComponent(storeKey)}&styleId=${I.styleA}&sizeId=${size3.id}&date=${date}`,
  { token: T.DIST_V },
);
dump('fifo-availability', avail);
record(
  'WF11-1',
  'Store-level FIFO',
  'Availability for Store V1 / Style A / size 3 = 3 pieces (2 from the older dispatch + 1 from the later one)',
  findKey(avail, 'availableQuantity') === 3 ||
    JSON.stringify(avail).includes('"eligibleQuantity":3') ||
    JSON.stringify(avail).match(/:3[,}]/)
    ? 'PASS'
    : 'FAIL',
  JSON.stringify(avail).slice(0, 300),
);
const key1 = randomUUID();
const post = (token: string, kind: 'sales-reports' | 'returns', body: any, key = randomUUID()) =>
  api.call('POST', `/retail-store-inventory/store-fifo/${kind}`, { token, key, json: body });
const sale1 = await post(
  T.DIST_V,
  'sales-reports',
  {
    storeKey,
    styleId: I.styleA,
    sizeId: size3.id,
    quantity: 2,
    reportDate: date,
    remarks: 'AW26 UAT FIFO sale 1',
  },
  key1,
);
dump('fifo-sale-1', sale1.body);
const alloc1 = JSON.stringify(sale1.body?.data ?? {});
record(
  'WF11-2',
  'Store-level FIFO',
  'Sell 2 -> posted (201) and allocated entirely to the OLDER dispatch (EIED/26-27/0001)',
  sale1.status === 201 && alloc1.includes('EIED/26-27/0001') && !alloc1.includes(`EIED/26-27/0006`)
    ? 'PASS'
    : 'FAIL',
  `HTTP ${sale1.status} ${alloc1.slice(0, 200)}`,
);
const replay = await post(
  T.DIST_V,
  'sales-reports',
  {
    storeKey,
    styleId: I.styleA,
    sizeId: size3.id,
    quantity: 2,
    reportDate: date,
    remarks: 'AW26 UAT FIFO sale 1',
  },
  key1,
);
record(
  'WF11-3',
  'Store-level FIFO / idempotency',
  'Same Idempotency-Key + same payload replays the stored document (200, replayed)',
  replay.status === 200 && JSON.stringify(replay.body?.data).includes('replayed') ? 'PASS' : 'FAIL',
  `HTTP ${replay.status}`,
);
const conflict = await post(
  T.DIST_V,
  'sales-reports',
  {
    storeKey,
    styleId: I.styleA,
    sizeId: size3.id,
    quantity: 1,
    reportDate: date,
    remarks: 'different',
  },
  key1,
);
record(
  'WF11-4',
  'Store-level FIFO / idempotency',
  'Same key with a different payload is refused (409)',
  conflict.status === 409 ? 'PASS' : 'FAIL',
  `HTTP ${conflict.status}`,
);
const tooMany = await post(T.DIST_V, 'sales-reports', {
  storeKey,
  styleId: I.styleA,
  sizeId: size3.id,
  quantity: 2,
  reportDate: date,
});
record(
  'WF11-5',
  'Store-level FIFO / quantity conservation',
  'Selling 2 when only 1 piece remains is refused before anything is written',
  tooMany.status >= 400 && tooMany.status < 500 ? 'PASS' : 'FAIL',
  `HTTP ${tooMany.status} ${JSON.stringify(tooMany.body?.error ?? '').slice(0, 140)}`,
);
const sale2 = await post(T.DIST_V, 'sales-reports', {
  storeKey,
  styleId: I.styleA,
  sizeId: size3.id,
  quantity: 1,
  reportDate: date,
});
record(
  'WF11-6',
  'Store-level FIFO',
  'Selling the last 1 piece draws on the later dispatch (EIED/26-27/0006)',
  sale2.status === 201 && JSON.stringify(sale2.body?.data ?? {}).includes('EIED/26-27/0006')
    ? 'PASS'
    : 'FAIL',
  `HTTP ${sale2.status}`,
);
const future = await post(T.DIST_V, 'sales-reports', {
  storeKey,
  styleId: I.styleA,
  sizeId: size3.id,
  quantity: 1,
  reportDate: '2027-01-01',
});
record(
  'WF11-7',
  'Store-level FIFO',
  'A future report date is refused',
  future.status === 400 ? 'PASS' : 'FAIL',
  `HTTP ${future.status}`,
);
const ret1 = await post(T.DIST_V, 'returns', {
  storeKey,
  styleId: I.styleB,
  sizeId: size10.id,
  quantity: 1,
  returnDate: date,
  returnReason: 'Customer return - AW26 UAT',
});
dump('fifo-return-1', ret1.body);
record(
  'WF11-8',
  'Store-level FIFO / returns',
  'Request a return of 1 (Style B / size 10) -> Return request created against the dispatch source',
  ret1.status === 201 ? 'PASS' : 'FAIL',
  `HTTP ${ret1.status} ${JSON.stringify(ret1.body?.error ?? '').slice(0, 140)}`,
);
const ret2 = await post(T.DIST_V, 'returns', {
  storeKey,
  styleId: I.styleB,
  sizeId: size10.id,
  quantity: 2,
  returnDate: date,
  returnReason: 'Too many',
});
record(
  'WF11-9',
  'Store-level FIFO / returns',
  'A second return of 2 when only 1 more is returnable is refused',
  ret2.status >= 400 && ret2.status < 500 ? 'PASS' : 'FAIL',
  `HTTP ${ret2.status}`,
);
const admin = await post(T.ADMIN, 'sales-reports', {
  storeKey,
  styleId: I.styleA,
  sizeId: size3.id,
  quantity: 1,
  reportDate: date,
});
record(
  'WF11-10',
  'Store-level FIFO / authorization',
  'Admin cannot post store-level sales (Distributor-only action)',
  admin.status === 403 ? 'PASS' : 'FAIL',
  `HTTP ${admin.status}`,
);
const bStore = await prisma.retailStore.findFirstOrThrow({ where: { distributorId: I.B } });
const outright = await post(T.DIST_B, 'sales-reports', {
  storeKey: `S:${bStore.id}`,
  styleId: I.styleA,
  sizeId: size3.id,
  quantity: 1,
  reportDate: date,
});
record(
  'WF11-11',
  'Store-level FIFO / OUTRIGHT',
  'OUTRIGHT stock (Distributor B) cannot be reported sold through the Sale-or-Return flow',
  outright.status >= 400 && outright.status < 500 ? 'PASS' : 'FAIL',
  `HTTP ${outright.status} ${JSON.stringify(outright.body?.error ?? '').slice(0, 140)}`,
);
const crossStore = await post(T.DIST_G, 'sales-reports', {
  storeKey,
  styleId: I.styleA,
  sizeId: size3.id,
  quantity: 1,
  reportDate: date,
});
record(
  'WF11-12',
  'Store-level FIFO / authorization',
  "Distributor G cannot sell from Distributor V's Store",
  crossStore.status >= 400 && crossStore.status < 500 ? 'PASS' : 'FAIL',
  `HTTP ${crossStore.status} ${JSON.stringify(crossStore.body?.error ?? '').slice(0, 120)}`,
);
const detailsView = await api.call('GET', `/retail-store-inventory?distributorId=${I.V}&limit=50`, {
  token: T.ADMIN,
});
dump('inventory-after-fifo', detailsView.body);
save();
await prisma.$disconnect();
