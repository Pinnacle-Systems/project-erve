import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  userRole: { findFirst: vi.fn(), create: vi.fn() },
  role: { findUnique: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({ prisma: db }));
vi.mock('../../auth/password.js', () => ({ hashPassword: vi.fn() }));
import { runAdminBootstrap, type AdminBootstrapPrismaClient } from '../../cli/admin-bootstrap.js';
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({
    id: 't1',
    email: 't@example.test',
    status: 'ACTIVE',
    userRoles: [{ role: { name: 'TRANSPORTER' } }],
  });
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.role.findUnique.mockImplementation(async ({ where }) => ({
    id: where.name,
    name: where.name,
  }));
});
it('refuses to bootstrap ADMIN onto an exclusive Transporter account under the role lock', async () => {
  await expect(
    runAdminBootstrap(
      {
        email: 't@example.test',
        name: 'Carrier',
        nodeEnv: 'test',
        confirmProduction: false,
        resetPassword: false,
        getPassword: async () => 'password1',
      },
      {
        prisma: db as unknown as AdminBootstrapPrismaClient,
        databaseUrl: 'postgresql://unused@localhost/unused',
      },
    ),
  ).rejects.toThrow('TRANSPORTER must be the only account role');
  expect(db.$queryRaw).toHaveBeenCalled();
  expect(db.userRole.create).not.toHaveBeenCalled();
  expect(db.user.update).not.toHaveBeenCalled();
});

it.each(['ADMIN', 'MERCHANDISER', 'ACCOUNTANT'])(
  'preserves bootstrap compatibility for %s',
  async (role) => {
    db.user.findUnique.mockResolvedValue({
      id: 'user',
      email: 't@example.test',
      status: 'ACTIVE',
      userRoles: [{ role: { name: role } }],
    });
    const result = await runAdminBootstrap(
      {
        email: 't@example.test',
        name: 'User',
        nodeEnv: 'test',
        confirmProduction: false,
        resetPassword: false,
        getPassword: async () => 'password1',
      },
      {
        prisma: db as unknown as AdminBootstrapPrismaClient,
        databaseUrl: 'postgresql://unused@localhost/unused',
      },
    );
    expect(result.outcome).toBe(role === 'ADMIN' ? 'already_configured' : 'role_added');
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.user.findUnique.mock.invocationCallOrder[1]!,
    );
  },
);
