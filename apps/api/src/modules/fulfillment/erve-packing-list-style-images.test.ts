import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  createApprovedSaleOrder,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function pngFixture(fillByte: number): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.alloc(17, fillByte),
  ]);
}
const PNG_A = pngFixture(0xaa);
const PNG_B = pngFixture(0xbb);

function uploadStyleImage(token: string, styleId: string, data: Buffer) {
  return request(app)
    .post(`/styles/${styleId}/images`)
    .set('Authorization', `Bearer ${token}`)
    .attach('image', data, { filename: 'photo.png', contentType: 'image/png' });
}

function readStyleImageContent(token: string, styleId: string, imageId: string) {
  return request(app)
    .get(`/styles/${styleId}/images/${imageId}/content`)
    .set('Authorization', `Bearer ${token}`);
}

// ISS-053: before this fix, ErvePackingListCartonView.lines[] and
// ErvePackingListStyleSizeSummaryRow carried only styleNumber/styleName — never a real Style UUID
// or its primary image — so the web detail page and PDF had no authenticated image reference to
// address, regardless of whether the Style actually had an uploaded photo.
describe('ISS-053 — Erve Packing List Style identity and image projection', () => {
  it("projects each line's real Style UUID (never styleNumber) and resolves its uploaded primary image on both cartons and the Style/Size Summary", async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 20);
    const uploaded = await uploadStyleImage(fixture.merchToken, fixture.stock.styleId, PNG_A).expect(201);
    const imageId = uploaded.body.data.id as string;

    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 20);
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    const detail = await request(app)
      .get(`/erve-packing-lists/${created.body.data.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    const line = detail.body.data.cartons[0].lines[0];
    expect(line.styleId).toBe(fixture.stock.styleId);
    expect(line.styleId).not.toBe(line.styleNumber);
    expect(line.primaryImage.id).toBe(imageId);

    const summaryRow = detail.body.data.styleSizeSummary[0];
    expect(summaryRow.styleId).toBe(fixture.stock.styleId);
    expect(summaryRow.primaryImage.id).toBe(imageId);

    // The real UUID is exactly what the authenticated Style image endpoint needs — and any role
    // authorized to view this Erve Packing List (MERCHANDISER here) is already authorized to read
    // it, with no new endpoint or permission required (see canReadStyleImages/assertStyleImageReadAccess).
    const content = await readStyleImageContent(fixture.merchToken, line.styleId, line.primaryImage.id).expect(200);
    expect(Buffer.from(content.body).equals(PNG_A)).toBe(true);
  });

  it('resolves a null primaryImage (never a placeholder styleId) for a Style with no uploaded image', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 15);
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(app, factoryToken, fixture.saleOrder.id, fixture.saleOrderLineId, fixture.saleOrder.destinations[0].id, 15);
    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .send({ cartonIds: [dispatch.cartonId] })
      .expect(201);

    const detail = await request(app)
      .get(`/erve-packing-lists/${created.body.data.id}`)
      .set('Authorization', `Bearer ${fixture.merchToken}`)
      .expect(200);

    expect(detail.body.data.cartons[0].lines[0].primaryImage).toBeNull();
    expect(detail.body.data.styleSizeSummary[0].primaryImage).toBeNull();
    // The real UUID is still correctly present even with no image uploaded.
    expect(detail.body.data.cartons[0].lines[0].styleId).toBe(fixture.stock.styleId);
  });

  it('keeps two distinct Styles consolidated into the same Erve Packing List correctly, never-swapped with each other', async () => {
    const orderA = await createApprovedSaleOrder(app, { quantity: 10 });
    const orderB = await createApprovedSaleOrder(app, {
      distributorId: orderA.stock.distributorId,
      quantity: 15,
      retailStoreId: orderA.saleOrder.destinations[0].retailStoreId,
    });
    expect(orderA.stock.styleId).not.toBe(orderB.stock.styleId);

    const imageA = await uploadStyleImage(orderA.merchToken, orderA.stock.styleId, PNG_A).expect(201);
    const imageB = await uploadStyleImage(orderB.merchToken, orderB.stock.styleId, PNG_B).expect(201);

    const factoryTokenA = await createFactoryUserToken(orderA.stock.factoryId);
    const factoryTokenB = await createFactoryUserToken(orderB.stock.factoryId);
    const dispatchA = await packAndFinalize(app, factoryTokenA, orderA.saleOrder.id, orderA.saleOrderLineId, orderA.saleOrder.destinations[0].id, 10);
    const dispatchB = await packAndFinalize(app, factoryTokenB, orderB.saleOrder.id, orderB.saleOrderLineId, orderB.saleOrder.destinations[0].id, 15);

    const created = await request(app)
      .post('/erve-packing-lists')
      .set('Authorization', `Bearer ${orderA.merchToken}`)
      .send({ cartonIds: [dispatchA.cartonId, dispatchB.cartonId] })
      .expect(201);

    const detail = await request(app)
      .get(`/erve-packing-lists/${created.body.data.id}`)
      .set('Authorization', `Bearer ${orderA.merchToken}`)
      .expect(200);

    // ISS-053's packing/quantity regression guard: adding Style images must never change
    // consolidated quantities/carton counts.
    expect(detail.body.data.cartonCount).toBe(2);
    expect(detail.body.data.totalQuantity).toBe(25);

    const summaryByStyle = new Map(detail.body.data.styleSizeSummary.map((row: { styleId: string }) => [row.styleId, row]));
    const rowA = summaryByStyle.get(orderA.stock.styleId) as { primaryImage: { id: string } } | undefined;
    const rowB = summaryByStyle.get(orderB.stock.styleId) as { primaryImage: { id: string } } | undefined;
    expect(rowA?.primaryImage.id).toBe(imageA.body.data.id);
    expect(rowB?.primaryImage.id).toBe(imageB.body.data.id);
    expect(rowA?.primaryImage.id).not.toBe(rowB?.primaryImage.id);

    const contentA = await readStyleImageContent(orderA.merchToken, orderA.stock.styleId, imageA.body.data.id).expect(200);
    const contentB = await readStyleImageContent(orderA.merchToken, orderB.stock.styleId, imageB.body.data.id).expect(200);
    expect(Buffer.from(contentA.body).equals(PNG_A)).toBe(true);
    expect(Buffer.from(contentB.body).equals(PNG_B)).toBe(true);
  });

  it('rejects a role that cannot view Style images at all from reading an Erve-Packing-List-sourced Style image, even knowing its real id', async () => {
    const fixture = await createSingleFactoryApprovedSaleOrder(app, 10);
    const uploaded = await uploadStyleImage(fixture.merchToken, fixture.stock.styleId, PNG_A).expect(201);

    // DISTRIBUTOR can view other Erve/fulfillment data (ERVE_DISPATCH_VIEW_ROLES) but is outside
    // both ERVE_PACKING_LIST_VIEW_ROLES and canReadStyleImages — this is the defense-in-depth check
    // on the image endpoint itself, independent of the Erve Packing List route gate.
    const distributorToken = await createDistributorToken(fixture.stock.distributorId);
    await readStyleImageContent(distributorToken, fixture.stock.styleId, uploaded.body.data.id).expect(403);

    const { token: accountantToken } = await createRoleToken('ACCOUNTANT');
    await readStyleImageContent(accountantToken, fixture.stock.styleId, uploaded.body.data.id).expect(403);
  });
});
