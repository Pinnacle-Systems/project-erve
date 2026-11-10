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

type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * Non-null metadata is not proof of a working thumbnail: the projected styleId + primaryImage.id must
 * be an image the SAME user can fetch through the authenticated content endpoint the UI calls.
 */
async function expectUsableImage(token: string, styleId: string, image: { id: string } | null, imageId: string | null) {
  expect(image).not.toBeNull();
  expect(image!.id).toBe(imageId);
  const content = await get(`/styles/${styleId}/images/${image!.id}/content`, token).expect(200);
  expect(content.headers['content-type']).toBe('image/png');
}

async function submitReport(f: Fixture, quantitySold = 25) {
  const res = await request(app)
    .post('/distributor-sales-reports')
    .set('Authorization', `Bearer ${f.distributorToken}`)
    .send({
      distributorId: f.stock.distributorId,
      reportDate: '2026-08-01',
      lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, quantitySold }],
    })
    .expect(201);
  return res.body.data.id as string;
}

async function submitReturn(f: Fixture, requestedQuantity = 30) {
  const res = await request(app)
    .post('/distributor-returns')
    .set('Authorization', `Bearer ${f.distributorToken}`)
    .send({
      distributorId: f.stock.distributorId,
      returnDate: '2026-09-01',
      returnReason: 'End of season',
      lines: [{ erveDispatchId: f.dispatch.id, saleOrderLineId: f.saleOrderLineId, requestedQuantity }],
    })
    .expect(201);
  return res.body as { data: { id: string; lines: Array<{ id: string }> } };
}

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

    it('gives an Accountant and the owning Distributor usable primary images (policy: Accountant any, Distributor own)', async () => {
      const f = await fixture({ withImage: true });
      for (const token of [f.distributorToken, f.accountantToken]) {
        const res = await get('/sale-or-return-positions', token).expect(200);
        const row = res.body.data.items.find((r: { saleOrderLineId: string }) => r.saleOrderLineId === f.saleOrderLineId);
        expect(row.styleId).toBe(f.stock.styleId);
        await expectUsableImage(token, row.styleId, row.primaryImage, f.imageId);
      }
    });

    it('scopes a Distributor to its own positions: a foreign position and image never appear, and cannot be requested', async () => {
      const a = await fixture({ withImage: true });
      const b = await fixture({ withImage: true });
      expect(a.stock.distributorId).not.toBe(b.stock.distributorId);
      const own = await get('/sale-or-return-positions', a.distributorToken).expect(200);
      const ids = own.body.data.items.map((r: { saleOrderLineId: string }) => r.saleOrderLineId);
      expect(ids).toContain(a.saleOrderLineId);
      expect(ids).not.toContain(b.saleOrderLineId);
      expect(JSON.stringify(own.body)).not.toContain(b.imageId!);
      // Explicitly asking for the other Distributor is refused outright - no scope widening, no images.
      const foreign = await get(`/sale-or-return-positions?distributorId=${b.stock.distributorId}`, a.distributorToken);
      expect(foreign.status).toBe(403);
      expect(JSON.stringify(foreign.body)).not.toContain(b.imageId!);
    });

    it('resolves a null primaryImage for a Style with no uploaded image', async () => {
      const f = await fixture({ withImage: false });
      for (const token of [f.merchToken, f.distributorToken, f.accountantToken]) {
        const res = await get('/sale-or-return-positions', token).expect(200);
        // A genuine missing image: the Style has none, so the UI placeholder is correct (not a denial).
        expect(res.body.data.items[0].primaryImage).toBeNull();
        expect(res.body.data.items[0].styleId).toBe(f.stock.styleId);
      }
    });

    it('keeps pagination behaviour: the identity is added per page item without changing items or cursor', async () => {
      const f = await fixture({ withImage: true });
      const res = await get('/sale-or-return-positions?limit=1', f.merchToken).expect(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.pageInfo).toEqual({ limit: 1, hasMore: false, nextCursor: null });
    });
  });

  describe('Distributor Sales Report detail', () => {
    it('projects Style/Size identity, source order and a usable primary image for Merchandiser, Accountant and the owning Distributor', async () => {
      const f = await fixture({ withImage: true });
      const reportId = await submitReport(f, 25);

      const merch = await get(`/distributor-sales-reports/${reportId}`, f.merchToken).expect(200);
      expect(merch.body.data.lines[0]).toMatchObject({
        saleOrderLineId: f.saleOrderLineId,
        saleOrderId: f.saleOrder.id,
        saleOrderNumber: f.saleOrder.saleOrderNumber,
        styleId: f.stock.styleId,
        sizeId: f.size.id,
        sizeSortOrder: f.size.sortOrder,
        quantitySold: 25,
      });
      for (const token of [f.merchToken, f.accountantToken, f.distributorToken]) {
        const res = await get(`/distributor-sales-reports/${reportId}`, token).expect(200);
        const line = res.body.data.lines[0];
        expect(line.styleId).toBe(f.stock.styleId);
        expect(line.quantitySold).toBe(25);
        await expectUsableImage(token, line.styleId, line.primaryImage, f.imageId);
      }

      // The list never renders lines, so it never pays for (or leaks) image metadata.
      const list = await get('/distributor-sales-reports', f.merchToken).expect(200);
      expect(list.body.data.items[0].lines[0].primaryImage).toBeNull();
      expect(list.body.data.items[0].lines[0].styleId).toBe(f.stock.styleId);
    });

    it('refuses another Distributor the report and releases none of its image metadata', async () => {
      const a = await fixture({ withImage: true });
      const b = await fixture({ withImage: true });
      const reportId = await submitReport(a);
      const res = await get(`/distributor-sales-reports/${reportId}`, b.distributorToken);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(a.imageId!);
      expect(JSON.stringify(res.body)).not.toContain(a.stock.styleId);
      // ...and the other Distributor's image bytes stay closed to them too.
      await get(`/styles/${a.stock.styleId}/images/${a.imageId}/content`, b.distributorToken).expect(403);
    });

    it('resolves a null primaryImage (genuine placeholder) for a Style with no image', async () => {
      const f = await fixture({ withImage: false });
      const reportId = await submitReport(f);
      for (const token of [f.accountantToken, f.distributorToken]) {
        const res = await get(`/distributor-sales-reports/${reportId}`, token).expect(200);
        expect(res.body.data.lines[0].primaryImage).toBeNull();
        expect(res.body.data.lines[0].styleId).toBe(f.stock.styleId);
      }
    });
  });

  describe('Distributor Return detail', () => {
    it('projects Style/Size identity, source order and a usable primary image without changing the line id or quantities', async () => {
      const f = await fixture({ withImage: true });
      const submitted = await submitReturn(f, 30);
      const returnId = submitted.data.id;
      const lineId = submitted.data.lines[0]!.id;

      const merch = await get(`/distributor-returns/${returnId}`, f.merchToken).expect(200);
      expect(merch.body.data.lines[0]).toMatchObject({
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
      for (const token of [f.merchToken, f.accountantToken, f.distributorToken]) {
        const res = await get(`/distributor-returns/${returnId}`, token).expect(200);
        const line = res.body.data.lines[0];
        expect(line.id).toBe(lineId);
        await expectUsableImage(token, line.styleId, line.primaryImage, f.imageId);
      }

      const list = await get('/distributor-returns', f.merchToken).expect(200);
      expect(list.body.data.items[0].lines[0].primaryImage).toBeNull();
    });

    it('refuses another Distributor the Return and releases none of its image metadata', async () => {
      const a = await fixture({ withImage: true });
      const b = await fixture({ withImage: true });
      const { data } = await submitReturn(a);
      const res = await get(`/distributor-returns/${data.id}`, b.distributorToken);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(a.imageId!);
      expect(JSON.stringify(res.body)).not.toContain(a.stock.styleId);
      // The list is scoped to the caller too.
      const list = await get('/distributor-returns', b.distributorToken).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(a.imageId!);
    });

    it('resolves a null primaryImage (genuine placeholder) for a Style with no image', async () => {
      const f = await fixture({ withImage: false });
      const { data } = await submitReturn(f);
      for (const token of [f.accountantToken, f.distributorToken]) {
        const res = await get(`/distributor-returns/${data.id}`, token).expect(200);
        expect(res.body.data.lines[0].primaryImage).toBeNull();
        expect(res.body.data.lines[0].styleId).toBe(f.stock.styleId);
      }
    });
  });

  describe('A5 reconciliation detail', () => {
    it('adds sizeCode and a usable primary image to the read path for every internal role that may open the workspace', async () => {
      const f = await fixture({ withImage: true });
      const merch = await get(`/erve-dispatches/${f.dispatch.id}/reconciliation`, f.merchToken).expect(200);
      const line = merch.body.data.lines[0];
      expect(line.styleId).toBe(f.stock.styleId);
      expect(line.sizeId).toBe(f.size.id);
      expect(line.sizeCode).toBe(f.size.code);
      expect(line.sizeSortOrder).toBe(f.size.sortOrder);
      expect(line.dispatchedQuantity).toBe(100);

      for (const token of [f.merchToken, f.seniorToken, f.accountantToken]) {
        const res = await get(`/erve-dispatches/${f.dispatch.id}/reconciliation`, token).expect(200);
        const l = res.body.data.lines[0];
        expect(l.sizeCode).toBe(f.size.code);
        await expectUsableImage(token, l.styleId, l.primaryImage, f.imageId);
        // Same evidence, same token: presentation identity cannot change a snapshot comparison.
        expect(res.body.data.summary.snapshotToken).toBe(merch.body.data.summary.snapshotToken);
      }
    });

    it('keeps the internal workspace closed to Distributors even though they may read their own Style images', async () => {
      const f = await fixture({ withImage: true });
      const res = await get(`/erve-dispatches/${f.dispatch.id}/reconciliation`, f.distributorToken);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(f.imageId!);
      await get(`/styles/${f.stock.styleId}/images/${f.imageId}/content`, f.distributorToken).expect(200);
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
