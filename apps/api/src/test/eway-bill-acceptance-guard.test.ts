import { describe, expect, it } from 'vitest';
import {
  EWAY_ACCEPTANCE_DATABASE_NAME,
  EWAY_ACCEPTANCE_SYNTHETIC_KEY,
  requireEwayAcceptanceEnvironment,
} from './eway-bill-acceptance-guard.js';

const URL_OK = `postgresql://postgres:pw@127.0.0.1:5432/${EWAY_ACCEPTANCE_DATABASE_NAME}`;
const safe = (over: Record<string, string | undefined> = {}) => ({
  EWAY_ACCEPTANCE_AUTHORIZED: 'true',
  NODE_ENV: 'test',
  EWAY_ACCEPTANCE_DATABASE_URL: URL_OK,
  DATABASE_URL: URL_OK,
  GST_VERIFICATION_API_KEY: EWAY_ACCEPTANCE_SYNTHETIC_KEY,
  ...over,
});

describe('E-Way Bill acceptance environment guard', () => {
  it('accepts exactly the disposable loopback target with the synthetic key', () => {
    expect(requireEwayAcceptanceEnvironment(safe())).toEqual({
      databaseUrl: URL_OK,
      databaseName: EWAY_ACCEPTANCE_DATABASE_NAME,
    });
  });

  it.each([
    ['missing authorization', { EWAY_ACCEPTANCE_AUTHORIZED: undefined }, 'EWAY_ACCEPTANCE_AUTHORIZED'],
    ['a non-test NODE_ENV', { NODE_ENV: 'development' }, 'NODE_ENV'],
    ['a missing database URL', { EWAY_ACCEPTANCE_DATABASE_URL: undefined }, 'TEST_DATABASE_URL is required'],
    [
      'a differently named database',
      {
        EWAY_ACCEPTANCE_DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/erve_other_test',
        DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/erve_other_test',
      },
      'must be named',
    ],
    [
      'a development-looking database',
      {
        EWAY_ACCEPTANCE_DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/erve_dev',
        DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/erve_dev',
      },
      'standalone test marker',
    ],
    [
      'a remote database host',
      {
        EWAY_ACCEPTANCE_DATABASE_URL: `postgresql://postgres:pw@db.example.com:5432/${EWAY_ACCEPTANCE_DATABASE_NAME}`,
        DATABASE_URL: `postgresql://postgres:pw@db.example.com:5432/${EWAY_ACCEPTANCE_DATABASE_NAME}`,
      },
      'loopback',
    ],
    [
      'an application DATABASE_URL that differs from the acceptance target',
      { DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:5432/erve_dev' },
      'DATABASE_URL must equal',
    ],
    ['a missing provider key', { GST_VERIFICATION_API_KEY: undefined }, 'synthetic key'],
    ['a real-looking provider key', { GST_VERIFICATION_API_KEY: 'live_abcdef123456' }, 'synthetic key'],
    ['a portal username', { EWAY_BILL_PORTAL_USERNAME: 'someone' }, 'portal credential'],
    ['a portal password', { EWAY_BILL_PORTAL_PASSWORD: 'secret' }, 'portal credential'],
    ['Live settings authorization', { GST_COMPLIANCE_LIVE_AUTHORIZED: 'true' }, 'Live authorization'],
    ['Live lookup authorization', { GST_VERIFICATION_LIVE_LOOKUP_AUTHORIZED: 'true' }, 'Live authorization'],
    ['Demo generation pre-authorized', { EWAY_BILL_DEMO_GENERATION_AUTHORIZED: 'true' }, 'must start unset or false'],
  ])('refuses %s', (_name, over, message) => {
    expect(() => requireEwayAcceptanceEnvironment(safe(over))).toThrow(message);
  });
});
