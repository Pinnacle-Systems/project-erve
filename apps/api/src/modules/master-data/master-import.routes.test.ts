import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { createApp } from '../../app.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import { prisma } from '../../db/prisma.js';

const app = createApp();
async function token(roles: ('ADMIN' | 'QA_USER')[] = ['ADMIN']) {
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
