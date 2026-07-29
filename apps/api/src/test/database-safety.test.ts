import { describe, expect, it } from 'vitest';
import { requireSafeTestDatabaseUrl } from './database-safety.js';

describe('API test database safety contract', () => {
  it('requires an explicitly designated test URL', () => {
    expect(() => requireSafeTestDatabaseUrl({})).toThrow('TEST_DATABASE_URL is required');
  });

  it.each(['erve_dev', 'contest', 'testimony', 'production'])(
    'rejects unsafe database name %s',
    (databaseName) => {
      expect(() =>
        requireSafeTestDatabaseUrl({
          testDatabaseUrl: `postgresql://localhost:5432/${databaseName}`,
        }),
      ).toThrow('does not contain a standalone test marker');
    },
  );

  it('rejects a test URL resolving to the development target', () => {
    expect(() =>
      requireSafeTestDatabaseUrl({
        testDatabaseUrl: 'postgresql://user:other@localhost:5432/erve_test',
        developmentDatabaseUrl: 'postgresql://user:secret@LOCALHOST:5432/erve_test',
      }),
    ).toThrow('matches DATABASE_URL');
  });

  it('accepts an explicit, distinct disposable database', () => {
    expect(
      requireSafeTestDatabaseUrl({
        testDatabaseUrl: 'postgresql://localhost:5432/erve_test',
        developmentDatabaseUrl: 'postgresql://localhost:5432/erve_dev',
      }),
    ).toMatchObject({ databaseName: 'erve_test' });
  });
});
