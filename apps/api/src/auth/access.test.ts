import { describe, expect, it } from 'vitest';
import { HttpError } from '../errors/http-error.js';
import {
  getSoleDistributorId,
  getSoleFactoryId,
  requireDistributorAccess,
  requireFactoryAccess,
} from './access.js';
import type { CurrentUser } from './current-user.js';

function distributorUser(distributorIds: string[]): CurrentUser {
  return {
    id: 'user-1',
    email: 'dist@test.local',
    mobile: null,
    name: 'Distributor User',
    status: 'ACTIVE',
    authVersion: 1,
    roles: ['DISTRIBUTOR'],
    distributorIds,
    factoryIds: [],
  };
}

function factoryUser(factoryIds: string[]): CurrentUser {
  return {
    id: 'user-2',
    email: 'factory@test.local',
    mobile: null,
    name: 'Factory User',
    status: 'ACTIVE',
    authVersion: 1,
    roles: ['FACTORY_USER'],
    distributorIds: [],
    factoryIds,
  };
}

function statusCodeOf(fn: () => unknown): number | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof HttpError ? error.statusCode : undefined;
  }
}

describe('getSoleDistributorId', () => {
  it('returns the single mapped distributor id', () => {
    expect(getSoleDistributorId(distributorUser(['dist-1']))).toBe('dist-1');
  });

  it('rejects users with no distributor mapping with the standard authorization error', () => {
    expect(statusCodeOf(() => getSoleDistributorId(distributorUser([])))).toBe(403);
    expect(() => getSoleDistributorId(distributorUser([]))).toThrow(
      'No distributor is mapped to your account',
    );
  });

  it('fails closed with a server-side configuration error when legacy data holds multiple mappings', () => {
    const user = distributorUser(['dist-1', 'dist-2']);
    expect(statusCodeOf(() => getSoleDistributorId(user))).toBe(500);
    expect(() => getSoleDistributorId(user)).toThrow(/mapped to multiple distributors/);
  });
});

describe('requireDistributorAccess', () => {
  it('allows the mapped distributor and rejects others', () => {
    expect(() => requireDistributorAccess(distributorUser(['dist-1']), 'dist-1')).not.toThrow();
    expect(
      statusCodeOf(() => requireDistributorAccess(distributorUser(['dist-1']), 'dist-2')),
    ).toBe(403);
  });

  it('fails closed for multi-mapped users instead of using mapping order', () => {
    const user = distributorUser(['dist-1', 'dist-2']);
    expect(statusCodeOf(() => requireDistributorAccess(user, 'dist-1'))).toBe(500);
  });
});

describe('getSoleFactoryId', () => {
  it('returns the single mapped factory id', () => {
    expect(getSoleFactoryId(factoryUser(['factory-1']))).toBe('factory-1');
  });

  it('rejects users with no factory mapping with the dedicated mapping-required error', () => {
    expect(statusCodeOf(() => getSoleFactoryId(factoryUser([])))).toBe(403);
    expect(() => getSoleFactoryId(factoryUser([]))).toThrow(/factory mapping is required/);
  });

  it('fails closed with a dedicated ambiguous-mapping error when legacy data holds multiple mappings', () => {
    const user = factoryUser(['factory-1', 'factory-2']);
    expect(statusCodeOf(() => getSoleFactoryId(user))).toBe(403);
    expect(() => getSoleFactoryId(user)).toThrow(/Multiple factory mappings/);
  });
});

describe('requireFactoryAccess', () => {
  it('allows the mapped factory and rejects others', () => {
    expect(() => requireFactoryAccess(factoryUser(['factory-1']), 'factory-1')).not.toThrow();
    expect(statusCodeOf(() => requireFactoryAccess(factoryUser(['factory-1']), 'factory-2'))).toBe(
      403,
    );
  });

  it('fails closed for multi-mapped users instead of using mapping order', () => {
    const user = factoryUser(['factory-1', 'factory-2']);
    expect(statusCodeOf(() => requireFactoryAccess(user, 'factory-1'))).toBe(403);
  });
});
