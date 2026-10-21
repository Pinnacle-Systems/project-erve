import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { createGstinVerificationRouter } from './gstin-verification.routes.js';
import type { GstinVerificationService } from './gstin-verification.service.js';
import { errorHandler } from '../../middleware/error-handler.js';

vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.headers['x-test-role']) {
      res.status(401).end();
      return;
    }
    req.user = { id: 'actor', roles: [req.headers['x-test-role']] } as CurrentUser;
    next();
  },
}));
function setup() {
  const service = {
    read: vi.fn(async () => ({ evidence: null })),
    history: vi.fn(async () => []),
    policy: vi.fn(async () => ({ enabled: false })),
    prepare: vi.fn(async () => ({ kind: 'CONFIRMATION' })),
    execute: vi.fn(async () => ({ evidence: null })),
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/verification',
    createGstinVerificationRouter(service as unknown as GstinVerificationService),
  );
  app.use(errorHandler);
  return { app, service };
}
describe('verification HTTP validation and separation', () => {
  it('requires authentication on read, prepare and execute', async () => {
    const { app } = setup();
    await request(app).get('/verification').expect(401);
    await request(app).post('/verification/prepare').send({}).expect(401);
    await request(app).post('/verification/execute').send({}).expect(401);
  });
  it('reads do not invoke execution or preparation', async () => {
    const { app, service } = setup();
    await request(app)
      .get('/verification?gstin=33AAAAA0000A1Z5&sourceType=DISTRIBUTOR&sourceId=id')
      .set('x-test-role', 'ADMIN')
      .expect(200);
    expect(service.read).toHaveBeenCalledWith(expect.objectContaining({ id: 'actor' }), {
      gstin: '33AAAAA0000A1Z5',
      source: { type: 'DISTRIBUTOR', id: 'id' },
    });
    expect(service.execute).not.toHaveBeenCalled();
    expect(service.prepare).not.toHaveBeenCalled();
  });
  it.each([
    { mode: 'LIVE' },
    { level: 'COMPLETE' },
    { estimatedCredits: 0 },
    { url: 'https://elsewhere.invalid' },
    { forceRefresh: true },
  ])('rejects client-controlled execution fields %j', async (fields) => {
    const { app, service } = setup();
    await request(app)
      .post('/verification/prepare')
      .set('x-test-role', 'ACCOUNTANT')
      .send({ target: { gstin: '33AAAAA0000A1Z5' }, ...fields })
      .expect(400);
    expect(service.prepare).not.toHaveBeenCalled();
  });
  it('rejects incomplete source identities and execute payloads that are not exact intents', async () => {
    const { app, service } = setup();
    await request(app)
      .get('/verification?gstin=33AAAAA0000A1Z5&sourceType=DISTRIBUTOR')
      .set('x-test-role', 'ADMIN')
      .expect(400);
    await request(app)
      .post('/verification/execute')
      .set('x-test-role', 'ACCOUNTANT')
      .send({ intentId: 'invalid', confirmed: true })
      .expect(400);
    expect(service.execute).not.toHaveBeenCalled();
  });
});
