import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase, createTestUser } from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/login', () => {
  it('logs in successfully with correct credentials and returns no passwordHash', async () => {
    await createTestUser({ email: 'admin@test.local', password: 'correct-password', roles: ['ADMIN'] });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@test.local', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.user.email).toBe('admin@test.local');
    expect(res.body.data.user.roles).toEqual(['ADMIN']);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects a wrong password with a generic error', async () => {
    await createTestUser({ email: 'admin@test.local', password: 'correct-password', roles: ['ADMIN'] });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@test.local', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
  });

  it('rejects login for an inactive user with the same generic error', async () => {
    await createTestUser({
      email: 'inactive@test.local',
      password: 'correct-password',
      roles: ['ADMIN'],
      status: 'INACTIVE',
    });

    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'inactive@test.local', password: 'correct-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /auth/me', () => {
  it('rejects a request without a token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user for a valid token, with roles from user_roles', async () => {
    await createTestUser({
      email: 'multi-role@test.local',
      password: 'correct-password',
      roles: ['ADMIN', 'MERCHANDISER'],
    });

    const login = await request(app)
      .post('/auth/login')
      .send({ identifier: 'multi-role@test.local', password: 'correct-password' });

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('multi-role@test.local');
    expect(res.body.data.roles.sort()).toEqual(['ADMIN', 'MERCHANDISER'].sort());
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});
