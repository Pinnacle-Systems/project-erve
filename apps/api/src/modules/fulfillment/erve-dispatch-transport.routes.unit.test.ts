import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'TRANSPORTER' }));
vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 't1', roles: [state.role] } as typeof req.user;
    next();
  },
}));
vi.mock('./erve-dispatch.service.js', () => ({
  updateErveDispatchLr: vi.fn(async () => ({ id: 'ed', lrNumber: 'LR', version: 4 })),
}));
vi.mock('./erve-dispatch-transport.service.js', () => ({
  listAssignedTransport: vi.fn(async () => ({ items: [], pageInfo: { hasMore: false } })),
  getDispatchTransport: vi.fn(async () => ({ id: 'ed', version: 3 })),
  listTransporterOptions: vi.fn(async () => []),
  assignDispatchTransporter: vi.fn(async () => ({ id: 'ed' })),
}));
import { erveDispatchesRouter, ervePackingListsRouter } from './erve-dispatch.routes.js';
import { errorHandler } from '../../middleware/error-handler.js';
const app = express();
app.use(express.json());
app.use('/erve-dispatches', erveDispatchesRouter);
app.use('/erve-packing-lists', ervePackingListsRouter);
app.use(errorHandler);
beforeEach(() => {
  state.role = 'TRANSPORTER';
});
it.each([
  ['get', '/erve-dispatches'],
  ['get', '/erve-dispatches/ed'],
  ['post', '/erve-dispatches'],
  ['patch', '/erve-dispatches/ed/delivery'],
  ['patch', '/erve-dispatches/ed/transporter-assignment'],
  ['get', '/erve-dispatches/transporter-options'],
  ['get', '/erve-packing-lists'],
  ['post', '/erve-packing-lists'],
  ['get', '/erve-packing-lists/pl'],
  ['post', '/erve-packing-lists/pl/cartons'],
  ['delete', '/erve-packing-lists/pl/cartons/carton'],
  ['post', '/erve-packing-lists/pl/finalize'],
] as const)('denies Transporter %s %s', async (method, path) => {
  await request(app)[method](path).expect(403);
});
it('routes assigned discovery before the generic ID route and accepts transport updates', async () => {
  await request(app).get('/erve-dispatches/assigned-transport?limit=1').expect(200);
  await request(app).get('/erve-dispatches/ed/transport').expect(200);
  const result = await request(app)
    .patch('/erve-dispatches/ed/lr')
    .send({ expectedVersion: 3, lrNumber: 'LR' })
    .expect(200);
  expect(result.body.data).not.toHaveProperty('distributor');
});
it('rejects injected assignment filters and malformed updates', async () => {
  await request(app).get('/erve-dispatches/assigned-transport?transporterUserId=t2').expect(400);
  await request(app).patch('/erve-dispatches/ed/lr').send({ expectedVersion: 3 }).expect(400);
  await request(app)
    .patch('/erve-dispatches/ed/lr')
    .send({ expectedVersion: 3, lrNumber: 'x'.repeat(101) })
    .expect(400);
});
it('does not grant Accountant transport access', async () => {
  state.role = 'ACCOUNTANT';
  await request(app).get('/erve-dispatches/ed/transport').expect(403);
  await request(app)
    .patch('/erve-dispatches/ed/lr')
    .send({ expectedVersion: 3, lrNumber: 'LR' })
    .expect(403);
});
