import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  resetDatabase,
  createTestUserAndToken,
  createTestDistributor,
  createTestFactory,
} from '../../test/helpers.js';

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

describe('POST /users/:id/distributors', () => {
  it('allows an ADMIN to map a user to a distributor', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    const res = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.distributors).toEqual([
      { id: distributor.id, code: distributor.code, name: distributor.name },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects duplicate mappings and mappings to inactive distributors', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const active = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });
    const inactive = await createTestDistributor({ code: 'D-002', name: 'Dormant Distribution', status: 'INACTIVE' });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: active.id })
      .expect(200);

    const duplicate = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: active.id });
    const inactiveRes = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: inactive.id });

    expect(duplicate.status).toBe(409);
    expect(inactiveRes.status).toBe(400);
    expect(inactiveRes.body.error.message).toBe('Cannot map a user to an inactive distributor');
  });

  it('rejects mapping a user who does not have the DISTRIBUTOR role', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: merchId } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    const res = await request(app)
      .post(`/users/${merchId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Only users with the DISTRIBUTOR role can be mapped to a distributor');
  });

  it('rejects a second distributor until the existing mapping is removed', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const first = await createTestDistributor({ code: 'D-001', name: 'First Distribution' });
    const second = await createTestDistributor({ code: 'D-002', name: 'Second Distribution' });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: first.id })
      .expect(200);

    const conflicting = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: second.id });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.message).toBe('User is already mapped to a different distributor');

    await request(app)
      .delete(`/users/${targetId}/distributors/${first.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const remapped = await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: second.id });

    expect(remapped.status).toBe(200);
    expect(remapped.body.data.distributors).toEqual([
      { id: second.id, code: 'D-002', name: 'Second Distribution' },
    ]);

    const addedLogs = await prisma.auditLog.findMany({
      where: { action: 'DISTRIBUTOR_MAPPING_ADDED', entityId: targetId },
      orderBy: { createdAt: 'asc' },
    });
    expect(addedLogs.map((log) => log.metadata)).toEqual([
      { distributorId: first.id },
      { distributorId: second.id },
    ]);
  });

  it('never yields more than one mapping under concurrent assignment attempts', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributors = await Promise.all(
      [1, 2, 3, 4].map((n) => createTestDistributor({ code: `D-00${n}`, name: `Distribution ${n}` })),
    );

    const responses = await Promise.all(
      distributors.map((distributor) =>
        request(app)
          .post(`/users/${targetId}/distributors`)
          .set('Authorization', `Bearer ${token}`)
          .send({ distributorId: distributor.id }),
      ),
    );

    const succeeded = responses.filter((res) => res.status === 200);
    const conflicted = responses.filter((res) => res.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(distributors.length - 1);

    const mappings = await prisma.userDistributor.count({ where: { userId: targetId } });
    expect(mappings).toBe(1);

    const addedLogs = await prisma.auditLog.count({
      where: { action: 'DISTRIBUTOR_MAPPING_ADDED', entityId: targetId },
    });
    expect(addedLogs).toBe(1);
  });

  it('is backed by a database constraint that rejects a second mapping row inserted directly', async () => {
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const first = await createTestDistributor({ code: 'D-001', name: 'First Distribution' });
    const second = await createTestDistributor({ code: 'D-002', name: 'Second Distribution' });

    await prisma.userDistributor.create({
      data: { id: createId(), userId: targetId, distributorId: first.id },
    });

    await expect(
      prisma.userDistributor.create({
        data: { id: createId(), userId: targetId, distributorId: second.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('removes a distributor mapping and records audit logs for both directions', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'distributor-user@test.local',
      password: 'target-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor({ code: 'D-001', name: 'Acme Distribution' });

    await request(app)
      .post(`/users/${targetId}/distributors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ distributorId: distributor.id })
      .expect(200);

    const removed = await request(app)
      .delete(`/users/${targetId}/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`);
    const removedAgain = await request(app)
      .delete(`/users/${targetId}/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(removed.status).toBe(200);
    expect(removed.body.data.distributors).toEqual([]);
    expect(removedAgain.status).toBe(404);

    const [added, deleted] = await Promise.all([
      prisma.auditLog.findFirst({ where: { action: 'DISTRIBUTOR_MAPPING_ADDED', entityId: targetId } }),
      prisma.auditLog.findFirst({ where: { action: 'DISTRIBUTOR_MAPPING_REMOVED', entityId: targetId } }),
    ]);
    expect(added?.metadata).toEqual({ distributorId: distributor.id });
    expect(deleted?.metadata).toEqual({ distributorId: distributor.id });
  });
});

describe('POST /users/:id/factories', () => {
  it('allows an ADMIN to map a user to a factory', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { userId: targetId } = await createTestUserAndToken({
      email: 'factory-user@test.local',
      password: 'target-password',
      roles: ['FACTORY_USER'],
    });
    const factory = await createTestFactory({ code: 'F-001', name: 'Acme Factory' });

    const res = await request(app)
      .post(`/users/${targetId}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.factories).toEqual([
      { id: factory.id, code: factory.code, name: factory.name },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});
