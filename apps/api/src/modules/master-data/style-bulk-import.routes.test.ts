import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestFactory, createTestSeason, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function buildSheet(rows: Array<Record<string, string>>): Buffer {
  const headers = ['Style Number', 'Style Name', 'Final MRP', 'Season Code', 'Size Codes', 'Barcodes', 'Factory Mappings'];
  const data = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function adminToken() {
  const { token } = await createTestUserAndToken({ email: 'bulk-admin@test.local', password: 'password123', roles: ['ADMIN'] });
  return token;
}

async function qaUserToken() {
  const { token } = await createTestUserAndToken({ email: 'bulk-qa@test.local', password: 'password123', roles: ['QA_USER'] });
  return token;
}

describe('POST /styles/bulk-import/preflight and /execute', () => {
  it('requires authentication', async () => {
    const response = await request(app).post('/styles/bulk-import/preflight');
    expect(response.status).toBe(401);
  });

  it('rejects a role without master-data manage permission', async () => {
    const token = await qaUserToken();
    const buffer = buildSheet([{ 'Style Number': 'ST-1', 'Style Name': 'x', 'Final MRP': '1', 'Season Code': 'AW25', 'Size Codes': 'S' }]);
    const response = await request(app)
      .post('/styles/bulk-import/preflight')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, { filename: 'styles.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(response.status).toBe(403);
  });

  it('rejects a request with no file attached', async () => {
    const token = await adminToken();
    const response = await request(app).post('/styles/bulk-import/preflight').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(400);
  });

  it('this route is reachable at all — never intercepted by /styles/:id', async () => {
    const token = await adminToken();
    const buffer = buildSheet([{ 'Style Number': 'ST-ROUTING', 'Style Name': 'x', 'Final MRP': '1', 'Season Code': 'AW25', 'Size Codes': 'S' }]);
    const response = await request(app)
      .post('/styles/bulk-import/preflight')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, { filename: 'styles.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    // Not a 404 (which a misrouted /:id GET-only route would never produce
    // anyway, but a 400 "Style not found" style error would reveal it was
    // wrongly matched there) — the real response is a successful plan.
    expect(response.status).toBe(200);
  });

  it('preflight reports a CREATE row and never writes; execute then actually creates the Style', async () => {
    const token = await adminToken();
    await createTestSeason({ code: 'AW25' });
    await prisma.size.create({ data: { id: createId(), code: 'S', label: 'S', sizeType: 'ALPHA', sortOrder: 1 } });
    await createTestFactory({ code: 'CLIFTON' });

    const buffer = buildSheet([
      {
        'Style Number': 'ST-ROUTE-1',
        'Style Name': 'Route Test Style',
        'Final MRP': '499',
        'Season Code': 'AW25',
        'Size Codes': 'S',
        // Explicit barcode: auto-generation needs a numeric Size label or a
        // valid LMIX Number, neither of which this fixture's generic ALPHA
        // Size has — orthogonal to what this route test is proving.
        Barcodes: 'ROUTE-TEST-BARCODE-1',
        'Factory Mappings': 'CLIFTON:450.00',
      },
    ]);

    const preflight = await request(app)
      .post('/styles/bulk-import/preflight')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, { filename: 'styles.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(preflight.status).toBe(200);
    expect(preflight.body.data.summary).toMatchObject({ create: 1, rejected: 0 });
    expect(await prisma.style.findUnique({ where: { styleNumber: 'ST-ROUTE-1' } })).toBeNull();

    const execute = await request(app)
      .post('/styles/bulk-import/execute')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, { filename: 'styles.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(execute.status).toBe(200);
    expect(execute.body.data.results[0]).toMatchObject({ outcome: 'COMPLETED', styleNumber: 'ST-ROUTE-1' });
    expect(await prisma.style.findUnique({ where: { styleNumber: 'ST-ROUTE-1' } })).not.toBeNull();
  });
});
