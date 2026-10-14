import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseTargetEnvironment,
  parseConfiguredDatabaseTarget,
  verifyDatabaseTarget,
  formatOperationSummary,
  loadRuntimeEnvironment,
  type LiveDatabaseTarget,
} from './sequence-target-guard.js';
import { DocumentSequenceBaselineError } from './document-sequence-baseline.js';

describe('SequenceTargetGuard', () => {
  describe('loadRuntimeEnvironment', () => {
    it('loads environment variables from an explicit --env-file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erve-env-test-'));
      const envPath = path.join(tempDir, 'custom.env');
      fs.writeFileSync(envPath, 'CUSTOM_CLI_TEST_VAR=explicit_loaded_value\n');

      try {
        const result = loadRuntimeEnvironment({ explicitEnvFile: envPath });
        expect(result.loadedPath).toBe(envPath);
        expect(process.env.CUSTOM_CLI_TEST_VAR).toBe('explicit_loaded_value');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.CUSTOM_CLI_TEST_VAR;
      }
    });

    it('throws if specified --env-file does not exist', () => {
      expect(() =>
        loadRuntimeEnvironment({ explicitEnvFile: '/nonexistent/path/does-not-exist.env' }),
      ).toThrow(/Specified --env-file not found/);
    });

    it('loads from script-adjacent .env when available', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erve-adjacent-test-'));
      const scriptPath = path.join(tempDir, 'cli.js');
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(scriptPath, '// dummy script');
      fs.writeFileSync(envPath, 'ADJACENT_TEST_VAR=adjacent_loaded_value\n');

      try {
        const result = loadRuntimeEnvironment({ scriptPath, cwd: os.tmpdir() });
        expect(result.loadedPath).toBe(envPath);
        expect(process.env.ADJACENT_TEST_VAR).toBe('adjacent_loaded_value');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.ADJACENT_TEST_VAR;
      }
    });
  });

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
      serverAddress: '10.0.1.5',
      serverPort: '5432',
      configuredHost: 'prod-db.internal',
      configuredPort: '5432',
      schema: 'public',
    };

    it('passes for production mutation when all guards, expectations, and schema match', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedHost: 'prod-db.internal',
            expectedSchema: 'public',
            isMutation: true,
          },
          validLiveProd,
        ),
      ).not.toThrow();
    });

    it('accepts server-reported address as expected host', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedHost: '10.0.1.5',
            expectedSchema: 'public',
            isMutation: true,
          },
          validLiveProd,
        ),
      ).not.toThrow();
    });

    it('rejects production mutation when NODE_ENV is unset or non-production', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: undefined,
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedSchema: 'public',
            isMutation: true,
          },
          validLiveProd,
        ),
      ).toThrow(/Production mutation requires explicit NODE_ENV="production", but found "unset"/);

      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'local',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedSchema: 'public',
            isMutation: true,
          },
          validLiveProd,
        ),
      ).toThrow(/Production mutation requires explicit NODE_ENV="production", but found "local"/);
    });

    it('rejects production mutation when --expect-schema is missing', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'erve_prod',
            expectedSchema: undefined,
            isMutation: true,
          },
          validLiveProd,
        ),
      ).toThrow(/Production mutation requires --expect-schema <schema>/);
    });

    it('passes for read-only preflight in production without --confirm-production', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            expectedDatabase: 'erve_prod',
            isMutation: false,
          },
          validLiveProd,
        ),
      ).not.toThrow();
    });

    it('rejects read-only preflight in production when --expect-database is missing', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            expectedDatabase: undefined,
            isMutation: false,
          },
          validLiveProd,
        ),
      ).toThrow(/Production target requires --expect-database <name>/);
    });

    it('rejects incorrect database name', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: true,
            expectedDatabase: 'wrong_prod_db',
            expectedSchema: 'public',
            isMutation: true,
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
            expectedSchema: 'public',
            isMutation: true,
          },
          validLiveProd,
        ),
      ).toThrow(/Database host mismatch: configured endpoint host is "prod-db.internal"/);
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
            isMutation: true,
          },
          validLiveProd,
        ),
      ).toThrow(/Database schema mismatch: connected schema is "public", but --expect-schema specified "tenant_schema"/);
    });

    it('rejects production mutation execution without explicit confirmation', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'production',
            confirmProduction: false,
            expectedDatabase: 'erve_prod',
            expectedSchema: 'public',
            isMutation: true,
          },
          validLiveProd,
        ),
      ).toThrow(/Production execution requires explicit confirmation via --confirm-production/);
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

    it('rejects conflicting environment in preflight: target=production but NODE_ENV=development', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'development',
            expectedDatabase: 'erve_prod',
            expectedSchema: 'public',
            isMutation: false,
          },
          validLiveProd,
        ),
      ).toThrow(/Conflicting environment configuration: --target is "production" but NODE_ENV is "development"/);
    });

    it('rejects conflicting environment in preflight: target=production but NODE_ENV=test', () => {
      expect(() =>
        verifyDatabaseTarget(
          {
            target: 'PRODUCTION',
            nodeEnv: 'test',
            expectedDatabase: 'erve_prod',
            expectedSchema: 'public',
            isMutation: false,
          },
          validLiveProd,
        ),
      ).toThrow(/Conflicting environment configuration: --target is "production" but NODE_ENV is "test"/);
    });

    it('passes for dev target when NODE_ENV is development and expected database matches', () => {
      const liveDev: LiveDatabaseTarget = {
        databaseName: 'erve_dev',
        serverAddress: '127.0.0.1',
        serverPort: '5432',
        configuredHost: 'localhost',
        configuredPort: '5432',
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
          serverAddress: '10.0.2.15',
          serverPort: '5432',
          configuredHost: 'db.prod.internal',
          configuredPort: '5432',
          schema: 'public',
        },
        documentType: 'TAX_INVOICE',
        financialYearCode: '2026-27',
        approvedSerial: 100,
        currentBaseline: 50,
        sequenceExists: true,
        dryRun: false,
      });

      expect(summary).toContain('Target Environment:      PRODUCTION');
      expect(summary).toContain('Configured Endpoint:     db.prod.internal:5432');
      expect(summary).toContain('Server-Reported Address: 10.0.2.15:5432');
      expect(summary).toContain('Database Name:           erve_prod');
      expect(summary).toContain('Database Schema:         public');
      expect(summary).toContain('Document Type:           TAX_INVOICE');
      expect(summary).toContain('Financial Year:          2026-27');
      expect(summary).toContain('Requested Serial:        100');
      expect(summary).toContain('Current Baseline:        50');
      expect(summary).toContain('Action:                  ADVANCE sequence from 50 to 100');
      expect(summary).not.toContain('password');
      expect(summary).not.toContain('postgres:');
    });

    it('identifies fresh uninitialized sequence in summary', () => {
      const summary = formatOperationSummary({
        target: 'PRODUCTION',
        liveTarget: {
          databaseName: 'erve_prod',
          serverAddress: '',
          serverPort: '',
          configuredHost: 'localhost',
          configuredPort: '5432',
          schema: 'public',
        },
        documentType: 'TAX_INVOICE',
        financialYearCode: '2026-27',
        approvedSerial: 0,
        sequenceExists: false,
        dryRun: true,
      });

      expect(summary).toContain('[DRY RUN]');
      expect(summary).toContain('Current Baseline:        Uninitialized (row does not exist)');
      expect(summary).toContain('Action:                  INITIALIZE sequence at 0 (next allocated serial will be 1)');
      expect(summary).toContain('Server-Reported Address: local socket / unavailable');
    });
  });
});
