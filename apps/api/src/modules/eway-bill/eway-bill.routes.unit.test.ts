import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createEwayBillEligibilityService, type EwayBillFactsRepository } from './eway-bill-eligibility.service.js';
import { createEwayBillRouter } from './eway-bill.routes.js';
import { finalizedFacts } from './test/eway-bill-fixtures.js';

// Authentication is the boundary double; no app/db/config module is loaded.
vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.headers['x-test-role'];
    if (!role) {
      res.status(401).end();
      return;
    }
    req.user = { id: 'user-1', name: 'User', roles: [role] } as CurrentUser;
    next();
  },
}));

const loadFacts = vi.fn<EwayBillFactsRepository['loadFacts']>();
let app: express.Express;

beforeEach(() => {
  loadFacts.mockReset();
  loadFacts.mockImplementation(async (id) => (id === 'inv-1' ? finalizedFacts() : null));
  app = express();
  app.use(express.json());
  app.use('/tax-invoices', createEwayBillRouter(createEwayBillEligibilityService({ repository: { loadFacts } })));
  app.use(errorHandler);
});

describe('GET /tax-invoices/:id/eway-bill-readiness', () => {
  it('requires authentication', async () => {
    await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').expect(401);
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'ACCOUNTANT'])('lets %s read the readiness contract', async (role) => {
    const response = await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', role).expect(200);
    expect(response.body.data).toMatchObject({
      taxInvoiceId: 'inv-1',
      invoiceStatus: 'FINALIZED',
      applicability: { outcome: 'UNDETERMINED' },
      linkage: { state: 'NONE' },
      readiness: { outcome: 'READY', requirementsVerification: 'PARTIAL' },
      capabilities: { providerGenerationAvailable: false, externalLinkAvailable: false },
    });
    expect(loadFacts).toHaveBeenCalledTimes(1);
    expect(loadFacts).toHaveBeenCalledWith('inv-1');
  });

  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR', 'FACTORY_USER', 'QA_USER'])(
    'rejects %s before any invoice data is loaded',
    async (role) => {
      await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', role).expect(403);
      expect(loadFacts).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for an unknown invoice without leaking another invoice', async () => {
    await request(app).get('/tax-invoices/other/eway-bill-readiness').set('x-test-role', 'ACCOUNTANT').expect(404);
    expect(loadFacts).toHaveBeenCalledTimes(1);
    expect(loadFacts).toHaveBeenCalledWith('other');
  });

  it('exposes no mutation routes in B1', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await request(app)[method]('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', 'ACCOUNTANT').expect(404);
    }
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it('does not depend on an Erve Dispatch: facts carry none and the response is still complete', async () => {
    const response = await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', 'ACCOUNTANT').expect(200);
    expect(Object.keys(response.body.data)).not.toContain('erveDispatch');
    expect(loadFacts).toHaveBeenCalledTimes(1);
  });
});
