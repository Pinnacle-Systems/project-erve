import { describe, expect, it } from 'vitest';
import type { AdminUserSummary } from '../../master-data/types.js';
import { buildUserListViewModel } from './buildUserListViewModel.js';

function makeUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@erve.test',
    mobile: null,
    status: 'ACTIVE',
    roles: ['ADMIN'],
    distributors: [],
    factories: [],
    createdAt: '2026-08-20T10:30:00.000Z',
    updatedAt: '2026-08-20T10:30:00.000Z',
    ...overrides,
  };
}

describe('buildUserListViewModel', () => {
  it('maps users into rows and preserves API row order', () => {
    const users = [makeUser({ id: 'a' }), makeUser({ id: 'b' })];
    const vm = buildUserListViewModel(users, {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.totalCount).toBe(2);
  });

  it('joins multiple roles and picks the first mapped distributor/factory name', () => {
    const user = makeUser({
      roles: ['ADMIN', 'MERCHANDISER'],
      distributors: [{ id: 'd1', code: 'DIST-1', name: 'Acme Distribution' }],
      factories: [{ id: 'f1', code: 'FAC-1', name: 'Acme Factory' }],
    });
    const vm = buildUserListViewModel([user], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows[0]).toMatchObject({
      roles: 'ADMIN, MERCHANDISER',
      distributorName: 'Acme Distribution',
      factoryName: 'Acme Factory',
    });
  });

  it('formats the createdAt date using the shared PDF date formatter', () => {
    const vm = buildUserListViewModel([makeUser({ createdAt: '2026-08-20T10:30:00.000Z' })], {}, {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.rows[0]!.createdAt).toMatch(/2026/);
  });

  it('propagates active search/status/role filters into the filter summary', () => {
    const vm = buildUserListViewModel(
      [],
      { search: 'jane', status: 'ACTIVE', role: 'ADMIN' },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'jane' },
      { label: 'Status', value: 'ACTIVE' },
      { label: 'Role', value: 'ADMIN' },
    ]);
  });

  it('handles an empty user list', () => {
    const vm = buildUserListViewModel([], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('never leaks sensitive auth fields even if the API fixture carries them', () => {
    const dangerousUser = {
      ...makeUser(),
      password: 'plaintext-secret',
      passwordHash: 'hash-secret',
      resetToken: 'reset-secret',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      sessionSecret: 'session-secret',
    } as AdminUserSummary;

    const vm = buildUserListViewModel([dangerousUser], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    const serialized = JSON.stringify(vm);

    expect(serialized).not.toContain('plaintext-secret');
    expect(serialized).not.toContain('hash-secret');
    expect(serialized).not.toContain('reset-secret');
    expect(serialized).not.toContain('access-secret');
    expect(serialized).not.toContain('refresh-secret');
    expect(serialized).not.toContain('session-secret');
    expect(Object.keys(vm.rows[0]!)).toEqual([
      'id',
      'name',
      'email',
      'status',
      'roles',
      'distributorName',
      'factoryName',
      'createdAt',
    ]);
  });
});
