import { describe, expect, it } from 'vitest';
import {
  parseTargetEnvironment,
  parseConfiguredDatabaseTarget,
  verifyDatabaseTarget,
  formatOperationSummary,
  type LiveDatabaseTarget,
} from './sequence-target-guard.js';
import { DocumentSequenceBaselineError } from './document-sequence-baseline.js';

describe('SequenceTargetGuard', () => {
  describe('parseTargetEnvironment', () => {
    it('accepts valid target environment names case-insensitively', () => {
      expect(parseTargetEnvironment('production')).toBe('PRODUCTION');
      expect(parseTargetEnvironment('PRODUCTION')).toBe('PRODUCTION');
      expect(parseTargetEnvironment('dev')).toBe('DEV');
      expect(parseTargetEnvironment('staging')).toBe('STAGING');
      expect(parseTargetEnvironment('local')).toBe('LOCAL');
      expect(parseTargetEnvironment('test')).toBe('TEST');
    });

    it('rejects missing or empty target flag', () => {
      expect(() => parseTargetEnvironment(undefined)).toThrow(DocumentSequenceBaselineError);
      expect(() => parseTargetEnvironment('')).toThrow(/--target is required/);
    });

    it('rejects unknown target environments', () => {
      expect(() => parseTargetEnvironment('qa')).toThrow(/Invalid --target "qa"/);
    });
  });

  describe('parseConfiguredDatabaseTarget', () => {
    it('parses host, port, database, and schema without leaking credentials', () => {
      const parsed = parseConfiguredDatabaseTarget(
        'postgresql://secret_user:super_secret_pw@db.internal:5433/erve_prod?schema=custom',
      );
      expect(parsed).toEqual({
        host: 'db.internal',
        port: '5433',
        database: 'erve_prod',
        schema: 'custom',
      });
    });

    it('falls back safely for undefined or unparseable URLs', () => {
      expect(parseConfiguredDatabaseTarget(undefined)).toEqual({
        host: 'unknown',
        port: '5432',
        database: 'unknown',
        schema: 'public',
      });
      expect(parseConfiguredDatabaseTarget('not-a-valid-url')).toEqual({
        host: 'unparseable',
        port: '5432',
        database: 'unknown',
        schema: 'public',
      });
    });
  });

  describe('verifyDatabaseTarget', () => {
    const validLiveProd: LiveDatabaseTarget = {
      databaseName: 'erve_prod',
      serverHost: 'prod-db.internal',
      serverPort: '5432',
      schema: 'public',
    };

    it('passes for production when all guards and independent expectations match', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedHost: 'prod-db.internal',
            expectedSchema: 'public',
          },
          validLiveProd,
        ),
      ).not.toThrow();
    });

    it('rejects incorrect database name', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'wrong_prod_db',
          },
          validLiveProd,
        ),
      ).toThrow(/Database identity mismatch: live current_database\(\) is "erve_prod", but --expect-database specified "wrong_prod_db"/);
    });

    it('rejects incorrect database host', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedHost: 'wrong-host.internal',
          },
          validLiveProd,
        ),
      ).toThrow(/Database host mismatch: connected host is "prod-db.internal", but --expect-host specified "wrong-host.internal"/);
    });

    it('rejects incorrect database schema', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedSchema: 'tenant_schema',
          },
          validLiveProd,
        ),
      ).toThrow(/Database schema mismatch: connected schema is "public", but --expect-schema specified "tenant_schema"/);
    });

    it('rejects production execution without explicit confirmation', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: false,
            expectedDatabase: 'erve_prod',
          },
          validLiveProd,
        ),
      ).toThrow(/Production execution requires explicit confirmation via --confirm-production/);
    });

    it('rejects production execution without expected database declaration', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: undefined,
          },
          validLiveProd,
        ),
      ).toThrow(/Production target requires --expect-database <name> to independently verify connected database identity/);
    });

    it('rejects conflicting environment: NODE_ENV=production but target=dev', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'DEV',
            nodeEnv: 'production',
            confirmProduction: false,
          },
          validLiveProd,
        ),
      ).toThrow(/Conflicting environment configuration: NODE_ENV is "production" but --target was specified as "dev"/);
    });

    it('rejects conflicting environment: target=production but NODE_ENV=development', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'development',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
          },
          validLiveProd,
        ),
      ).toThrow(/Conflicting environment configuration: --target is "production" but NODE_ENV is "development"/);
    });

    it('rejects conflicting environment: target=production but NODE_ENV=test', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'test',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
          },
          validLiveProd,
        ),
      ).toThrow(/Conflicting environment configuration: --target is "production" but NODE_ENV is "test"/);
    });

    it('passes for dev target when NODE_ENV is development and expected database matches', () => {
      const liveDev: LiveDatabaseTarget = {
        databaseName: 'erve_dev',
        serverHost: 'localhost',
        serverPort: '5432',
        schema: 'public',
      };
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'DEV',
            nodeEnv: 'development',
            expectedDatabase: 'erve_dev',
          },
          liveDev,
        ),
      ).not.toThrow();
    });
  });

  describe('formatOperationSummary', () => {
    it('generates a clean sanitized summary with no credentials or secrets', () => {
      const summary = formatOperationSummary({
        target: 'PRODUCTION',
        liveTarget: {
          databaseName: 'erve_prod',
          serverHost: 'db.prod.internal',
          serverPort: '5432',
          schema: 'public',
        },
        documentType: 'TAX_INVOICE',
        financialYearCode: '2026-27',
        approvedSerial: 100,
        currentBaseline: 50,
        sequenceExists: true,
        dryRun: false,
      });

      expect(summary).toContain('Target Environment:  PRODUCTION');
      expect(summary).toContain('Database Host:       db.prod.internal:5432');
      expect(summary).toContain('Database Name:       erve_prod');
      expect(summary).toContain('Database Schema:     public');
      expect(summary).toContain('Document Type:       TAX_INVOICE');
      expect(summary).toContain('Financial Year:      2026-27');
      expect(summary).toContain('Requested Serial:    100');
      expect(summary).toContain('Current Baseline:    50');
      expect(summary).toContain('Action:              ADVANCE sequence from 50 to 100');
      expect(summary).not.toContain('password');
      expect(summary).not.toContain('postgres:');
    });

    it('identifies fresh uninitialized sequence in summary', () => {
      const summary = formatOperationSummary({
        target: 'PRODUCTION',
        liveTarget: {
          databaseName: 'erve_prod',
          serverHost: 'db.prod.internal',
          serverPort: '5432',
          schema: 'public',
        },
        documentType: 'TAX_INVOICE',
        financialYearCode: '2026-27',
        approvedSerial: 0,
        sequenceExists: false,
        dryRun: true,
      });

      expect(summary).toContain('[DRY RUN]');
      expect(summary).toContain('Current Baseline:    Uninitialized (row does not exist)');
      expect(summary).toContain('Action:              INITIALIZE sequence at 0 (next allocated serial will be 1)');
    });
  });
});
