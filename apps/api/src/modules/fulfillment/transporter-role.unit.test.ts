import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '@erve/types';
import {
  canEditErveDispatchTransport,
  hasExclusiveTransporterRole,
  isValidTransporterRoleCombination,
  ERVE_DISPATCH_MUTATION_ROLES,
} from '@erve/shared';
import { createUserSchema } from '../users/users.validation.js';
import { ensureAllRoles } from '../../cli/roles.js';

describe('exclusive Transporter provisioning', () => {
  it('accepts Transporter alone and preserves existing combinations', () => {
    expect(ROLES).toContain('TRANSPORTER');
    expect(hasExclusiveTransporterRole({ roles: ['TRANSPORTER'] })).toBe(true);
    expect(isValidTransporterRoleCombination(['ADMIN', 'ACCOUNTANT'])).toBe(true);
    expect(
      createUserSchema.safeParse({
        name: 'Carrier',
        email: 'carrier@example.test',
        password: 'password1',
        roles: ['TRANSPORTER'],
      }).success,
    ).toBe(true);
  });
  it.each(ROLES.filter((role) => role !== 'TRANSPORTER'))(
    'rejects Transporter combined with %s',
    (role) => {
      const roles = ['TRANSPORTER', role] as const;
      expect(isValidTransporterRoleCombination(roles)).toBe(false);
      expect(hasExclusiveTransporterRole({ roles })).toBe(false);
      expect(canEditErveDispatchTransport({ roles })).toBe(false);
      expect(
        createUserSchema.safeParse({
          name: 'Carrier',
          email: 'carrier@example.test',
          password: 'password1',
          roles,
        }).success,
      ).toBe(false);
    },
  );
  it('keeps broad mutation roles unchanged and excludes Accountant from transport edits', () => {
    expect(ERVE_DISPATCH_MUTATION_ROLES).toEqual(['ADMIN', 'MERCHANDISER']);
    expect(canEditErveDispatchTransport({ roles: ['ACCOUNTANT'] })).toBe(false);
  });
  it('bootstraps the new role idempotently without touching existing roles', async () => {
    const rows = new Map<Role, { id: string; name: Role; description: string }>();
    const client = {
      role: {
        findUnique: async ({ where }: { where: { name: Role } }) => rows.get(where.name) ?? null,
        create: async ({ data }: { data: { id: string; name: Role; description: string } }) => {
          rows.set(data.name, data);
          return data;
        },
      },
    };
    expect((await ensureAllRoles(client)).created).toEqual([...ROLES]);
    expect(rows.get('TRANSPORTER')!.description).toContain('assigned');
    expect((await ensureAllRoles(client)).created).toEqual([]);
  });
});
