import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import {
  runEiNumberingPreflight,
  parseCanonicalInvoiceNumber,
} from './ei-numbering-preflight.service.js';
import type {
  PreflightOptions,
  AuthoritativeExternalRecord,
} from './ei-numbering-preflight.types.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('parseCanonicalInvoiceNumber', () => {
  it('parses valid canonical EI invoice numbers correctly', () => {
    const result = parseCanonicalInvoiceNumber('EI/26-27/0042', 'EXTERNAL_REGISTER', 'ISSUED');
    expect(result.isWellFormed).toBe(true);
    expect(result.fyCompactCode).toBe('26-27');
    expect(result.serial).toBe(42);
    expect(result.digitCount).toBe(4);
    expect(result.source).toBe('EXTERNAL_REGISTER');
  });

  it('accepts numbers exceeding 4 digits consistent with shared formatter', () => {
    const result9999 = parseCanonicalInvoiceNumber('EI/26-27/9999', 'EXTERNAL_REGISTER');
    expect(result9999.isWellFormed).toBe(true);
    expect(result9999.serial).toBe(9999);
    expect(result9999.digitCount).toBe(4);

    const result10000 = parseCanonicalInvoiceNumber('EI/26-27/10000', 'EXTERNAL_REGISTER');
    expect(result10000.isWellFormed).toBe(true);
    expect(result10000.serial).toBe(10000);
    expect(result10000.digitCount).toBe(5);
  });

  it('rejects malformed invoice numbers with fewer than 4 digits', () => {
    expect(parseCanonicalInvoiceNumber('EI/26-27/1', 'EXTERNAL_REGISTER').isWellFormed).toBe(false);
    expect(parseCanonicalInvoiceNumber('EI/26-27/01', 'EXTERNAL_REGISTER').isWellFormed).toBe(
      false,
    );
    expect(parseCanonicalInvoiceNumber('EI/26-27/001', 'EXTERNAL_REGISTER').isWellFormed).toBe(
      false,
    );
  });

  it('rejects foreign prefixes or missing delimiters', () => {
    expect(parseCanonicalInvoiceNumber('EIOS/26-27/0001', 'EXTERNAL_REGISTER').isWellFormed).toBe(
      false,
    );
    expect(parseCanonicalInvoiceNumber('EI26001', 'EXTERNAL_REGISTER').isWellFormed).toBe(false);
    expect(parseCanonicalInvoiceNumber('INV-2026-0001', 'EXTERNAL_REGISTER').isWellFormed).toBe(
      false,
    );
  });
});

describe('runEiNumberingPreflight Diagnostics', () => {
  it('passes all checks when FY is seeded and external source is valid and non-colliding', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const externalRecords: AuthoritativeExternalRecord[] = [
      { invoiceNumber: 'EI/26-27/0001', status: 'ISSUED', invoiceDate: '2026-04-05' },
      { invoiceNumber: 'EI/26-27/0002', status: 'ISSUED', invoiceDate: '2026-04-06' },
      { invoiceNumber: 'EI/26-27/0003', status: 'CANCELLED', invoiceDate: '2026-04-07' },
    ];

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords,
      externalSourceManifest: {
        systemName: 'Tally Prime ERP',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'accountant@example.com',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);

    // Uninitialized sequence is a warning, so verdict is READY WITH CONDITIONS
    expect(report.verdict).toBe('READY WITH CONDITIONS');
    expect(report.summary.blocked).toBe(0);
    expect(report.summary.warned).toBeGreaterThan(0);
    expect(report.readinessBreakdown.isPreparationReady).toBe(true);
    expect(report.readinessBreakdown.isSchemaConfigReady).toBe(false); // TAX_INVOICE enum not yet in schema
    expect(report.readinessBreakdown.isProductionCutoverReady).toBe(false);
    expect(report.highWaterMark.verifiedHighWaterMark).toBe(3);
    expect(report.highWaterMark.nextProposedSerial).toBe(4);
    expect(report.highWaterMark.nextProposedInvoiceNumber).toBe('EI/26-27/0004');
  });

  it('blocks when the target Financial Year is not seeded in the database', async () => {
    const options: PreflightOptions = {
      targetFinancialYearCode: '2026-27',
      externalHighWaterMark: 100,
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.verdict).toBe('BLOCKED');
    expect(report.readinessBreakdown.isPreparationReady).toBe(false);
    const fyCheck = report.checks.find((c) => c.checkId === 'CHK_FINANCIAL_YEAR');
    expect(fyCheck?.status).toBe('BLOCKED');
    expect(fyCheck?.message).toMatch(/not seeded/i);
  });

  it('blocks when target Financial Year code syntax is invalid', async () => {
    const options: PreflightOptions = {
      targetFinancialYearCode: '26-27', // missing 4-digit start year
      externalHighWaterMark: 100,
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.verdict).toBe('BLOCKED');
    const fyCheck = report.checks.find((c) => c.checkId === 'CHK_FINANCIAL_YEAR');
    expect(fyCheck?.status).toBe('BLOCKED');
    expect(fyCheck?.message).toMatch(/invalid code syntax/i);
  });

  it('blocks when Financial Year boundary dates in database drift from April 1 - March 31', async () => {
    // Manually insert a drifted FY
    await prisma.financialYear.create({
      data: {
        id: 'drifted-fy-id',
        code: '2026-27',
        startDate: new Date('2026-04-05T00:00:00.000Z'), // Drifted
        endDate: new Date('2027-03-31T00:00:00.000Z'),
      },
    });

    const options: PreflightOptions = {
      targetFinancialYearCode: '2026-27',
      externalHighWaterMark: 50,
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.verdict).toBe('BLOCKED');
    const fyCheck = report.checks.find((c) => c.checkId === 'CHK_FINANCIAL_YEAR');
    expect(fyCheck?.status).toBe('BLOCKED');
    expect(fyCheck?.message).toMatch(/drift from April 1/i);
  });

  it('blocks when no external records or high-water mark are provided', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.verdict).toBe('BLOCKED');
    const sourceCheck = report.checks.find((c) => c.checkId === 'CHK_SOURCE_COMPLETENESS');
    expect(sourceCheck?.status).toBe('BLOCKED');
    expect(sourceCheck?.message).toMatch(/No authoritative external/i);
  });

  it('distinguishes preparation from production cutover: blocks production when manifest is missing', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    // In LOCAL/DEV environment: missing manifest is a warning (acceptable during preparation)
    const localReport = await runEiNumberingPreflight(prisma, {
      targetFinancialYearCode: fy.code,
      externalHighWaterMark: 100,
      environment: 'LOCAL',
    });
    const localSourceCheck = localReport.checks.find(
      (c) => c.checkId === 'CHK_SOURCE_COMPLETENESS',
    );
    expect(localSourceCheck?.status).toBe('WARN');

    // In PRODUCTION environment: missing manifest is strictly BLOCKED
    const prodReport = await runEiNumberingPreflight(prisma, {
      targetFinancialYearCode: fy.code,
      externalHighWaterMark: 100,
      environment: 'PRODUCTION',
    });
    expect(prodReport.verdict).toBe('BLOCKED');
    const prodSourceCheck = prodReport.checks.find((c) => c.checkId === 'CHK_SOURCE_COMPLETENESS');
    expect(prodSourceCheck?.status).toBe('BLOCKED');
    expect(prodSourceCheck?.message).toMatch(/Production cutover is BLOCKED/i);
    expect(prodReport.readinessBreakdown.isProductionCutoverReady).toBe(false);
  });

  it('blocks when malformed invoice numbers are detected in source records', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords: [
        { invoiceNumber: 'EI/26-27/0001' },
        { invoiceNumber: 'INVALID_SYNTAX_0002' },
      ],
      externalSourceManifest: {
        systemName: 'Legacy System',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.verdict).toBe('BLOCKED');
    const syntaxCheck = report.checks.find((c) => c.checkId === 'CHK_INVOICE_SYNTAX');
    expect(syntaxCheck?.status).toBe('BLOCKED');
    expect(syntaxCheck?.message).toMatch(/do not match canonical pattern/i);
  });

  it('blocks when duplicate invoice numbers exist in external records', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords: [
        { invoiceNumber: 'EI/26-27/0001', status: 'ISSUED' },
        { invoiceNumber: 'EI/26-27/0001', status: 'ISSUED' }, // Duplicate
      ],
      externalSourceManifest: {
        systemName: 'Legacy System',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.verdict).toBe('BLOCKED');
    const uniqCheck = report.checks.find((c) => c.checkId === 'CHK_UNIQUENESS');
    expect(uniqCheck?.status).toBe('BLOCKED');
    expect(uniqCheck?.message).toMatch(/Duplicate.*detected/i);
  });

  it('correctly includes CANCELLED invoices in the high-water mark calculation', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords: [
        { invoiceNumber: 'EI/26-27/0001', status: 'ISSUED' },
        { invoiceNumber: 'EI/26-27/0002', status: 'ISSUED' },
        { invoiceNumber: 'EI/26-27/0003', status: 'CANCELLED' }, // Highest is cancelled
      ],
      externalSourceManifest: {
        systemName: 'Legacy System',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);

    expect(report.highWaterMark.verifiedHighWaterMark).toBe(3);
    expect(report.highWaterMark.nextProposedSerial).toBe(4);
    expect(report.highWaterMark.nextProposedInvoiceNumber).toBe('EI/26-27/0004');
  });

  it('handles serial capacity: warns at 9000-9999 and blocks when next allocation exceeds 9999 due to unresolved policy', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    // Case A: Serial 9200 (approaching limit)
    const warnReport = await runEiNumberingPreflight(prisma, {
      targetFinancialYearCode: fy.code,
      externalHighWaterMark: 9200,
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    });
    const warnCapCheck = warnReport.checks.find((c) => c.checkId === 'CHK_SERIAL_CAPACITY');
    expect(warnCapCheck?.status).toBe('WARN');
    expect(warnCapCheck?.message).toMatch(/approaching 4-digit capacity limit/i);
    expect(warnReport.highWaterMark.nextProposedSerial).toBe(9201);
    expect(warnReport.highWaterMark.unresolvedWidthPolicy).toBe(false);

    // Case B: Serial 9999 (next allocation is 10000 -> 5 digits!)
    const at9999Report = await runEiNumberingPreflight(prisma, {
      targetFinancialYearCode: fy.code,
      externalHighWaterMark: 9999,
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    });
    expect(at9999Report.verdict).toBe('BLOCKED');
    expect(at9999Report.highWaterMark.nextProposedSerial).toBe(10000);
    expect(at9999Report.highWaterMark.nextProposedInvoiceNumber).toBe('EI/26-27/10000');
    expect(at9999Report.highWaterMark.unresolvedWidthPolicy).toBe(true);
    const at9999CapCheck = at9999Report.checks.find((c) => c.checkId === 'CHK_SERIAL_CAPACITY');
    expect(at9999CapCheck?.status).toBe('BLOCKED');
    expect(at9999CapCheck?.message).toMatch(/exceeds 4 digits/i);

    // Case C: Serial 10000 (already at 5 digits)
    const at10000Report = await runEiNumberingPreflight(prisma, {
      targetFinancialYearCode: fy.code,
      externalHighWaterMark: 10000,
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    });
    expect(at10000Report.verdict).toBe('BLOCKED');
    expect(at10000Report.highWaterMark.nextProposedSerial).toBe(10001);
    expect(at10000Report.highWaterMark.unresolvedWidthPolicy).toBe(true);
  });

  it('guarantees zero persistent mutations and is strictly idempotent', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalHighWaterMark: 150,
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    };

    // Snapshot counts before preflight
    const fyCountBefore = await prisma.financialYear.count();
    const seqCountBefore = await prisma.documentSequence.count();
    const invCountBefore = await prisma.taxInvoice.count();

    // Run 1
    const report1 = await runEiNumberingPreflight(prisma, options);

    // Snapshot counts after Run 1
    const fyCountAfter1 = await prisma.financialYear.count();
    const seqCountAfter1 = await prisma.documentSequence.count();
    const invCountAfter1 = await prisma.taxInvoice.count();

    expect(fyCountAfter1).toBe(fyCountBefore);
    expect(seqCountAfter1).toBe(seqCountBefore);
    expect(invCountAfter1).toBe(invCountBefore);

    // Run 2
    const report2 = await runEiNumberingPreflight(prisma, options);

    expect(report2.verdict).toBe(report1.verdict);
    expect(report2.summary).toEqual(report1.summary);
    expect(report2.highWaterMark).toEqual(report1.highWaterMark);
  });

  it('warns when records from foreign financial years are provided', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords: [
        { invoiceNumber: 'EI/26-27/0001' },
        { invoiceNumber: 'EI/25-26/0099' }, // Prior FY
      ],
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'tester',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);

    const fySepCheck = report.checks.find((c) => c.checkId === 'CHK_FY_SEPARATION');
    expect(fySepCheck?.status).toBe('WARN');
    expect(fySepCheck?.message).toMatch(/non-target financial year/i);
  });

  it('flags cross-system overlap as ambiguous match when lacking authoritative identity evidence', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    await prisma.$executeRawUnsafe('ALTER TABLE tax_invoices DISABLE TRIGGER ALL');
    await prisma.$executeRawUnsafe(
      `INSERT INTO tax_invoices (id, status, invoice_number, erve_packing_list_id, distributor_id, purchase_mode, seller_registration_id, seller_legal_name, seller_gstin, seller_einvoice_applicable, seller_address_line1, seller_city, seller_state, seller_state_code, seller_postal_code, seller_country, seller_bank_name, seller_bank_account_name, seller_bank_account_number, seller_bank_ifsc, seller_bank_branch_name, bill_to_name, bill_to_gstin, created_by_id, updated_at)
       VALUES ('test-overlap-inv-1', 'FINALIZED', 'EI/26-27/0001', 'pl-10', 'dist-1', 'OUTRIGHT', 'sr-1', 'Seller', '29AAAAA0000A1Z5', false, 'Addr', 'City', 'State', '29', '560001', 'India', 'Bank', 'Acct', '12345', 'IFSC001', 'Branch', 'BillTo', '29BBBBB0000B1Z5', 'user-1', now())`,
    );
    await prisma.$executeRawUnsafe('ALTER TABLE tax_invoices ENABLE TRIGGER ALL');

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords: [
        { invoiceNumber: 'EI/26-27/0001', status: 'ISSUED' }, // Overlap without sourceReference
        { invoiceNumber: 'EI/26-27/0002', status: 'ISSUED' },
      ],
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'accountant@example.com',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);
    const uniqCheck = report.checks.find((c) => c.checkId === 'CHK_UNIQUENESS');
    expect(uniqCheck?.status).toBe('WARN');
    expect(uniqCheck?.evidence?.hasAmbiguousMatches).toBe(true);
    expect(uniqCheck?.message).toMatch(/without authoritative identity evidence/i);
  });

  it('validates cross-system representation with PASS when authoritative identity evidence is provided', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    await prisma.$executeRawUnsafe('ALTER TABLE tax_invoices DISABLE TRIGGER ALL');
    await prisma.$executeRawUnsafe(
      `INSERT INTO tax_invoices (id, status, invoice_number, erve_packing_list_id, distributor_id, purchase_mode, seller_registration_id, seller_legal_name, seller_gstin, seller_einvoice_applicable, seller_address_line1, seller_city, seller_state, seller_state_code, seller_postal_code, seller_country, seller_bank_name, seller_bank_account_name, seller_bank_account_number, seller_bank_ifsc, seller_bank_branch_name, bill_to_name, bill_to_gstin, created_by_id, updated_at)
       VALUES ('test-overlap-inv-auth', 'FINALIZED', 'EI/26-27/0001', 'pl-11', 'dist-1', 'OUTRIGHT', 'sr-1', 'Seller', '29AAAAA0000A1Z5', false, 'Addr', 'City', 'State', '29', '560001', 'India', 'Bank', 'Acct', '12345', 'IFSC001', 'Branch', 'BillTo', '29BBBBB0000B1Z5', 'user-1', now())`,
    );
    await prisma.$executeRawUnsafe('ALTER TABLE tax_invoices ENABLE TRIGGER ALL');

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      externalRecords: [
        // Authoritative link: sourceReference explicitly matches ERVE TaxInvoice id
        {
          invoiceNumber: 'EI/26-27/0001',
          status: 'ISSUED',
          sourceReference: 'test-overlap-inv-auth',
        },
        { invoiceNumber: 'EI/26-27/0002', status: 'ISSUED' },
      ],
      externalSourceManifest: {
        systemName: 'Tally',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'accountant@example.com',
      },
    };

    const report = await runEiNumberingPreflight(prisma, options);
    const uniqCheck = report.checks.find((c) => c.checkId === 'CHK_UNIQUENESS');
    expect(uniqCheck?.status).toBe('PASS');
    expect(uniqCheck?.evidence?.hasAmbiguousMatches).toBe(false);
  });

  it('distinguishes pre-baseline readiness from post-baseline production cutover readiness', async () => {
    const fy = await ensureFinancialYear(prisma, new Date('2026-06-01'));

    const options: PreflightOptions = {
      targetFinancialYearCode: fy.code,
      environment: 'PRODUCTION',
      externalRecords: [
        { invoiceNumber: 'EI/26-27/0001', status: 'ISSUED' },
        { invoiceNumber: 'EI/26-27/0002', status: 'ISSUED' },
      ],
      externalSourceManifest: {
        systemName: 'Tally Prime',
        extractedAt: '2026-10-08T10:00:00.000Z',
        verifiedBy: 'lead.accountant@example.com',
        freezeConfirmed: true,
      },
    };

    // Pre-baseline run: sequence does not exist
    const preBaselineReport = await runEiNumberingPreflight(prisma, options);
    // Baseline reconciliation is authorized because all prerequisite evidence is verified
    expect(preBaselineReport.readinessBreakdown.isBaselineReconciliationReady).toBe(true);
    // But live production cutover allocation remains blocked until baselined
    expect(preBaselineReport.readinessBreakdown.isProductionCutoverReady).toBe(false);
    expect(preBaselineReport.checks.find((c) => c.checkId === 'CHK_SEQUENCE_STATE')?.status).toBe(
      'BLOCKED',
    );
  });
});
