import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { createApp } from '../../app.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import { prisma } from '../../db/prisma.js';
import { createId } from '@erve/shared';

const app = createApp();
async function token(roles: ('ADMIN' | 'QA_USER' | 'ACCOUNTANT' | 'MERCHANDISER')[] = ['ADMIN']) {
  return (
    await createTestUserAndToken({
      email: 'imports@test.local',
      password: 'Disposable-test-password1!',
      roles,
    })
  ).token;
}
describe('authorized business import HTTP workflows', () => {
  beforeEach(resetDatabase);
  it('enforces HSN-only ACCOUNTANT authorization on every shared endpoint', async () => {
    const auth = await token(['ACCOUNTANT']);
    for (const kind of ['factories', 'distributors', 'retail-stores', 'seasons', 'sizes']) {
      for (const endpoint of ['template', 'history', 'history/missing', 'history/missing/exceptions'])
        expect((await request(app).get(`/master-imports/${kind}/${endpoint}`).set('Authorization', `Bearer ${auth}`)).status).toBe(403);
      for (const endpoint of ['worksheets', 'preflight', 'exceptions', 'execute'])
        expect((await request(app).post(`/master-imports/${kind}/${endpoint}`).set('Authorization', `Bearer ${auth}`)).status).toBe(403);
    }
    expect((await request(app).get('/master-imports/hsns/template').set('Authorization', `Bearer ${auth}`)).status).toBe(200);
    expect((await request(app).get('/master-imports/hsns/history').set('Authorization', `Bearer ${auth}`)).status).toBe(200);
  });
  it.each(['seasons', 'sizes', 'hsns'] as const)('uploads, confirms and displays persisted history for %s', async kind => {
    const auth = await token(kind === 'hsns' ? ['ACCOUNTANT'] : ['MERCHANDISER']);
    await prisma.financialYear.create({ data: { id: createId(), code: '2026-27', startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') } });
    const files = { seasons: 'Season Code,Season Name,Financial Year\nAW,Winter,2026-27\n', sizes: 'Size Code,Size Label,Size Type,Sort Order\nxxs,Small,ALPHA,0\n', hsns: 'HSN Code,Description\n01234567,Text\n' };
    const file = Buffer.from(files[kind]);
    const preview = await request(app).post(`/master-imports/${kind}/preflight`).set('Authorization', `Bearer ${auth}`).attach('file', file, 'm.csv');
    expect(preview.status).toBe(200); expect(preview.body.data.summary.CREATE).toBe(1);
    const done = await request(app).post(`/master-imports/${kind}/execute`).set('Authorization', `Bearer ${auth}`).field('confirmationToken', preview.body.data.confirmationToken).attach('file', file, 'm.csv');
    expect(done.status).toBe(200); expect(done.body.data.summary.CREATE).toBe(1);
    const history = await request(app).get(`/master-imports/${kind}/history`).set('Authorization', `Bearer ${auth}`);
    expect(history.body.data[0].id).toBe(done.body.data.runId);
    const detail = await request(app).get(`/master-imports/${kind}/history/${done.body.data.runId}`).set('Authorization', `Bearer ${auth}`);
    expect(detail.body.data.rows[0].payload.code).toBe(kind === 'seasons' ? 'AW' : kind === 'sizes' ? 'xxs' : '01234567');
  });
  it('requires authentication and matching master-management roles for templates, preview and history', async () => {
    expect((await request(app).get('/master-imports/factories/template')).status).toBe(401);
    const auth = await token(['QA_USER']);
    for (const path of ['template', 'history'])
      expect(
        (
          await request(app)
            .get(`/master-imports/factories/${path}`)
            .set('Authorization', `Bearer ${auth}`)
        ).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .post('/master-imports/factories/preflight')
          .set('Authorization', `Bearer ${auth}`)
      ).status,
    ).toBe(403);
  });
  it('performs upload, preview, explicit confirmation, execution and history with correction-ready exceptions', async () => {
    const auth = await token();
    const file = Buffer.from(
      'Name,Email,Code\nFactory One,one@example.test,FAC-999999\nFactory Bad,invalid,OTHER\n',
    );
    const preview = await request(app)
      .post('/master-imports/factories/preflight')
      .set('Authorization', `Bearer ${auth}`)
      .attach('file', file, 'factories.csv');
    expect(preview.status).toBe(200);
    expect(preview.body.data.summary).toMatchObject({ CREATE: 1, REJECTED: 1 });
    expect(await prisma.factory.count()).toBe(0);
    const unconfirmed = await request(app)
      .post('/master-imports/factories/execute')
      .set('Authorization', `Bearer ${auth}`)
      .attach('file', file, 'factories.csv');
    expect(unconfirmed.status).toBe(400);
    const done = await request(app)
      .post('/master-imports/factories/execute')
      .set('Authorization', `Bearer ${auth}`)
      .field('confirmationToken', preview.body.data.confirmationToken)
      .attach('file', file, 'factories.csv');
    expect(done.status).toBe(200);
    expect(done.body.data.rows[0].code).toBe('FAC-000001');
    const history = await request(app)
      .get('/master-imports/factories/history')
      .set('Authorization', `Bearer ${auth}`);
    expect(history.body.data[0].id).toBe(done.body.data.runId);
    const detail = await request(app)
      .get(`/master-imports/factories/history/${done.body.data.runId}`)
      .set('Authorization', `Bearer ${auth}`);
    expect(detail.body.data.rows).toHaveLength(2);
    const report = await request(app)
      .get(`/master-imports/factories/history/${done.body.data.runId}/exceptions`)
      .set('Authorization', `Bearer ${auth}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(report.status).toBe(200);
    const sheet = XLSX.read(report.body as Buffer, { type: 'buffer' }).Sheets.Exceptions!;
    expect(sheet.A2.v).toBe('Factory Bad');
    expect(sheet.B2.v).toBe('invalid');
  });
  it('requires an explicit XLSX worksheet and exposes workbook sheet names before planning', async () => {
    const auth = await token();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Name'], ['Factory One']]),
      'Factories',
    );
    const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const sheets = await request(app)
      .post('/master-imports/factories/worksheets')
      .set('Authorization', `Bearer ${auth}`)
      .attach('file', file, 'f.xlsx');
    expect(sheets.body.data.worksheets).toEqual(['Factories']);
    expect(
      (
        await request(app)
          .post('/master-imports/factories/preflight')
          .set('Authorization', `Bearer ${auth}`)
          .attach('file', file, 'f.xlsx')
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/master-imports/factories/preflight')
          .set('Authorization', `Bearer ${auth}`)
          .field('worksheet', 'Factories')
          .attach('file', file, 'f.xlsx')
      ).body.data.summary.CREATE,
    ).toBe(1);
  });
});
