import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { Prisma, prisma } from '../../db/prisma.js';
import { createTestFinancialYear, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import { addStyleSize } from './master-data.service.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function adminToken() {
  return (
    await createTestUserAndToken({ email: 'admin@test.local', password: 'admin-password', roles: ['ADMIN'] })
  ).token;
}

async function createSeason(barcodeSerial: number | null = 3, code = `S${barcodeSerial ?? 'X'}`) {
  const financialYear = await createTestFinancialYear();
  return prisma.season.create({
    data: { id: createId(), code, name: `Season ${code}`, financialYearId: financialYear.id, barcodeSerial },
  });
}

async function createSize(label: string, sizeType: 'AGE' | 'ALPHA' = 'AGE') {
  return prisma.size.create({
    data: {
      id: createId(),
      code: sizeType === 'AGE' ? `AGE_${label}` : label,
      label,
      sizeType,
      sortOrder: Number.parseInt(label, 10) || 0,
    },
  });
}

function postStyle(token: string, body: Record<string, unknown>) {
  return request(app).post('/styles').set('Authorization', `Bearer ${token}`).send({
    styleNumber: 'ST-001',
    styleName: 'Boys Tee',
    lmixNumber: 'LMIX1234',
    finalMrp: 849,
    ...body,
  });
}

const barcodesOf = async (styleId: string) =>
  Object.fromEntries(
    (await prisma.styleSize.findMany({ where: { styleId }, include: { size: true } })).map((row) => [
      row.size.label,
      row.barcode,
    ]),
  );

describe('Style create with sizes', () => {
  it('generates <Season serial><LMIX digits><size number> per Style + Size', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const [s3, s10] = [await createSize('3'), await createSize('10')];

    const res = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }, { sizeId: s10.id }] });

    expect(res.status).toBe(201);
    expect(await barcodesOf(res.body.data.id)).toEqual({ '3': '312343', '10': '3123410' });
    expect(res.body.data.sizes.map((s: { barcode: string }) => s.barcode)).toEqual(['312343', '3123410']);
  });

  it('preserves a supplied (manual / historical) barcode verbatim and generates only the blanks', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const [s3, s4] = [await createSize('3'), await createSize('4')];

    const res = await postStyle(token, {
      seasonId: season.id,
      sizes: [{ sizeId: s3.id, barcode: ' BJGGR26042008-3Y ' }, { sizeId: s4.id, barcode: '  ' }],
    });

    expect(res.status).toBe(201);
    expect(await barcodesOf(res.body.data.id)).toEqual({ '3': 'BJGGR26042008-3Y', '4': '312344' });
  });

  it('rejects a duplicate barcode within the request and creates nothing', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const [s3, s4] = [await createSize('3'), await createSize('4')];

    const res = await postStyle(token, {
      seasonId: season.id,
      sizes: [{ sizeId: s3.id, barcode: '999' }, { sizeId: s4.id, barcode: '999' }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Barcode 999 would be assigned to more than one size');
    expect(await prisma.style.count()).toBe(0);
    expect(await prisma.styleSize.count()).toBe(0);
  });

  it('rejects an already-persisted barcode with an actionable message and creates nothing', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const s3 = await createSize('3');
    const first = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }] });
    expect(first.status).toBe(201);

    const second = await postStyle(token, {
      styleNumber: 'ST-002',
      seasonId: season.id,
      lmixNumber: 'LMIX9999',
      sizes: [{ sizeId: s3.id, barcode: '312343' }],
    });

    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('Barcode 312343 is already assigned to Style ST-001 / Size 3.');
    expect(second.body.error.message).not.toMatch(/prisma|constraint/i);
    expect(await prisma.style.count()).toBe(1);
  });

  it('is atomic: a barcode that cannot be generated leaves no half-created Style', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const [s3, small] = [await createSize('3'), await createSize('S', 'ALPHA')];

    const res = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }, { sizeId: small.id }] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('no unambiguous numeric value');
    expect(await prisma.style.count()).toBe(0);
    expect(await prisma.styleSize.count()).toBe(0);
  });

  it('reports a Season without a Barcode Serial and a malformed LMIX instead of guessing', async () => {
    const token = await adminToken();
    const noSerial = await createSeason(null, 'NOSERIAL');
    const season = await createSeason(3);
    const s3 = await createSize('3');

    const missingSerial = await postStyle(token, { seasonId: noSerial.id, sizes: [{ sizeId: s3.id }] });
    const badLmix = await postStyle(token, { seasonId: season.id, lmixNumber: 'ABC', sizes: [{ sizeId: s3.id }] });
    const blankLmix = await postStyle(token, { seasonId: season.id, lmixNumber: '', sizes: [{ sizeId: s3.id }] });

    expect(missingSerial.status).toBe(400);
    expect(missingSerial.body.error.message).toContain('its Season has no Barcode Serial');
    expect(badLmix.status).toBe(400);
    expect(badLmix.body.error.message).toContain('is not in the form LMIX<digits>');
    expect(blankLmix.status).toBe(400);
    expect(await prisma.style.count()).toBe(0);
  });

  it('still creates a Style with no sizes (barcodes are per Style + Size, not per Style)', async () => {
    const token = await adminToken();
    const noSerial = await createSeason(null, 'NOSERIAL');
    expect((await postStyle(token, { seasonId: noSerial.id })).status).toBe(201);
  });

  it('rejects a malformed supplied barcode at the API boundary', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const s3 = await createSize('3');
    const res = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id, barcode: 'has space' }] });
    expect(res.status).toBe(400);
  });
});

describe('global uniqueness is enforced by the database', () => {
  it('rejects a duplicate barcode written straight to the table (no application check involved)', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const s3 = await createSize('3');
    const first = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }] });
    const other = await postStyle(token, { styleNumber: 'ST-002', seasonId: season.id });

    const attempt = prisma.styleSize.create({
      data: { id: createId(), styleId: other.body.data.id, sizeId: s3.id, barcode: '312343' },
    });

    await expect(attempt).rejects.toMatchObject({ code: 'P2002' });
    expect(first.status).toBe(201);
  });

  it('lets exactly one of two simultaneous creates claim the same barcode', async () => {
    const token = await adminToken();
    const season = await createSeason(3);
    const s3 = await createSize('3');

    const results = await Promise.all(
      ['ST-A', 'ST-B', 'ST-C', 'ST-D'].map((styleNumber) =>
        postStyle(token, { styleNumber, seasonId: season.id, sizes: [{ sizeId: s3.id, barcode: 'RACE-1' }] }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 201);
    expect(losers.map((r) => r.status)).toEqual([409, 409, 409]);
    for (const loser of losers) {
      expect(loser.body.error.message).toMatch(/^Barcode RACE-1 is already assigned to Style ST-[A-D] \/ Size 3\.$/);
    }
    expect(await prisma.styleSize.count({ where: { barcode: 'RACE-1' } })).toBe(1);
    // Losers rolled back entirely - no orphan Styles.
    expect(await prisma.style.count()).toBe(1);
  });
});

describe('adding / removing sizes on an existing Style', () => {
  async function styleWithSize(token: string, serial = 3) {
    const season = await createSeason(serial);
    const s3 = await createSize('3');
    const created = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }] });
    return { season, s3, styleId: created.body.data.id as string };
  }

  it('generates a barcode only for the newly added size and leaves existing ones alone', async () => {
    const token = await adminToken();
    const { styleId } = await styleWithSize(token);
    const s10 = await createSize('10');

    const res = await request(app)
      .post(`/styles/${styleId}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: s10.id });

    expect(res.status).toBe(200);
    expect(await barcodesOf(styleId)).toEqual({ '3': '312343', '10': '3123410' });
  });

  it('preserves a supplied barcode on add and blocks a duplicate with the owner named', async () => {
    const token = await adminToken();
    const { styleId } = await styleWithSize(token);
    const [s4, s5] = [await createSize('4'), await createSize('5')];

    const manual = await request(app)
      .post(`/styles/${styleId}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: s4.id, barcode: 'MANUAL-4' });
    const dup = await request(app)
      .post(`/styles/${styleId}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: s5.id, barcode: 'MANUAL-4' });

    expect(manual.status).toBe(200);
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Barcode MANUAL-4 is already assigned to Style ST-001 / Size 4.');
    expect((await barcodesOf(styleId))['5']).toBeUndefined();
  });

  it('re-adding a mapped size reports a duplicate size and never touches its barcode', async () => {
    const token = await adminToken();
    const { styleId, s3 } = await styleWithSize(token);
    await prisma.styleSize.updateMany({ where: { styleId }, data: { barcode: 'HISTORICAL-3' } });

    const res = await request(app)
      .post(`/styles/${styleId}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: s3.id });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Style already has this size');
    expect(await barcodesOf(styleId)).toEqual({ '3': 'HISTORICAL-3' });
  });

  it('never regenerates persisted barcodes when unrelated fields, LMIX, or Season change', async () => {
    const token = await adminToken();
    const { styleId } = await styleWithSize(token);
    const otherSeason = await createSeason(7, 'OTHER');

    const rename = await request(app)
      .patch(`/styles/${styleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ styleName: 'Renamed' });
    const relmix = await request(app)
      .patch(`/styles/${styleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lmixNumber: 'LMIX5555', seasonId: otherSeason.id });

    expect(rename.status).toBe(200);
    expect(relmix.status).toBe(200);
    expect(await barcodesOf(styleId)).toEqual({ '3': '312343' });
  });

  it('records the released barcode in the audit trail when a size is removed', async () => {
    const token = await adminToken();
    const { styleId, s3 } = await styleWithSize(token);

    const res = await request(app)
      .delete(`/styles/${styleId}/sizes/${s3.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: styleId, action: 'STYLE_SIZE_REMOVED' } });
    expect(audit?.metadata).toMatchObject({ sizeId: s3.id, barcode: '312343' });
  });

  it('historical-style callers (generateMissing: false) leave the barcode empty instead of failing or inventing one', async () => {
    const token = await adminToken();
    const noSerial = await createSeason(null, 'HIST');
    const s3 = await createSize('3');
    const created = await postStyle(token, { seasonId: noSerial.id });
    const actor = { id: (await prisma.user.findFirstOrThrow()).id } as Parameters<typeof addStyleSize>[0];

    await addStyleSize(actor, created.body.data.id, { sizeId: s3.id }, { generateMissing: false });

    expect(await barcodesOf(created.body.data.id)).toEqual({ '3': null });
  });
});

describe('manual barcode edit', () => {
  async function setup() {
    const token = await adminToken();
    const season = await createSeason(3);
    const [s3, s4] = [await createSize('3'), await createSize('4')];
    const created = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }, { sizeId: s4.id }] });
    return { token, styleId: created.body.data.id as string, s3, s4 };
  }
  const patchBarcode = (token: string, styleId: string, sizeId: string, barcode: unknown) =>
    request(app)
      .patch(`/styles/${styleId}/sizes/${sizeId}/barcode`)
      .set('Authorization', `Bearer ${token}`)
      .send({ barcode });

  it('overrides one Style + Size barcode and audits old and new values', async () => {
    const { token, styleId, s3 } = await setup();

    const res = await patchBarcode(token, styleId, s3.id, ' CUSTOM-3 ');

    expect(res.status).toBe(200);
    expect(await barcodesOf(styleId)).toEqual({ '3': 'CUSTOM-3', '4': '312344' });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: styleId, action: 'STYLE_SIZE_BARCODE_UPDATED' } });
    expect(audit?.metadata).toMatchObject({ from: '312343', to: 'CUSTOM-3' });
  });

  it('blocks a barcode owned by another Style + Size, and a blank value', async () => {
    const { token, styleId, s3 } = await setup();

    const dup = await patchBarcode(token, styleId, s3.id, '312344');
    const blank = await patchBarcode(token, styleId, s3.id, '   ');

    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Barcode 312344 is already assigned to Style ST-001 / Size 4.');
    expect(blank.status).toBe(400);
    expect((await barcodesOf(styleId))['3']).toBe('312343');
  });

  it('is a no-op when the barcode is unchanged and 404s for an unmapped size', async () => {
    const { token, styleId, s3 } = await setup();
    expect((await patchBarcode(token, styleId, s3.id, '312343')).status).toBe(200);
    expect((await patchBarcode(token, styleId, 'missing', 'X-1')).status).toBe(404);
  });

  it('rejects unauthorised roles', async () => {
    const { styleId, s3 } = await setup();
    const { token: qa } = await createTestUserAndToken({ email: 'qa@test.local', password: 'qa-password', roles: ['QA_USER'] });
    expect((await patchBarcode(qa, styleId, s3.id, 'X-1')).status).toBe(403);
  });
});

describe('Season Barcode Serial', () => {
  const seasonBody = (financialYearId: string, extra: Record<string, unknown> = {}) => ({
    code: 'AW26',
    name: 'Autumn Winter 2026',
    financialYearId,
    ...extra,
  });

  it('is never auto-assigned: a Season created without one has none', async () => {
    const token = await adminToken();
    const fy = await createTestFinancialYear();
    const res = await request(app).post('/seasons').set('Authorization', `Bearer ${token}`).send(seasonBody(fy.id));
    expect(res.status).toBe(201);
    expect(res.body.data.barcodeSerial).toBeNull();
  });

  it('is unique across Seasons with a clear message', async () => {
    const token = await adminToken();
    const fy = await createTestFinancialYear();
    await request(app).post('/seasons').set('Authorization', `Bearer ${token}`).send(seasonBody(fy.id, { barcodeSerial: 3 }));

    const dup = await request(app)
      .post('/seasons')
      .set('Authorization', `Bearer ${token}`)
      .send(seasonBody(fy.id, { code: 'SS27', barcodeSerial: 3 }));

    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Barcode Serial 3 is already used by Season AW26');
  });

  it('can be assigned once, then is frozen after barcodes exist under it', async () => {
    const token = await adminToken();
    const season = await createSeason(null, 'LATE');
    const s3 = await createSize('3');
    const patch = (barcodeSerial: number) =>
      request(app).patch(`/seasons/${season.id}`).set('Authorization', `Bearer ${token}`).send({ barcodeSerial });

    expect((await patch(4)).status).toBe(200);
    expect((await patch(5)).status).toBe(200); // no barcodes yet
    const created = await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id }] });
    expect(await barcodesOf(created.body.data.id)).toEqual({ '3': '512343' });

    const frozen = await patch(6);
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.message).toContain('Barcode Serial cannot be changed');
    expect((await prisma.season.findUniqueOrThrow({ where: { id: season.id } })).barcodeSerial).toBe(5);
  });

  it('allows first assignment even when manual barcodes already exist (it changes nothing persisted)', async () => {
    const token = await adminToken();
    const season = await createSeason(null, 'LATE');
    const s3 = await createSize('3');
    await postStyle(token, { seasonId: season.id, sizes: [{ sizeId: s3.id, barcode: 'LEGACY-1' }] });

    const res = await request(app)
      .patch(`/seasons/${season.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ barcodeSerial: 8 });

    expect(res.status).toBe(200);
    expect(await prisma.styleSize.findMany({ select: { barcode: true } })).toEqual([{ barcode: 'LEGACY-1' }]);
  });

  it('rejects a non-positive or fractional serial', async () => {
    const token = await adminToken();
    const fy = await createTestFinancialYear();
    for (const barcodeSerial of [0, -1, 1.5]) {
      const res = await request(app)
        .post('/seasons')
        .set('Authorization', `Bearer ${token}`)
        .send(seasonBody(fy.id, { barcodeSerial }));
      expect(res.status).toBe(400);
    }
  });
});

describe('schema contract', () => {
  it('keeps Style+Size unique and allows many unbarcoded legacy rows', async () => {
    const token = await adminToken();
    const season = await createSeason(null, 'LEGACY');
    const [s3, s4] = [await createSize('3'), await createSize('4')];
    const style = await postStyle(token, { seasonId: season.id });
    const styleId = style.body.data.id as string;

    await prisma.styleSize.createMany({
      data: [
        { id: createId(), styleId, sizeId: s3.id },
        { id: createId(), styleId, sizeId: s4.id },
      ],
    });
    await expect(
      prisma.styleSize.create({ data: { id: createId(), styleId, sizeId: s3.id } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(await barcodesOf(styleId)).toEqual({ '3': null, '4': null });
  });
});
