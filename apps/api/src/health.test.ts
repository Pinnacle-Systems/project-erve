import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, withTimeout } from './app.js';
import { prisma } from './db/prisma.js';

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /health', () => {
  it('returns 200 without touching the database', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptimeSeconds).toBe('number');
  });
});

describe('GET /ready', () => {
  it('returns 200 when the database is reachable', async () => {
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('does not leak connection details on failure', async () => {
    const res = await request(app).get('/ready');

    expect(JSON.stringify(res.body)).not.toMatch(/postgres(?:ql)?:\/\//);
  });
});

describe('withTimeout', () => {
  it('resolves with the wrapped value when it settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('value'), 50)).resolves.toBe('value');
  });

  it('rejects with the original error when the wrapped promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });

  it('rejects once the timeout elapses before the wrapped promise settles', async () => {
    const neverSettles = new Promise(() => {});

    await expect(withTimeout(neverSettles, 10)).rejects.toThrow('timed out');
  });
});
