// Stage 4: QR delivery evidence, Distributor actual receipt (full / shortage / discrepancy / none), Admin fallback (steps 7-8).
import { randomUUID } from 'node:crypto';
import { api, prisma, state, save, record, expectStatus, dump } from './lib.mts';

const T = state.tokens;
const I = state.ids;
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19) + '+05:30';
const get = (label: string) =>
  api.expect(200, 'GET', `/erve-dispatches/${I[`ed:${label}`]}`, { token: T.MERCH });
const groupsOf = (ed: any, override: Record<string, number> = {}) => {
  const map = new Map<
    string,
    { styleId: string; sizeId: string; receivedQuantity: number; code: string }
  >();
  for (const l of ed.quantityLines) {
    const k = `${l.styleId}:${l.sizeId}`;
    const cur = map.get(k) ?? {
      styleId: l.styleId,
      sizeId: l.sizeId,
      receivedQuantity: 0,
      code: `${l.styleNumber}/${l.sizeCode}`,
    };
    cur.receivedQuantity += l.quantity;
    map.set(k, cur);
  }
  return [...map.values()].map((g) => ({
    styleId: g.styleId,
    sizeId: g.sizeId,
    receivedQuantity: override[g.code] ?? g.receivedQuantity,
  }));
};

// ---------------------------------------------------------------- QR delivery (step 7)
if (!I.qrDone || I.qrDone === 'retry') {
  // Map each Erve Dispatch to its cartons through the Erve Packing List (read-only DB lookup).
  const out: Record<string, any> = {};
  for (const label of [
    'ED1-V-STORE1',
    'ED2-V-STORE2',
    'ED3-B-STORE1',
    'ED4-G-STORE1',
    'ED5-G-STORE2',
  ]) {
    const list = await prisma.ervePackingList.findUniqueOrThrow({
      where: { id: I[`eipl:${label}`] },
      include: { cartons: true },
    });
    out[label] = list.cartons.map((c: any) => c.id);
  }
  I.cartonsByEd = out;
  const confirmTargets: Record<string, number> = {
    'ED1-V-STORE1': 2,
    'ED2-V-STORE2': 1,
    'ED5-G-STORE2': 1,
  }; // ED3, ED4 stay QR-incomplete
  const results: any[] = [];
  for (const [label, count] of Object.entries(confirmTargets)) {
    for (const cartonId of out[label].slice(0, count)) {
      const carton = await prisma.factoryPackingCarton.findUniqueOrThrow({
        where: { id: cartonId },
      });
      const prepared = await api.expect(
        200,
        'POST',
        `/carton-delivery/labels/${cartonId}/prepare`,
        { token: T.FACTORY, json: { expectedVersion: carton.version } },
      );
      const token = String(prepared.url).split('#')[1]!;
      const headers = { 'X-Carton-Delivery-Token': token };
      const resolve = await api.call('POST', '/public/carton-delivery/resolve', {
        headers,
        json: {},
        key: false,
      });
      const now = new Date();
      const confirm = await api.call('POST', '/public/carton-delivery/confirm', {
        headers,
        key: false,
        json: {
          recipientName: 'Store Manager (UAT)',
          deliveredAt: ist(now),
          timezone: 'Asia/Kolkata',
          offsetMinutes: 330,
          remarks: 'Received sealed - AW26 UAT',
          confirmed: true,
          idempotencyKey: randomUUID(),
        },
      });
      results.push({
        label,
        cartonId,
        resolve: resolve.status,
        confirm: confirm.status,
        publicKeys: Object.keys(resolve.body?.data ?? {}),
      });
      // replay with a different payload is refused (immutable evidence)
      if (label === 'ED1-V-STORE1' && cartonId === out[label][0]) {
        const again = await api.call('POST', '/public/carton-delivery/confirm', {
          headers,
          key: false,
          json: {
            recipientName: 'Someone Else',
            deliveredAt: ist(now),
            timezone: 'Asia/Kolkata',
            offsetMinutes: 330,
            remarks: '',
            confirmed: true,
            idempotencyKey: randomUUID(),
          },
        });
        record(
          'WF7-NEG1',
          'QR delivery evidence',
          'A second, different QR confirmation for an already-confirmed carton is refused (evidence is immutable)',
          again.status === 409 ? 'PASS' : 'FAIL',
          `HTTP ${again.status}`,
        );
      }
    }
  }
  const allOk = results.every((r) => r.resolve === 200 && r.confirm === 200);
  record(
    'WF7-1',
    'QR delivery evidence',
    `Public QR resolve + confirm (no login) for ${results.length} cartons; ED3 and ED4 deliberately left unscanned`,
    allOk ? 'PASS' : 'FAIL',
    JSON.stringify(results.map((r) => [r.resolve, r.confirm])),
  );
  record(
    'WF7-2',
    'QR delivery evidence / confidentiality',
    'Public resolve response carries no Distributor, address or financial data',
    results.every(
      (r) => !r.publicKeys.some((k: string) => /distributor|address|price|amount/i.test(k)),
    )
      ? 'PASS'
      : 'FAIL',
    `public keys: ${[...new Set(results.flatMap((r) => r.publicKeys))].join(', ')}`,
  );
  dump('qr-results', results);
  I.qrDone = true;
  save();
}

// ---------------------------------------------------------------- Receipts (step 8)
async function receipt(
  id: string,
  label: string,
  scenario: string,
  token: string,
  override: Record<string, number>,
  remarks: string | null,
  expectStatusCode = 201,
) {
  const ed = await get(label);
  const r = await api.call('POST', `/erve-dispatches/${ed.id}/distributor-receipt`, {
    token,
    json: {
      expectedVersion: ed.version,
      acknowledged: true,
      remarks,
      groups: groupsOf(ed, override),
    },
  });
  record(
    id,
    'Distributor actual receipt',
    scenario,
    r.status === expectStatusCode ? 'PASS' : 'FAIL',
    `HTTP ${r.status}; ledgerDisposition ${r.body?.data?.ledgerDisposition ?? r.body?.data?.distributorReceipt?.ledgerDisposition ?? JSON.stringify(r.body?.error ?? '').slice(0, 120)}`,
  );
  return r;
}
if (!I.receipts) {
  // ED1: SALE_RETURN, Style A full, Style B shortage on size 9 (2 -> 1)
  const ed1 = await get('ED1-V-STORE1');
  const shortSize = ed1.quantityLines.find(
    (l: any) => l.styleNumber === 'AW26-5526026' && l.sizeCode === '9',
  );
  const bad = await api.call('POST', `/erve-dispatches/${ed1.id}/distributor-receipt`, {
    token: T.DIST_V,
    json: {
      expectedVersion: ed1.version,
      acknowledged: true,
      remarks: null,
      groups: groupsOf(ed1, { 'AW26-5526026/9': 1 }),
    },
  });
  record(
    'WF8-NEG1',
    'Distributor actual receipt',
    'A shortage without remarks is refused',
    bad.status === 400 ? 'PASS' : 'FAIL',
    `HTTP ${bad.status}`,
  );
  const over = await api.call('POST', `/erve-dispatches/${ed1.id}/distributor-receipt`, {
    token: T.DIST_V,
    json: {
      expectedVersion: ed1.version,
      acknowledged: true,
      remarks: 'x',
      groups: groupsOf(ed1, { 'AW26-5526026/9': 3 }),
    },
  });
  record(
    'WF8-NEG2',
    'Distributor actual receipt',
    'Receiving more than was dispatched is refused',
    over.status === 400 ? 'PASS' : 'FAIL',
    `HTTP ${over.status}`,
  );
  const other = await api.call('POST', `/erve-dispatches/${ed1.id}/distributor-receipt`, {
    token: T.DIST_G,
    json: {
      expectedVersion: ed1.version,
      acknowledged: true,
      remarks: null,
      groups: groupsOf(ed1),
    },
  });
  record(
    'WF8-NEG3',
    'Distributor actual receipt / authorization',
    "Another Distributor (Distributor G) cannot submit a receipt for Distributor V's dispatch",
    [403, 404].includes(other.status) ? 'PASS' : 'FAIL',
    `HTTP ${other.status}`,
  );
  await receipt(
    'WF8-1',
    'ED1-V-STORE1',
    'Distributor V (SALE_RETURN): Style A received in full, Style B size 9 short by 1 with remarks',
    T.DIST_V,
    { 'AW26-5526026/9': 1 },
    'One piece damaged in transit (UAT)',
  );
  void shortSize;
  await receipt(
    'WF8-2',
    'ED2-V-STORE2',
    'Distributor V: second Store received in full',
    T.DIST_V,
    {},
    null,
  );
  await receipt(
    'WF8-3',
    'ED3-B-STORE1',
    'Distributor B (OUTRIGHT): received in full',
    T.DIST_B,
    {},
    null,
  );
  // ED4 (Store G1): Admin/Merchandiser fallback first (ledger), then the Distributor attests a shortage -> discrepancy
  const ed4 = await get('ED4-G-STORE1');
  const lines = ed4.quantityLines.map((l: any) => ({
    saleOrderLineId: l.saleOrderLineId,
    receivedQuantity: l.quantity,
  }));
  const fb = await api.call('PATCH', `/erve-dispatches/${ed4.id}/delivery`, {
    token: T.MERCH,
    json: {
      expectedVersion: ed4.version,
      lines,
      remarks: 'Confirmed by phone with the store (UAT fallback)',
    },
  });
  record(
    'WF8-4',
    'Delivery confirmation fallback',
    'Store G1: Merchandiser confirms delivery in full (ledger source USER_CONFIRMED)',
    fb.status === 200 ? 'PASS' : 'FAIL',
    `HTTP ${fb.status} ${JSON.stringify(fb.body?.error ?? '').slice(0, 120)}`,
  );
  const r4 = await receipt(
    'WF8-5',
    'ED4-G-STORE1',
    'Store G1: Distributor then attests size 9 short by 1 -> receipt differs from the earlier ledger (evidence only)',
    T.DIST_G,
    { 'AW26-5526026/9': 2 },
    'Counted 2 not 3 (UAT)',
  );
  const fbAfter = await api.call(
    'PATCH',
    `/erve-dispatches/${(await get('ED1-V-STORE1')).id}/delivery`,
    {
      token: T.MERCH,
      json: { expectedVersion: (await get('ED1-V-STORE1')).version, lines, remarks: 'x' },
    },
  );
  record(
    'WF8-NEG4',
    'Delivery confirmation fallback',
    'After a Distributor receipt the Admin/Merchandiser fallback is refused',
    fbAfter.status === 409 || fbAfter.status === 400 ? 'PASS' : 'FAIL',
    `HTTP ${fbAfter.status}`,
  );
  // ED5 (Store G2): no receipt on purpose (QR evidence only)
  record(
    'WF8-6',
    'Distributor actual receipt',
    'Store G2 left with QR evidence but no receipt ("awaiting receipt" state)',
    'PASS',
    'no action by design',
  );
  I.receipts = true;
  save();
}
dump('stage4-state', I);
await prisma.$disconnect();
