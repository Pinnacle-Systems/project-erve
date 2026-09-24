import { describe, expect, it } from 'vitest';
import { DevTargetGuardError, formatDevTargetReport, requireApprovedDevWriteTarget, requireVerifiedDevDatabaseTarget } from './dev-target-guard.js';

const DEV_URL = 'postgresql://postgres:postgres@localhost:5432/erve_dev?schema=public';

describe('requireVerifiedDevDatabaseTarget', () => {
  it('passes when DATABASE_URL exactly matches the declared expected Dev database', () => {
    const report = requireVerifiedDevDatabaseTarget({
      actualDatabaseUrl: DEV_URL,
      expectedDevDatabaseUrl: DEV_URL,
    });
    expect(report.targetValidation).toBe('PASSED');
    expect(report.actualDatabase).toBe('erve_dev');
    expect(report.expectedDatabase).toBe('erve_dev');
  });

  it('is case-insensitive on hostname and tolerant of the default port being implicit', () => {
    const report = requireVerifiedDevDatabaseTarget({
      actualDatabaseUrl: 'postgresql://postgres:postgres@LOCALHOST/erve_dev?schema=public',
      expectedDevDatabaseUrl: 'postgresql://postgres:postgres@localhost:5432/erve_dev?schema=public',
    });
    expect(report.targetValidation).toBe('PASSED');
  });

  it('rejects when HISTORICAL_IMPORT_EXPECTED_DEV_DATABASE_URL is unset — no inferred/guessed Dev target', () => {
    expect(() =>
      requireVerifiedDevDatabaseTarget({ actualDatabaseUrl: DEV_URL, expectedDevDatabaseUrl: undefined }),
    ).toThrow(DevTargetGuardError);
  });

  it('rejects when DATABASE_URL is unset', () => {
    expect(() =>
      requireVerifiedDevDatabaseTarget({ actualDatabaseUrl: undefined, expectedDevDatabaseUrl: DEV_URL }),
    ).toThrow(DevTargetGuardError);
  });

  it('rejects when the actual database differs from the expected one, even on the same host', () => {
    expect(() =>
      requireVerifiedDevDatabaseTarget({
        actualDatabaseUrl: 'postgresql://postgres:postgres@localhost:5432/erve_test?schema=public',
        expectedDevDatabaseUrl: DEV_URL,
      }),
    ).toThrow(DevTargetGuardError);
  });

  it('rejects when the actual host differs from the expected one, even with an identical database name', () => {
    expect(() =>
      requireVerifiedDevDatabaseTarget({
        actualDatabaseUrl: 'postgresql://postgres:postgres@some-other-host:5432/erve_dev?schema=public',
        expectedDevDatabaseUrl: DEV_URL,
      }),
    ).toThrow(DevTargetGuardError);
  });

  it('refuses the known Production host even if declared as the expected Dev target', () => {
    expect(() =>
      requireVerifiedDevDatabaseTarget({
        actualDatabaseUrl: 'postgresql://postgres:postgres@187.127.135.42:5432/erve_dev?schema=public',
        expectedDevDatabaseUrl: 'postgresql://postgres:postgres@187.127.135.42:5432/erve_dev?schema=public',
      }),
    ).toThrow(/Production host/);
  });

  it('never surfaces credentials in the thrown error message on a mismatch', () => {
    try {
      requireVerifiedDevDatabaseTarget({
        actualDatabaseUrl: 'postgresql://secretuser:secretpass@localhost:5432/erve_test?schema=public',
        expectedDevDatabaseUrl: DEV_URL,
      });
      throw new Error('expected requireVerifiedDevDatabaseTarget to throw');
    } catch (error) {
      expect(String(error)).not.toContain('secretuser');
      expect(String(error)).not.toContain('secretpass');
    }
  });
});

describe('formatDevTargetReport', () => {
  it('renders the declared mode alongside the verified target', () => {
    const report = requireVerifiedDevDatabaseTarget({
      actualDatabaseUrl: DEV_URL,
      expectedDevDatabaseUrl: DEV_URL,
    });
    const rendered = formatDevTargetReport(report, 'SCHEMA MIGRATION ONLY');
    expect(rendered).toContain('Mode: SCHEMA MIGRATION ONLY');
    expect(rendered).toContain('Target validation: PASSED');
    expect(rendered).not.toContain('postgres:postgres');
  });
});

describe('requireApprovedDevWriteTarget (H2B writes)', () => {
  const base = { actualDatabaseUrl: DEV_URL, expectedDevDatabaseUrl: DEV_URL, nodeEnv: 'development', liveCurrentDatabase: 'erve_dev' };

  it('passes only for erve_dev, NODE_ENV=development, and a live connection that reports erve_dev', () => {
    expect(requireApprovedDevWriteTarget(base).actualDatabase).toBe('erve_dev');
  });

  it('refuses a correctly-declared but non-approved database name', () => {
    const other = 'postgresql://postgres:postgres@localhost:5432/erve_docs';
    expect(() => requireApprovedDevWriteTarget({ ...base, actualDatabaseUrl: other, expectedDevDatabaseUrl: other, liveCurrentDatabase: 'erve_docs' })).toThrow(DevTargetGuardError);
  });

  it('refuses when NODE_ENV is not development', () => {
    expect(() => requireApprovedDevWriteTarget({ ...base, nodeEnv: 'production' })).toThrow(DevTargetGuardError);
    expect(() => requireApprovedDevWriteTarget({ ...base, nodeEnv: undefined })).toThrow(DevTargetGuardError);
  });

  it('refuses when the live connection reports a different database than the URL claims', () => {
    expect(() => requireApprovedDevWriteTarget({ ...base, liveCurrentDatabase: 'erve_prod' })).toThrow(DevTargetGuardError);
  });

  it('still refuses a URL mismatch or a missing declaration', () => {
    expect(() => requireApprovedDevWriteTarget({ ...base, expectedDevDatabaseUrl: undefined })).toThrow(DevTargetGuardError);
    expect(() => requireApprovedDevWriteTarget({ ...base, actualDatabaseUrl: 'postgresql://p:p@otherhost:5432/erve_dev' })).toThrow(DevTargetGuardError);
  });
});
