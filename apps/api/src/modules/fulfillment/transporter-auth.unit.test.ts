import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock('../../db/prisma.js', () => ({ prisma: db }));
vi.mock('../../auth/jwt.js', () => ({
  verifyAccessToken: vi.fn(() => ({ sub: 't1', authVersion: 1 })),
}));
import { requireAuth } from '../../auth/auth.middleware.js';
import { errorHandler } from '../../middleware/error-handler.js';
const app = express();
app.get('/me', requireAuth, (req, res) => res.json({ roles: req.user!.roles }));
app.use(errorHandler);
const account = () => ({
  id: 't1',
  name: 'Carrier',
  status: 'ACTIVE',
  authVersion: 1,
  userRoles: [{ role: { name: 'TRANSPORTER' } }],
  userDistributors: [],
  userFactories: [],
});
beforeEach(() => {
  db.user.findUnique.mockResolvedValue(account());
});
it('authenticates an active Transporter with the existing token flow', async () => {
  const result = await request(app).get('/me').set('Authorization', 'Bearer test').expect(200);
  expect(result.body.roles).toEqual(['TRANSPORTER']);
});
it('reloads deactivation and credential revocation on the next request', async () => {
  db.user.findUnique.mockResolvedValue({ ...account(), status: 'INACTIVE' });
  await request(app).get('/me').set('Authorization', 'Bearer test').expect(401);
  db.user.findUnique.mockResolvedValue({ ...account(), authVersion: 2 });
  await request(app).get('/me').set('Authorization', 'Bearer test').expect(401);
});
it('fails closed for legacy mixed-role accounts', async () => {
  db.user.findUnique.mockResolvedValue({
    ...account(),
    userRoles: [...account().userRoles, { role: { name: 'ADMIN' } }],
  });
  await request(app).get('/me').set('Authorization', 'Bearer test').expect(403);
});
