import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { requireEwayAcceptanceEnvironment } from './eway-bill-acceptance-guard.js';

// Synthetic fixtures for the E-Way Bill browser acceptance harness (Track B / B5).
// Restricted to the disposable acceptance database; business modules are imported
// only after the environment has been proven safe. Every invoice is created and
// finalized through the real API, exactly as an Accountant would, so the
// acceptance run starts from genuine Tax Invoice data.
const safe = requireEwayAcceptanceEnvironment(process.env);

const { ROLES } = await import('@erve/types');
const { prisma } = await import('../db/prisma.js');
const { createApp } = await import('../app.js');
const { createId } = await import('@erve/shared');
const { default: request } = await import('supertest');
const { resetDatabase, createTestSellerRegistration, createTestUserAndToken } = await import(
  './helpers.js'
);
const { createSingleFactoryApprovedSaleOrder, createFactoryUserToken, packAndFinalize, ensureActiveDistributorPricing } =
  await import('../modules/fulfillment/fulfillment-test-helpers.js');

const app = createApp();

/** Invoices the scenarios consume. Each scenario owns its invoice so none depends on another's state. */
const FINALIZED_INVOICES = [
  'happy',
  'sameNumber',
  'reject',
  'timeout',
  'ambiguous',
  'duplicate',
  'link',
  'linkDuplicate',
  'dispatch',
  'authz',
  'layout',
] as const;

async function main() {
  await resetDatabase();
  await createTestSellerRegistration({
    branchCode: 'EWAY-ACCEPT',
    legalName: 'ERVE E-Way Acceptance - Synthetic Seller',
  });

  const password = randomBytes(20).toString('base64url');
  const actors = {} as Record<string, { email: string; password: string }>;
  for (const role of ROLES) {
    const email = `eway-accept-${role.toLowerCase().replaceAll('_', '-')}@erve.test`;
    const user = await createTestUserAndToken({ email, password, roles: [role] });
    await prisma.user.update({ where: { id: user.userId }, data: { name: `Acceptance ${role}` } });
    actors[role] = { email, password };
  }

  let marker = 0;
  async function sourceCarton(quantity: number) {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, quantity, 'OUTRIGHT');
    marker++;
    await prisma.style.update({
      where: { id: fixture.stock.styleId },
      data: {
        styleNumber: `EWAY-ACCEPT-${String(marker).padStart(2, '0')}`,
        styleName: `Synthetic acceptance style ${marker}`,
        colour: marker % 2 ? 'Navy' : 'Coral',
        finalMrp: '3499.99',
        description: 'Disposable E-Way Bill acceptance data',
      },
    });
    // Inter-state buyer (Maharashtra seller, Karnataka buyer), so the invoice
    // carries a complete Bill-To and Ship-To for the movement request.
    await prisma.distributor.update({
      where: { id: fixture.stock.distributorId },
      data: {
        name: `Acceptance buyer ${marker}`,
        addressLine1: '12 Verification Road, Acceptance Park',
        addressLine2: 'Synthetic recipient, not a real business',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postalCode: '560001',
        gstin: '29ABCDE1234F1Z5',
      },
    });
    // The delivery destination is the buyer's own address, so the billed party
    // and the ship-to agree and the movement classification is unambiguous.
    await prisma.saleOrderDestination.update({
      where: { id: fixture.saleOrder.destinations[0].id },
      data: {
        addressLine1: '12 Verification Road, Acceptance Park',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
      },
    });
    const rule = createId();
    const version = createId();
    const hsnId = createId();
    await prisma.gstRuleSet.create({
      data: { id: rule, code: `EWAY-ACCEPT-${marker}`, name: 'Synthetic garment acceptance rule' },
    });
    await prisma.gstRuleSetVersion.create({
      data: { id: version, gstRuleSetId: rule, versionNumber: 1, status: 'ACTIVE', effectiveFrom: new Date('2017-07-01') },
    });
    await prisma.gstValueBand.createMany({
      data: [
        { id: createId(), gstRuleSetVersionId: version, minValue: null, maxValue: 2500, gstPercent: 5 },
        { id: createId(), gstRuleSetVersionId: version, minValue: 2500, maxValue: null, gstPercent: 18 },
      ],
    });
    await prisma.hsn.create({ data: { id: hsnId, code: `6109${String(marker).padStart(4, '0')}`, gstRuleSetId: rule } });
    await prisma.style.update({ where: { id: fixture.stock.styleId }, data: { hsnId } });

    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const packed = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      quantity,
    );
    return { fixture, cartonId: packed.cartonId };
  }

  const accountantToken = (await createTestUserAndToken({
    email: 'eway-accept-fixture-creator@erve.test',
    password,
    roles: ['ACCOUNTANT'],
  })).token;

  async function invoice(finalize: boolean) {
    const source = await sourceCarton(20);
    const packing = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${source.fixture.merchToken}`)
      .send({ cartonIds: [source.cartonId] })
      .expect(201);
    const eiplId = packing.body.data.id as string;
    await ensureActiveDistributorPricing(source.fixture.stock.distributorId);
    await request(app)
      .post(`/erve-packing-lists/${eiplId}/finalize`)
      .set('Authorization', `Bearer ${source.fixture.merchToken}`)
      .send({})
      .expect(200);
    const draft = await request(app)
      .post('/tax-invoices')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ ervePackingListId: eiplId })
      .expect(201);
    const result = finalize
      ? await request(app)
          .post(`/tax-invoices/${draft.body.data.id}/actions/finalize`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({})
          .expect(200)
      : draft;
    return {
      id: result.body.data.id as string,
      invoiceNumber: (result.body.data.invoiceNumber ?? null) as string | null,
      eiplId,
      status: result.body.data.status as string,
    };
  }

  const invoices = {} as Record<string, Awaited<ReturnType<typeof invoice>>>;
  for (const name of FINALIZED_INVOICES) invoices[name] = await invoice(true);
  invoices.draft = await invoice(false);

  const fixturePath = path.resolve(
    process.env.EWAY_ACCEPTANCE_FIXTURE_PATH ?? '.artifacts/eway-bill-acceptance/fixtures.json',
  );
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  // Private inputs (synthetic passwords); only screenshots and the report are published.
  await fs.writeFile(fixturePath, JSON.stringify({ actors, invoices }, null, 2), { mode: 0o600 });
  console.log(`Prepared ${Object.keys(invoices).length} synthetic invoices in ${safe.databaseName}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'E-Way Bill acceptance fixture preparation failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
