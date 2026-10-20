import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { createGstComplianceSettingsService } from './gst-compliance-settings.service.js';
import { createMemorySettingsRepository } from './test/memory-settings-repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createGstComplianceSettingsRouter } from './gst-compliance-settings.routes.js';

// Authentication is the boundary double; no app/db/config module is loaded.
vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.headers['x-test-role'];
    if (!role) { res.status(401).end(); return; }
    req.user = { id: 'accounts', name: 'Accounts', roles: [role] } as CurrentUser;
    next();
  },
}));

let app: express.Express;
beforeEach(() => {
  const service = createGstComplianceSettingsService(createMemorySettingsRepository(), () => false);
  app = express();
  app.use(express.json());
  app.use('/gst-compliance/settings', createGstComplianceSettingsRouter(service));
  app.use(errorHandler);
});

describe('settings HTTP contract without a database', () => {
  it('requires authentication', async () => { await request(app).get('/gst-compliance/settings').expect(401); });
  it('allows safe ADMIN reads but rejects ADMIN writes', async () => {
    const response = await request(app).get('/gst-compliance/settings').set('x-test-role', 'ADMIN').expect(200);
    expect(response.body.data).toMatchObject({ integrationMode: 'DEMO', version: 0 });
    await request(app).patch('/gst-compliance/settings').set('x-test-role', 'ADMIN').send({ expectedVersion: 0, gstinVerificationLevel: 'COMPLETE' }).expect(403);
  });
  it('persists an accountant update and exposes sanitized history', async () => {
    await request(app).patch('/gst-compliance/settings').set('x-test-role', 'ACCOUNTANT').send({ expectedVersion: 0, gstinVerificationLevel: 'COMPLETE' }).expect(200);
    const read = await request(app).get('/gst-compliance/settings').set('x-test-role', 'ACCOUNTANT').expect(200);
    expect(read.body.data).toMatchObject({ gstinVerificationLevel: 'COMPLETE', version: 1 });
    const history = await request(app).get('/gst-compliance/settings/audit').set('x-test-role', 'ACCOUNTANT').expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ previous: { version: 0 }, next: { version: 1 } });
    expect(JSON.stringify(read.body)).not.toMatch(/apiKey|password|authorizationHeader/);
  });
  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR', 'FACTORY_USER', 'QA_USER'])(
    'rejects %s at read, audit and write routes', async (role) => {
      await request(app).get('/gst-compliance/settings').set('x-test-role', role).expect(403);
      await request(app).get('/gst-compliance/settings/audit').set('x-test-role', role).expect(403);
      await request(app).patch('/gst-compliance/settings').set('x-test-role', role).send({ expectedVersion: 0, integrationMode: 'DEMO' }).expect(403);
    },
  );
  it('rejects unsafe activation, unknown keys and stale writes without persisting', async () => {
    for (const [payload, status] of [
      [{ expectedVersion: 0, integrationMode: 'LIVE', confirmLiveActivation: true }, 403],
      [{ expectedVersion: 0, ewayBillGenerationEnabled: true }, 400],
      [{ expectedVersion: 0, apiKey: 'secret' }, 400],
      [{ expectedVersion: 5, gstinVerificationLevel: 'COMPLETE' }, 409],
    ] as const) {
      await request(app).patch('/gst-compliance/settings').set('x-test-role', 'ACCOUNTANT').send(payload).expect(status);
    }
    const read = await request(app).get('/gst-compliance/settings').set('x-test-role', 'ACCOUNTANT').expect(200);
    expect(read.body.data.version).toBe(0);
  });
});
