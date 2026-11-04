import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  role: { findUnique: vi.fn() },
  userRole: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: db,
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));
vi.mock('../../auth/password.js', () => ({ hashPassword: vi.fn() }));
vi.mock('../../audit/audit.service.js', () => ({ recordAuditLog: vi.fn() }));
import { assignRole, createUser } from '../users/users.service.js';
import type { CurrentUser } from '../../auth/current-user.js';
const actor = { id: 'admin', roles: ['ADMIN'] } as CurrentUser;
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.role.findUnique.mockResolvedValue({ id: 'role' });
});
it('rejects mixed roles even when createUser is called without route validation', async () => {
  await expect(
    createUser(actor, {
      name: 'T',
      email: 't@example.test',
      password: 'password1',
      roles: ['ADMIN', 'TRANSPORTER'],
    }),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(db.user.create).not.toHaveBeenCalled();
});
it.each([
  ['TRANSPORTER', 'ADMIN'],
  ['ADMIN', 'TRANSPORTER'],
] as const)('rejects adding %s to %s using a locked fresh role read', async (added, current) => {
  db.user.findUnique.mockResolvedValue({ userRoles: [{ role: { name: current } }] });
  await expect(assignRole(actor, 'target', added)).rejects.toMatchObject({ statusCode: 400 });
  expect(db.$queryRaw).toHaveBeenCalled();
  expect(db.userRole.create).not.toHaveBeenCalled();
});
