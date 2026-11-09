import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import {
  confirmErveDispatchDelivery,
  consolidateAndDispatch,
  createDistributorToken,
  createFactoryUserToken,
  createRoleToken,
  createSingleFactoryApprovedSaleOrder,
  packAndFinalize,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.alloc(17, 0xcc),
]);

/** A delivered Sale-or-Return dispatch whose Style has (or has not) an uploaded primary image. */
async function fixture(options: { withImage: boolean }) {
  const f = await createSingleFactoryApprovedSaleOrder(app, 100, 'SALE_RETURN');
  let imageId: string | null = null;
  if (options.withImage) {
    const uploaded = await request(app)
      .post(`/styles/${f.stock.styleId}/images`)
      .set('Authorization', `Bearer ${f.merchToken}`)
      .attach('image', PNG, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    imageId = uploaded.body.data.id as string;
  }
  const factoryToken = await createFactoryUserToken(f.stock.factoryId);
  const factoryDispatch = await packAndFinalize(app, factoryToken, f.saleOrder.id, f.saleOrderLineId, f.saleOrder.destinations[0].id, 100);
  const dispatch = await consolidateAndDispatch(app, f.merchToken, [factoryDispatch.cartonId]);
  const delivered = await confirmErveDispatchDelivery(app, f.merchToken, dispatch.id, dispatch.version, [
    { saleOrderLineId: f.saleOrderLineId, receivedQuantity: 100 },
  ]);
  const distributorToken = await createDistributorToken(f.stock.distributorId);
  const accountantToken = (await createRoleToken('ACCOUNTANT')).token;
  const seniorToken = (await createRoleToken('SENIOR_MANAGEMENT')).token;
  const size = await prisma.size.findFirstOrThrow({ where: { saleOrderLines: { some: { id: f.saleOrderLineId } } } });
  return { ...f, imageId, dispatch: delivered.body.data, distributorToken, accountantToken, seniorToken, size };
}

const get = (path: string, token: string) => request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('post-dispatch Style x Size presentation identity (ISS-023 / DEMO-003)', () => {
  describe('GET /sale-or-return-positions', () => {
    it('adds the real Style/Size ids, canonical Size order and primary image for roles that may read Style images', async () => {
      const f = await fixture({ withImage: true });
      for (const token of [f.merchToken, f.seniorToken]) {
        const res = await get('/sale-or-return-positions', token).expect(200);
        const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === f.saleOrderLineId);
        expect(row.styleId).toBe(f.stock.styleId);
        expect(row.styleId).not.toBe(row.styleNumber);
        expect(row.sizeId).toBe(f.size.id);
        expect(row.sizeSortOrder).toBe(f.size.sortOrder);
        expect(row.primaryImage.id).toBe(f.imageId);
        // Untouched quantity semantics.
        expect(row.dispatchedQuantity).toBe(100);
        expect(row.remainingWithDistributor).toBe(100);
      }
    });

    it('keeps the identity but never exposes image metadata to roles that cannot read Style images (no new read scope)', async () => {
      const f = await fixture({ withImage: true });
      for (const token of [f.distributorToken, f.accountantToken]) {
        const res = await get('/sale-or-return-positions', token).expect(200);
        const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === f.saleOrderLineId);
        expect(row.styleId).toBe(f.stock.styleId);
        expect(row.primaryImage).toBeNull();
      }
      // ...which is exactly the set the image endpoint itself refuses.
      await get(`/styles/${f.stock.styleId}/images/${f.imageId}/content`, f.distributorToken).expect(403);
      await get(`/styles/${f.stock.styleId}/images/${f.imageId}/content`, f.accountantToken).expect(403);
    });

    it('resolves a null primaryImage for a Style with no uploaded image', async () => {
      const f = await fixture({ withImage: false });
      const res = await get('/sale-or-return-positions', f.merchToken).expect(200);
      expect(res.body.data.items[0].primaryImage).toBeNull();
      expect(res.body.data.items[0].styleId).toBe(f.stock.styleId);
    });

    it('keeps pagination behaviour: the identity is added per page item without changing items or cursor', async () => {
      const f = await fixture({ withImage: true });
      const res = await get('/sale-or-return-positions?limit=1', f.merchToken).expect(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.pageInfo).toEqual({ limit: 1, hasMore: false, nextCursor: null });
    });
  });

  describe('Distributor Sales Report detail', () => {
    it('projects Style/Size identity, source order and primary image on the detail, gated like the image endpoint', async () => {
      const f = await fixture({ withImage: true });
      const submitted = await request(app)
        .post('/distributor-sales-reports')
        .set('Authorization', `Bearer ${f.distributorToken}`)
        .send({
          distributorId: f.stock.distributorId,
          reportDate: '2026-08-01',
          lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, quantitySold: 25 }],
        })
        .expect(201);
      const reportId = submitted.body.data.id as string;

      const merch = await get(`/distributor-sales-reports/${reportId}`, f.merchToken).expect(200);
      const line = merch.body.data.lines[0];
      expect(line).toMatchObject({
        saleOrderLineId: f.saleOrderLineId,
        saleOrderId: f.saleOrder.id,
        saleOrderNumber: f.saleOrder.saleOrderNumber,
        styleId: f.stock.styleId,
        sizeId: f.size.id,
        sizeSortOrder: f.size.sortOrder,
        quantitySold: 25,
      });
      expect(line.primaryImage.id).toBe(f.imageId);

      const distributor = await get(`/distributor-sales-reports/${reportId}`, f.distributorToken).expect(200);
      expect(distributor.body.data.lines[0].primaryImage).toBeNull();
      expect(distributor.body.data.lines[0].styleId).toBe(f.stock.styleId);
      expect(distributor.body.data.lines[0].quantitySold).toBe(25);

      // The list never renders lines, so it never pays for (or leaks) image metadata.
      const list = await get('/distributor-sales-reports', f.merchToken).expect(200);
      expect(list.body.data.items[0].lines[0].primaryImage).toBeNull();
      expect(list.body.data.items[0].lines[0].styleId).toBe(f.stock.styleId);
    });
  });

  describe('Distributor Return detail', () => {
    it('projects Style/Size identity, source order and primary image on the detail without changing the line id or quantities', async () => {
      const f = await fixture({ withImage: true });
      const submitted = await request(app)
        .post('/distributor-returns')
        .set('Authorization', `Bearer ${f.distributorToken}`)
        .send({
          distributorId: f.stock.distributorId,
          returnDate: '2026-09-01',
          returnReason: 'End of season',
          lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, requestedQuantity: 30 }],
        })
        .expect(201);
      const returnId = submitted.body.data.id as string;
      const lineId = submitted.body.data.lines[0].id as string;

      const merch = await get(`/distributor-returns/${returnId}`, f.merchToken).expect(200);
      const line = merch.body.data.lines[0];
      expect(line).toMatchObject({
        id: lineId,
        saleOrderLineId: f.saleOrderLineId,
        saleOrderId: f.saleOrder.id,
        saleOrderNumber: f.saleOrder.saleOrderNumber,
        styleId: f.stock.styleId,
        sizeId: f.size.id,
        sizeSortOrder: f.size.sortOrder,
        requestedQuantity: 30,
        approvedQuantity: null,
        receivedQuantity: null,
      });
      expect(line.primaryImage.id).toBe(f.imageId);

      const accountant = await get(`/distributor-returns/${returnId}`, f.accountantToken).expect(200);
      expect(accountant.body.data.lines[0].primaryImage).toBeNull();
      expect(accountant.body.data.lines[0].styleId).toBe(f.stock.styleId);

      const list = await get('/distributor-returns', f.merchToken).expect(200);
      expect(list.body.data.items[0].lines[0].primaryImage).toBeNull();
    });
  });

  describe('A5 reconciliation detail', () => {
    it('adds sizeCode and the primary image to the read path for image-readers only', async () => {
      const f = await fixture({ withImage: true });
      const merch = await get(`/erve-dispatches/${f.dispatch.id}/reconciliation`, f.merchToken).expect(200);
      const line = merch.body.data.lines[0];
      expect(line.styleId).toBe(f.stock.styleId);
      expect(line.sizeId).toBe(f.size.id);
      expect(line.sizeCode).toBe(f.size.code);
      expect(line.sizeSortOrder).toBe(f.size.sortOrder);
      expect(line.primaryImage.id).toBe(f.imageId);
      expect(line.dispatchedQuantity).toBe(100);

      const accountant = await get(`/erve-dispatches/${f.dispatch.id}/reconciliation`, f.accountantToken).expect(200);
      expect(accountant.body.data.lines[0].primaryImage).toBeNull();
      expect(accountant.body.data.lines[0].sizeCode).toBe(f.size.code);
      // Same evidence, same token: presentation identity cannot change a snapshot comparison.
      expect(accountant.body.data.summary.snapshotToken).toBe(merch.body.data.summary.snapshotToken);
    });

    it('keeps viewer-dependent presentation identity out of the immutable review snapshot', async () => {
      const f = await fixture({ withImage: true });
      const detail = await get(`/erve-dispatches/${f.dispatch.id}/reconciliation`, f.merchToken).expect(200);
      await request(app)
        .post(`/erve-dispatches/${f.dispatch.id}/reconciliation/reviews`)
        .set('Authorization', `Bearer ${f.merchToken}`)
        .send({
          action: 'ACKNOWLEDGE',
          remarks: 'Reviewed',
          snapshotToken: detail.body.data.summary.snapshotToken,
          previousReviewId: detail.body.data.summary.latestReviewId,
        })
        .expect(201);

      const stored = await prisma.erveDispatchReconciliationReview.findFirstOrThrow({ where: { erveDispatchId: f.dispatch.id } });
      const snapshot = stored.snapshot as { lines: Array<Record<string, unknown>> };
      expect(snapshot.lines[0]).toMatchObject({ saleOrderLineId: f.saleOrderLineId, dispatchedQuantity: 100 });
      expect(snapshot.lines[0]).not.toHaveProperty('primaryImage');
      expect(snapshot.lines[0]).not.toHaveProperty('sizeCode');
    });
  });
});
