import { describe, expect, it } from 'vitest';
import type { AdminUserSummary } from '../../master-data/types.js';
import { buildUserDetailViewModel } from './buildUserDetailViewModel.js';

function makeUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@erve.test',
    mobile: '9999999999',
    status: 'ACTIVE',
    roles: ['ADMIN'],
    distributors: [],
    factories: [],
    createdAt: '2026-08-20T10:30:00.000Z',
    updatedAt: '2026-08-21T10:30:00.000Z',
    ...overrides,
  };
}

describe('buildUserDetailViewModel', () => {
  it('maps the identity fields', () => {
    const vm = buildUserDetailViewModel(makeUser(), { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.identityItems.slice(0, 7)).toEqual([
      { label: 'Name', value: 'Jane Doe' },
      { label: 'Email', value: 'jane@erve.test' },
      { label: 'Mobile', value: '9999999999' },
      { label: 'Status', value: 'ACTIVE' },
      { label: 'Roles', value: 'ADMIN' },
      { label: 'Distributor', value: undefined },
      { label: 'Factory', value: undefined },
    ]);
    const created = vm.identityItems.find((item) => item.label === 'Created');
    const updated = vm.identityItems.find((item) => item.label === 'Updated');
    expect(created?.value).toMatch(/2026/);
    expect(updated?.value).toMatch(/2026/);
  });

  it('maps the mapped distributor/factory name when present', () => {
    const vm = buildUserDetailViewModel(
      makeUser({
        distributors: [{ id: 'd1', code: 'DIST-1', name: 'Acme Distribution' }],
        factories: [{ id: 'f1', code: 'FAC-1', name: 'Acme Factory' }],
      }),
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.identityItems).toContainEqual({ label: 'Distributor', value: 'Acme Distribution' });
    expect(vm.identityItems).toContainEqual({ label: 'Factory', value: 'Acme Factory' });
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildUserDetailViewModel(makeUser(), {
      generatedAt: '2026-09-12T00:00:00Z',
      generatedBy: 'Test Admin',
    });
    expect(vm.generatedBy).toBe('Test Admin');
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
      authVersion: 7,
    } as AdminUserSummary;

    const vm = buildUserDetailViewModel(dangerousUser, { generatedAt: '2026-09-12T00:00:00Z' });
    const serialized = JSON.stringify(vm);

    expect(serialized).not.toContain('plaintext-secret');
    expect(serialized).not.toContain('hash-secret');
    expect(serialized).not.toContain('reset-secret');
    expect(serialized).not.toContain('access-secret');
    expect(serialized).not.toContain('refresh-secret');
    expect(serialized).not.toContain('session-secret');
    expect(vm.identityItems.map((item) => item.label)).toEqual([
      'Name',
      'Email',
      'Mobile',
      'Status',
      'Roles',
      'Distributor',
      'Factory',
      'Created',
      'Updated',
    ]);
  });
});
