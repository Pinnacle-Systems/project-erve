import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase, createTestUserAndToken } from '../../test/helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /users', () => {
  it('allows an ADMIN to create a user', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New User',
        email: 'new-user@test.local',
        password: 'new-user-password',
        roles: ['MERCHANDISER'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('new-user@test.local');
    expect(res.body.data.roles).toEqual(['MERCHANDISER']);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects a non-ADMIN caller', async () => {
    const { token } = await createTestUserAndToken({
      email: 'merchandiser@test.local',
      password: 'some-password',
      roles: ['MERCHANDISER'],
    });

    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New User',
        email: 'new-user@test.local',
        password: 'new-user-password',
      });

    expect(res.status).toBe(403);
  });
});

describe('GET /users (role-gated route)', () => {
  it('rejects a caller with insufficient role', async () => {
    const { token } = await createTestUserAndToken({
      email: 'qa@test.local',
      password: 'some-password',
      roles: ['QA_USER'],
    });

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('allows an ADMIN caller and never returns passwordHash', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('POST /users/:id/roles', () => {
  it('allows an ADMIN to assign multiple roles to a user', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'target@test.local',
      password: 'target-password',
      roles: ['MERCHANDISER'],
    });

    await request(app)
      .post(`/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleName: 'QA_USER' })
      .expect(200);

    const res = await request(app)
      .post(`/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleName: 'ACCOUNTANT' });

    expect(res.status).toBe(200);
    expect(res.body.data.roles.sort()).toEqual(['ACCOUNTANT', 'MERCHANDISER', 'QA_USER'].sort());
  });
});
