// Stage 2: Dispatch Orders (OUTRIGHT + SALE_RETURN, 3 Distributors, 6 Retail Stores) -> Factory Packing -> Packing Audit ->
// Factory Dispatch -> Erve Packing Lists -> Erve Dispatches -> transporter/LR (workflow steps 3-6). HTTP only.
import { api, prisma, state, save, record, expectStatus, dump, cfg } from './lib.mts';

const T = state.tokens;
const I = state.ids;
const date = new Date().toISOString().slice(0, 10);
const store = async (distributorId: string, name: string) =>
  prisma.retailStore.findFirstOrThrow({ where: { distributorId, name } });
const dest = (key: string, s: Awaited<ReturnType<typeof store>>) => ({
  clientKey: key,
  retailStoreId: s.id,
  addressLine1: s.addressLine1,
  addressLine2: s.addressLine2,
  city: s.city,
  state: s.state,
  country: s.country,
  postalCode: s.postalCode,
});

async function createDO(
  label: string,
  groups: {
    distributorId: string;
    destinations: {
      key: string;
      store: Awaited<ReturnType<typeof store>>;
      style: string;
      qty: number;
    }[];
  }[],
) {
  if (I[`do:${label}`]) return;
  const so = await api.expect(201, 'POST', '/sale-orders', {
    token: T.MERCH,
    json: {
      distributors: groups.map((g, gi) => ({
        clientKey: `g${gi}`,
        distributorId: g.distributorId,
        destinations: g.destinations.map((d) => dest(d.key, d.store)),
      })),
      factoryId: I.rahaa,
      soDate: date,
      lines: groups.flatMap((g) =>
        g.destinations.map((d) => ({
          destinationClientKey: d.key,
          styleId: d.style,
          totalQuantity: d.qty,
        })),
      ),
    },
  });
  dump(`dispatch-order-${label}`, so);
  I[`do:${label}`] = so.id;
  save();
  return so;
}

const storeV1 = await store(I.V, cfg.store.V1);
const storeV2 = await store(I.V, cfg.store.V2);
const bStore = await store(I.B, cfg.store.B1);
const gStore1 = await store(I.G, cfg.store.G1);
const storeG2 = await store(I.G, cfg.store.G2);

const do1 = await createDO('DO1', [
  {
    distributorId: I.V,
    destinations: [
      { key: 'v1', store: storeV1, style: I.styleA, qty: 12 },
      { key: 'v2', store: storeV2, style: I.styleA, qty: 12 },
    ],
  },
  { distributorId: I.B, destinations: [{ key: 'b1', store: bStore, style: I.styleA, qty: 12 }] },
]);
const do2 = await createDO('DO2', [
  {
    distributorId: I.G,
    destinations: [
      { key: 'g1', store: gStore1, style: I.styleB, qty: 18 },
      { key: 'g2', store: storeG2, style: I.styleB, qty: 12 },
    ],
  },
  { distributorId: I.V, destinations: [{ key: 'v1', store: storeV1, style: I.styleB, qty: 12 }] },
]);
if (do1) {
  record(
    'WF3-DO1',
    'Dispatch Order',
    'DO1: Style A (sizes 3-8), 2 Distributors (SALE_RETURN + OUTRIGHT), 3 Retail Stores in one Dispatch Order',
    'PASS',
    `${do1.saleOrderNumber ?? do1.id}`,
  );
  record(
    'WF3-DO2',
    'Dispatch Order',
    'DO2: Style B (sizes 9-14), 2 Distributors (both SALE_RETURN), 3 destinations',
    'PASS',
    `${do2.saleOrderNumber ?? do2.id}`,
  );
}
console.log(
  'DO1 keys',
  Object.keys(await api.expect(200, 'GET', `/sale-orders/${I['do:DO1']}`, { token: T.MERCH })),
);
await prisma.$disconnect();
