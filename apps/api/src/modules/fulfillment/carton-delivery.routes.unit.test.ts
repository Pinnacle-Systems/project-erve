import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { createPublicCartonDeliveryRouter } from './carton-delivery.routes.js';
import type { createCartonDeliveryService } from './carton-delivery.service.js';

const token = 'A'.repeat(43);
function fixture() {
  const service = {
    rateLimit: vi.fn(),
    resolve: vi.fn(async () => ({ cartonNumber: 'C1', labelReference: 'REF1', state: 'READY' })),
    confirm: vi.fn(),
  };
  const app = express();
  app.use(
    '/public/carton-delivery',
    createPublicCartonDeliveryRouter(
      service as unknown as ReturnType<typeof createCartonDeliveryService>,
      'https://delivery.example',
    ),
  );
  return { app, service };
}
it('resolves with only a capability header, without session cookies, and never caches', async () => {
  const { app } = fixture();
  const result = await request(app)
    .post('/public/carton-delivery/resolve')
    .set('X-Carton-Delivery-Token', token)
    .set('Origin', 'https://delivery.example')
    .send({})
    .expect(200);
  expect(result.body.data).toEqual({ cartonNumber: 'C1', labelReference: 'REF1', state: 'READY' });
  expect(result.headers['cache-control']).toContain('no-store');
  expect(result.headers['referrer-policy']).toBe('no-referrer');
  expect(result.headers['access-control-allow-credentials']).toBeUndefined();
});
it('rejects hostile origins, query tokens, extra identifiers and oversized JSON without exposing secrets', async () => {
  const { app, service } = fixture();
  await request(app)
    .post('/public/carton-delivery/resolve')
    .set('X-Carton-Delivery-Token', token)
    .set('Origin', 'https://evil.example')
    .send({})
    .expect(403);
  await request(app).post(`/public/carton-delivery/resolve?token=${token}`).send({}).expect(400);
  await request(app)
    .post('/public/carton-delivery/resolve')
    .set('X-Carton-Delivery-Token', token)
    .send({ cartonId: 'other' })
    .expect(400);
  const large = await request(app)
    .post('/public/carton-delivery/confirm')
    .set('X-Carton-Delivery-Token', token)
    .send({ remarks: 'x'.repeat(13000) })
    .expect(413);
  expect(JSON.stringify(large.body)).not.toContain(token);
  expect(service.resolve).not.toHaveBeenCalled();
});
it('returns 429 with retry guidance and sanitizes unexpected persistence errors', async () => {
  const { app, service } = fixture();
  service.rateLimit.mockRejectedValueOnce({ statusCode: 429 });
  const limited = await request(app)
    .post('/public/carton-delivery/resolve')
    .set('X-Carton-Delivery-Token', token)
    .send({})
    .expect(429);
  expect(limited.headers['retry-after']).toBe('60');
  service.resolve.mockRejectedValueOnce(new Error(`query includes ${token}`));
  const failed = await request(app)
    .post('/public/carton-delivery/resolve')
    .set('X-Carton-Delivery-Token', token)
    .send({})
    .expect(500);
  expect(JSON.stringify(failed.body)).not.toContain(token);
});
