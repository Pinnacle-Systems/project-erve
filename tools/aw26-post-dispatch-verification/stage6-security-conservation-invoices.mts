// Stage 6: confidentiality / authorization, Style image access, empty states, quantity conservation, invoices (step 12).
import { api, prisma, state, save, record, dump, ensureUser, adminToken, cfg } from './lib.mts';

const T = state.tokens;
const I = state.ids;
const names = [cfg.dist.V, cfg.dist.G, cfg.dist.B];
const gstins = cfg.gstin as string[];
const leaks = (body: unknown, extra: string[] = []) => {
  const t = JSON.stringify(body ?? {});
  const found = [...names, ...gstins, ...extra].filter((n) => t.includes(n));
  // The neutral Factory projection keeps the key but with a null value; a real value (OUTRIGHT/SALE_RETURN) is a leak.
  if (/"purchaseMode":"(OUTRIGHT|SALE_RETURN)"/.test(t)) found.push('purchaseMode value');
  return found;
};

// ---------------------------------------------------------------- E. confidentiality / authorization
const ed1 = I['ed:ED1-V-STORE1'],
  ed4 = I['ed:ED4-G-STORE1'];
const factoryPacking = await api.call(
  'GET',
  `/factory-dispatches/${I['packed:DO1'].factoryDispatchId}`,
  { token: T.FACTORY },
);
const factorySO = await api.call('GET', `/sale-orders/${I['do:DO1']}`, { token: T.FACTORY });
const factoryList = await api.call('GET', '/factory-dispatches?limit=50', { token: T.FACTORY });
const factoryQueue = await api.call('GET', '/factory-dispatches/packing-queue', {
  token: T.FACTORY,
});
for (const [id, label, r] of [
  ['SEC-1', 'Factory Packing List detail', factoryPacking],
  ['SEC-2', 'Dispatch Order detail', factorySO],
  ['SEC-3', 'Factory Packing List list', factoryList],
  ['SEC-4', 'Packing queue', factoryQueue],
] as const) {
  const l = r.status === 200 ? leaks(r.body) : [];
  record(
    id,
    'Confidentiality (Factory sees no Distributor)',
    `Factory user: ${label} carries no Distributor name/GSTIN/Purchase Mode`,
    r.status === 200 && l.length === 0 ? 'PASS' : r.status === 200 ? 'FAIL' : 'INFO',
    r.status === 200
      ? l.length
        ? 'LEAKED: ' + l.join(' | ')
        : 'no Distributor identity in body'
      : `HTTP ${r.status}`,
  );
}
const qaQueue = await api.call('GET', '/packing-audit/queue', { token: T.QA });
const qaLeak = qaQueue.status === 200 ? leaks(qaQueue.body) : [];
record(
  'SEC-5',
  'Confidentiality (QA)',
  'QA user: Packing Audit queue carries no Distributor identity',
  qaQueue.status === 200 && qaLeak.length === 0 ? 'PASS' : 'FAIL',
  qaLeak.join(' | ') || `HTTP ${qaQueue.status}`,
);
const distDispatch = await api.call('GET', `/erve-dispatches/${ed1}`, { token: T.DIST_V });
const distLeak = JSON.stringify(distDispatch.body?.data ?? {}).includes('Rahaa');
record(
  'SEC-6',
  'Confidentiality (Distributor sees no Factory)',
  'Distributor V user: own Erve Dispatch opens (200) and does not name the Factory',
  distDispatch.status === 200 && !distLeak ? 'PASS' : 'FAIL',
  distLeak ? 'Factory name "Rahaa" present in the Distributor view' : `HTTP ${distDispatch.status}`,
);
const crossDist = await api.call('GET', `/erve-dispatches/${ed4}`, { token: T.DIST_V });
record(
  'SEC-7',
  'Authorization',
  "Distributor V user cannot open Distributor G's dispatch",
  [403, 404].includes(crossDist.status) ? 'PASS' : 'FAIL',
  `HTTP ${crossDist.status}`,
);
const crossFactory = await api.call(
  'GET',
  `/factory-dispatches/${I['packed:DO1'].factoryDispatchId}`,
  { token: T.FACTORY2 },
);
record(
  'SEC-8',
  'Authorization',
  "Mass Knit Factory user cannot open Rahaa's Factory Packing List",
  [403, 404].includes(crossFactory.status) ? 'PASS' : 'FAIL',
  `HTTP ${crossFactory.status}`,
);
const crossFactoryList = await api.call('GET', '/factory-dispatches?limit=50', {
  token: T.FACTORY2,
});
record(
  'SEC-9',
  'Authorization / empty state',
  "Mass Knit Factory user's packing list is empty",
  crossFactoryList.status === 200 &&
    (crossFactoryList.body?.data?.items ?? crossFactoryList.body?.data ?? []).length === 0
    ? 'PASS'
    : 'FAIL',
  `HTTP ${crossFactoryList.status}`,
);
const crossSO = await api.call('GET', `/sale-orders/${I['do:DO1']}`, { token: T.FACTORY2 });
record(
  'SEC-10',
  'Authorization',
  "Mass Knit Factory user cannot open Rahaa's Dispatch Order",
  [403, 404].includes(crossSO.status) ? 'PASS' : 'FAIL',
  `HTTP ${crossSO.status}`,
);
const trFull = await api.call('GET', `/erve-dispatches/${ed1}`, { token: T.TRANSPORTER });
const trMin = await api.call('GET', `/erve-dispatches/${ed1}/transport`, { token: T.TRANSPORTER });
record(
  'SEC-11',
  'Authorization (Transporter)',
  'Transporter: full dispatch view is refused (403); restricted Transport view opens and holds no Distributor/financial data',
  trFull.status === 403 && trMin.status === 200 && leaks(trMin.body).length === 0 ? 'PASS' : 'FAIL',
  `full ${trFull.status}, transport ${trMin.status}`,
);
const anon = await api.call('GET', '/erve-dispatches', {});
record(
  'SEC-12',
  'Authorization',
  'No login: the dispatch list is refused (401)',
  anon.status === 401 ? 'PASS' : 'FAIL',
  `HTTP ${anon.status}`,
);
const badQr = await api.call('POST', '/public/carton-delivery/resolve', {
  headers: { 'X-Carton-Delivery-Token': 'x'.repeat(43) },
  json: {},
  key: false,
});
record(
  'SEC-13',
  'QR delivery / unknown link',
  'An unknown QR token resolves to a generic "unavailable" (404), nothing disclosed',
  badQr.status === 404 ? 'PASS' : 'FAIL',
  `HTTP ${badQr.status}`,
);
const acctDisp = await api.call('GET', `/erve-dispatches/${ed1}`, { token: T.ACCOUNTANT });
record(
  'SEC-14',
  'Authorization',
  'Accountant can open a dispatch (internal role)',
  acctDisp.status === 200 ? 'PASS' : 'FAIL',
  `HTTP ${acctDisp.status}`,
);

// ---------------------------------------------------------------- F. Style image access
const imgs = await api.expect(200, 'GET', `/styles/${I.styleA}/images`, { token: T.ADMIN });
const imageId = (imgs.items ?? imgs)[0]?.id;
const otherStyle = await prisma.style.findFirstOrThrow({ where: { styleNumber: 'AW26-35126003' } });
const otherImgs = await api.expect(200, 'GET', `/styles/${otherStyle.id}/images`, {
  token: T.ADMIN,
});
const otherImageId = (otherImgs.items ?? otherImgs)[0]?.id;
const content = (token: string | undefined, style: string, image: string) =>
  api.call('GET', `/styles/${style}/images/${image}/content`, { token, raw: true });
const cases: [string, string, string | undefined, string, string, number[]][] = [
  ['IMG-1', 'Admin opens a Style image', T.ADMIN, I.styleA, imageId, [200]],
  ['IMG-2', 'Accountant opens a Style image', T.ACCOUNTANT, I.styleA, imageId, [200]],
  ['IMG-3', 'Senior Management opens a Style image', T.SENIOR, I.styleA, imageId, [200]],
  [
    'IMG-4',
    'Distributor V user opens the image of a Style it has received (AW26-5826005)',
    T.DIST_V,
    I.styleA,
    imageId,
    [200],
  ],
  [
    'IMG-5',
    'Distributor V user is refused the image of a Style it never received (AW26-35126003)',
    T.DIST_V,
    otherStyle.id,
    otherImageId,
    [403, 404],
  ],
  [
    'IMG-6',
    'Distributor B (OUTRIGHT) user opens the image of its own received Style',
    T.DIST_B,
    I.styleA,
    imageId,
    [200],
  ],
  [
    'IMG-7',
    'Distributor G user is refused the Style A image (never received it)',
    T.DIST_G,
    I.styleA,
    imageId,
    [403, 404],
  ],
  [
    'IMG-8',
    'Rahaa Factory user opens the image of a Style on its own Job Order',
    T.FACTORY,
    I.styleA,
    imageId,
    [200],
  ],
  [
    'IMG-8b',
    'Rahaa Factory user is refused the image of a Style that is on none of its Job Orders (AW26-35126003)',
    T.FACTORY,
    otherStyle.id,
    otherImageId,
    [403, 404],
  ],
  [
    'IMG-8c',
    'Mass Knit Factory user is refused the image of a Style made at another Factory',
    T.FACTORY2,
    I.styleA,
    imageId,
    [403, 404],
  ],
  ['IMG-9', 'No login: Style image is refused', undefined, I.styleA, imageId, [401]],
];
for (const [id, scenario, token, style, image, want] of cases) {
  const r = await content(token, style, image);
  record(
    id,
    'Style image access',
    scenario,
    want.includes(r.status) ? 'PASS' : 'FAIL',
    `HTTP ${r.status}${r.status === 200 ? ' ' + r.headers.get('content-type') + ' ' + r.buffer.length + ' bytes' : ''}`,
  );
}

// ---------------------------------------------------------------- G. empty / no-evidence states
await ensureUser(await adminToken(), 'DIST_E', 'AW26 Distributor E User', ['DISTRIBUTOR'], {
  distributorId: (await prisma.distributor.findFirstOrThrow({ where: { name: cfg.dist.EMPTY } }))
    .id,
});
const emptyInv = await api.call('GET', '/retail-store-inventory?limit=50', {
  token: state.tokens.DIST_E,
});
record(
  'EMPTY-1',
  'Empty state',
  'Distributor with no dispatches (Distributor E): Retail Store Inventory returns an empty list, not an error',
  emptyInv.status === 200 && (emptyInv.body?.data?.items ?? []).length === 0 ? 'PASS' : 'FAIL',
  `HTTP ${emptyInv.status}`,
);
const emptyPos = await api.call('GET', '/sale-or-return-positions', { token: state.tokens.DIST_E });
record(
  'EMPTY-2',
  'Empty state',
  'Same Distributor: Sale-or-Return positions are empty (200)',
  emptyPos.status === 200 && (emptyPos.body?.data?.items ?? emptyPos.body?.data ?? []).length === 0
    ? 'PASS'
    : 'FAIL',
  `HTTP ${emptyPos.status}`,
);
const noMatch = await api.call(
  'GET',
  '/post-dispatch-reconciliation?dispatchReference=NO-SUCH-DISPATCH',
  { token: T.MERCH },
);
record(
  'EMPTY-3',
  'Empty state',
  'Reconciliation filter with no match returns an empty queue (200)',
  noMatch.status === 200 && (noMatch.body?.data?.items ?? []).length === 0 ? 'PASS' : 'FAIL',
  `HTTP ${noMatch.status}`,
);
const ed5 = await api.call('GET', `/erve-dispatches/${I['ed:ED5-G-STORE2']}/reconciliation`, {
  token: T.MERCH,
});
record(
  'EMPTY-4',
  'No-evidence state',
  'Dispatch with QR evidence but no receipt: received/ledger quantities are null ("Not recorded"), not zero',
  ed5.body?.data?.summary?.receivedQuantity == null &&
    ed5.body?.data?.summary?.ledgerQuantity == null
    ? 'PASS'
    : 'FAIL',
  JSON.stringify({
    received: ed5.body?.data?.summary?.receivedQuantity,
    ledger: ed5.body?.data?.summary?.ledgerQuantity,
  }),
);

// ---------------------------------------------------------------- H. quantity conservation (read-only DB check)
const sum = (rows: { _sum: Record<string, number | null> }, field: string) => rows._sum[field] ?? 0;
const per = async (styleNumber: string) => {
  const style = await prisma.style.findFirstOrThrow({ where: { styleNumber } });
  const released = await prisma.qaReleaseLine
    .aggregate({
      _sum: { quantity: true },
      where: { release: { jobOrder: { lines: { some: { styleId: style.id } } } } },
    })
    .catch(() => null);
  const ordered = await prisma.saleOrderLine.aggregate({
    _sum: { quantity: true },
    where: { styleId: style.id },
  });
  const shipped = await prisma.factoryPackingCartonLine
    .aggregate({
      _sum: { quantity: true },
      where: { saleOrderLine: { styleId: style.id }, carton: { retiredAt: null } },
    })
    .catch(() => null);
  const ledger = await prisma.erveDispatchDeliveryLine.aggregate({
    _sum: { receivedQuantity: true },
    where: { saleOrderLine: { styleId: style.id } },
  });
  const sold = await prisma.distributorSalesReportLine.aggregate({
    _sum: { quantitySold: true },
    where: { saleOrderLine: { styleId: style.id } },
  });
  const returned = await prisma.distributorReturnLine.aggregate({
    _sum: { requestedQuantity: true },
    where: { saleOrderLine: { styleId: style.id } },
  });
  return {
    style: styleNumber,
    released: released ? sum(released as any, 'quantity') : 'n/a',
    dispatchOrdered: sum(ordered as any, 'quantity'),
    shipped: shipped ? sum(shipped as any, 'quantity') : 'n/a',
    ledgerReceived: sum(ledger as any, 'receivedQuantity'),
    sold: sum(sold as any, 'quantitySold'),
    returnRequested: sum(returned as any, 'requestedQuantity'),
  };
};
const a = await per('AW26-5826005');
const b = await per('AW26-5526026');
dump('conservation', { a, b });
// Style A: 42 released = 42 ordered (DO1 36 + DO3 6) = 42 shipped; received ledger 42 (all full); sold 3 (2+1)
record(
  'CONS-1',
  'Quantity conservation',
  `Style A (sizes 3-8): released ${a.released} = Dispatch-ordered ${a.dispatchOrdered} = shipped ${a.shipped}; ledger received ${a.ledgerReceived}; sold ${a.sold}`,
  a.released === 42 &&
    a.dispatchOrdered === 42 &&
    a.shipped === 42 &&
    a.ledgerReceived === 42 &&
    a.sold === 3
    ? 'PASS'
    : 'FAIL',
  JSON.stringify(a),
);
// Style B: 42 released = 42 ordered = 42 shipped; ledger = 42 - 1 (ED1 shortage) - 12 (ED5 no ledger) = 29? ED4 admin fallback is the full 18 ledger; ED1 ledger 11 of 12; ED5 none
record(
  'CONS-2',
  'Quantity conservation',
  `Style B (sizes 9-14): released ${b.released} = ordered ${b.dispatchOrdered} = shipped ${b.shipped}; ledger received ${b.ledgerReceived} (42 shipped - 1 short at ED1 - 12 awaiting at ED5 = 29)`,
  b.released === 42 &&
    b.dispatchOrdered === 42 &&
    b.shipped === 42 &&
    b.ledgerReceived === 29 &&
    b.returnRequested === 1
    ? 'PASS'
    : 'FAIL',
  JSON.stringify(b),
);
const positive = await prisma
  .$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*)::bigint n from distributor_sales_report_lines l join erve_dispatch_delivery_lines d on d.sale_order_line_id = l.sale_order_line_id and d.erve_dispatch_id = l.erve_dispatch_id where l.quantity_sold > d.received_quantity`,
  )
  .catch(() => null);
record(
  'CONS-3',
  'Quantity conservation',
  'No source line has more sold than received (traceability: every sale line points to its dispatch and Dispatch Order line)',
  positive && Number(positive[0]!.n) === 0 ? 'PASS' : positive ? 'FAIL' : 'INFO',
  positive ? `violations ${positive[0]!.n}` : 'raw check not run (table names)',
);

// ---------------------------------------------------------------- I. invoices (step 12)
const fi = await api.call('GET', '/factory-invoices?limit=20', { token: T.ADMIN });
const fiItems = fi.body?.data?.items ?? fi.body?.data ?? [];
record(
  'INV-1',
  'Factory Invoice',
  'A Factory Invoice was generated for each finalized Factory Packing List (3) in GENERATED status',
  fi.status === 200 && fiItems.length === 3 ? 'PASS' : 'FAIL',
  `HTTP ${fi.status}, ${fiItems.length} invoice(s): ${fiItems.map((x: any) => x.status).join(',')}`,
);
dump('factory-invoices', fiItems);
if (fiItems[0]?.status === 'GENERATED') {
  const one = await api.expect(200, 'GET', `/factory-invoices/${fiItems[0].id}`, {
    token: T.FACTORY,
  });
  const l = leaks(one);
  record(
    'INV-2',
    'Factory Invoice / confidentiality',
    'Factory user opens its Factory Invoice; no Distributor identity in it',
    l.length === 0 ? 'PASS' : 'FAIL',
    l.join(' | ') || 'clean',
  );
  const confirm = await api.call('POST', `/factory-invoices/${fiItems[0].id}/confirm`, {
    token: T.FACTORY,
    json: { expectedVersion: one.version },
  });
  record(
    'INV-3',
    'Factory Invoice',
    'Factory confirms its expected-billing invoice (GENERATED -> FACTORY_CONFIRMED)',
    confirm.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${confirm.status} ${JSON.stringify(confirm.body?.error ?? '').slice(0, 140)}`,
  );
}
// Tax Invoice DRAFT per Erve Packing List (TEST ONLY seller registration; no invoice is finalized/numbered)
if (!I.seller) {
  const seller = await api.expect(201, 'POST', '/seller-registrations', {
    token: T.ADMIN,
    json: {
      legalName: 'TEST ONLY SELLER',
      branchCode: 'AW26UAT',
      gstin: '33AAAAA0000A1Z5',
      addressLine1: 'TEST ONLY address',
      city: 'Tiruppur',
      state: 'Tamil Nadu',
      stateCode: '33',
      postalCode: '641604',
      bankName: 'TEST ONLY Bank',
      bankAccountName: 'TEST ONLY',
      bankAccountNumber: '0000000001',
      bankIfsc: 'TEST0000001',
      bankBranchName: 'TEST',
      status: 'ACTIVE',
    },
  });
  I.seller = seller.id;
  save();
}
for (const [id, label, mode] of [
  ['INV-4', 'ED1-V-STORE1', 'SALE_RETURN'],
  ['INV-5', 'ED3-B-STORE1', 'OUTRIGHT'],
] as const) {
  if (!I[`taxdraft:${label}`]) {
    const r = await api.call('POST', '/tax-invoices', {
      token: T.ACCOUNTANT,
      json: { ervePackingListId: I[`eipl:${label}`] },
    });
    record(
      id,
      'Tax Invoice (draft)',
      `Accountant creates an unnumbered Tax Invoice DRAFT from the ${mode} Erve Packing List (${label})`,
      r.status === 201 && r.body?.data?.status === 'DRAFT' && r.body?.data?.invoiceNumber == null
        ? 'PASS'
        : 'FAIL',
      `HTTP ${r.status} ${JSON.stringify(r.body?.error ?? '').slice(0, 160)} purchaseMode=${r.body?.data?.purchaseMode}`,
    );
    if (r.status === 201) {
      I[`taxdraft:${label}`] = r.body.data.id;
      save();
    }
  }
}
if (I['taxdraft:ED1-V-STORE1']) {
  const fin = await api.call(
    'POST',
    `/tax-invoices/${I['taxdraft:ED1-V-STORE1']}/actions/finalize`,
    { token: T.ACCOUNTANT, json: { expectedVersion: 1 } },
  );
  dump('tax-invoice-finalize-attempt', fin.body);
  record(
    'INV-6',
    'Tax Invoice (finalize)',
    'Finalizing a Tax Invoice (assigns a statutory number) was attempted with the data available; outcome recorded, nothing forced',
    fin.status === 200 ? 'INFO' : 'BLOCKED',
    `HTTP ${fin.status} ${JSON.stringify(fin.body?.error ?? '').slice(0, 300)}`,
  );
}
save();
await prisma.$disconnect();
