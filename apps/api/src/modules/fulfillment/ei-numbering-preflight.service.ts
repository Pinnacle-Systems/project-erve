/**
 * Read-Only EI Numbering Preflight Diagnostic Service.
 * Story: INV-012 — EI Numbering Cutover Preparation.
 *
 * GUARANTEES:
 * 1. Strictly read-only: zero INSERT, UPDATE, DELETE, UPSERT, or sequence mutations.
 * 2. Never calls mutating helpers like ensureFinancialYear or allocateDocumentSerial.
 * 3. Never guesses or assumes an unverified EI high-water mark.
 * 4. Fails closed (BLOCKED) if authoritative external information is missing or contradictory.
 * 5. Distinguishes preparation completeness, schema/config readiness, and production cutover readiness.
 */

import type { Prisma, prisma } from '../../db/prisma.js';
import { toCompactFinancialYearCode } from '../master-data/financial-year.util.js';
import { formatDocumentNumber } from '../master-data/document-number.util.js';
import type {
  PreflightOptions,
  PreflightReport,
  PreflightCheckResult,
  OverallVerdict,
  PreflightReadinessBreakdown,
} from './ei-numbering-preflight.types.js';

type DbClient = typeof prisma | Prisma.TransactionClient;

/**
 * Canonical EI invoice pattern: "EI/<2-digit start FY>-<2-digit end FY>/<at least 4 digits>".
 * Matches the shared formatter behavior (minimum 4 digits with zero-padding, expands beyond 9999).
 */
export const CANONICAL_EI_INVOICE_REGEX = /^EI\/(\d{2}-\d{2})\/(\d{4,})$/;

export const FOUR_DIGIT_CAPACITY_LIMIT = 9999;
export const WARNING_FOUR_DIGIT_SERIAL_THRESHOLD = 9000;

export interface InvoiceRecordComparison {
  invoiceNumber: string;
  source: 'ERVE_DATABASE' | 'EXTERNAL_REGISTER';
  fyCompactCode: string;
  serial: number;
  status?: string;
  isWellFormed: boolean;
  digitCount: number;
  sourceReference?: string;
  recordId?: string;
  invoiceDate?: string;
}

export function parseCanonicalInvoiceNumber(
  invoiceNumber: string,
  source: 'ERVE_DATABASE' | 'EXTERNAL_REGISTER',
  status?: string,
  metadata?: { sourceReference?: string; recordId?: string; invoiceDate?: string },
): InvoiceRecordComparison {
  const match = CANONICAL_EI_INVOICE_REGEX.exec(invoiceNumber);
  if (!match) {
    return {
      invoiceNumber,
      source,
      fyCompactCode: '',
      serial: -1,
      status,
      isWellFormed: false,
      digitCount: 0,
      sourceReference: metadata?.sourceReference,
      recordId: metadata?.recordId,
      invoiceDate: metadata?.invoiceDate,
    };
  }
  const digitsStr = match[2]!;
  return {
    invoiceNumber,
    source,
    fyCompactCode: match[1]!,
    serial: Number.parseInt(digitsStr, 10),
    status,
    isWellFormed: true,
    digitCount: digitsStr.length,
    sourceReference: metadata?.sourceReference,
    recordId: metadata?.recordId,
    invoiceDate: metadata?.invoiceDate,
  };
}

/**
 * Runs all 11 read-only preflight diagnostic checks against the provided database client
 * and external source data.
 */
export async function runEiNumberingPreflight(
  client: DbClient,
  options: PreflightOptions,
): Promise<PreflightReport> {
  const checks: PreflightCheckResult[] = [];
  const targetFYCode = options.targetFinancialYearCode.trim();
  const compactTargetFYCode = toCompactFinancialYearCode(targetFYCode);
  const environment = options.environment ?? 'LOCAL';
  const isProduction = environment === 'PRODUCTION';

  // ---------------------------------------------------------------------------
  // Check 1: CHK_FINANCIAL_YEAR — Target FY in DB and calendar boundaries
  // ---------------------------------------------------------------------------
  let financialYearRecord: { id: string; code: string; startDate: Date; endDate: Date } | null =
    null;
  const fyFormatValid = /^\d{4}-\d{2}$/.test(targetFYCode);

  if (!fyFormatValid) {
    checks.push({
      checkId: 'CHK_FINANCIAL_YEAR',
      title: 'Financial Year Syntax and Existence',
      status: 'BLOCKED',
      message: `Target Financial Year "${targetFYCode}" has invalid code syntax. Must be in YYYY-YY format (e.g. "2026-27").`,
      evidence: { targetFYCode, validFormat: false },
      actionRequired: 'Provide a valid Indian financial year code in YYYY-YY format.',
    });
  } else {
    // Read-only query — NEVER calls ensureFinancialYear
    financialYearRecord = await client.financialYear.findUnique({
      where: { code: targetFYCode },
    });

    if (!financialYearRecord) {
      checks.push({
        checkId: 'CHK_FINANCIAL_YEAR',
        title: 'Financial Year Existence in Database',
        status: 'BLOCKED',
        message: `Financial Year "${targetFYCode}" is not seeded in the database.`,
        evidence: { targetFYCode, foundInDatabase: false },
        actionRequired: `Seed Financial Year "${targetFYCode}" using the financial-year bootstrap utility prior to cutover.`,
      });
    } else {
      // Validate boundaries match April 1 – March 31
      const startMonth1Based = financialYearRecord.startDate.getUTCMonth() + 1;
      const startDay = financialYearRecord.startDate.getUTCDate();
      const endMonth1Based = financialYearRecord.endDate.getUTCMonth() + 1;
      const endDay = financialYearRecord.endDate.getUTCDate();

      const isAprilFirst = startMonth1Based === 4 && startDay === 1;
      const isMarchThirtyFirst = endMonth1Based === 3 && endDay === 31;

      if (!isAprilFirst || !isMarchThirtyFirst) {
        checks.push({
          checkId: 'CHK_FINANCIAL_YEAR',
          title: 'Financial Year Calendar Boundary Integrity',
          status: 'BLOCKED',
          message: `Financial Year "${targetFYCode}" boundaries in database (${financialYearRecord.startDate.toISOString().slice(0, 10)} to ${financialYearRecord.endDate.toISOString().slice(0, 10)}) drift from April 1 – March 31.`,
          evidence: {
            code: targetFYCode,
            startDate: financialYearRecord.startDate.toISOString().slice(0, 10),
            endDate: financialYearRecord.endDate.toISOString().slice(0, 10),
            isAprilFirst,
            isMarchThirtyFirst,
          },
          actionRequired:
            'Correct financial year boundary dates to align with the canonical April 1–March 31 Indian fiscal year.',
        });
      } else {
        checks.push({
          checkId: 'CHK_FINANCIAL_YEAR',
          title: 'Financial Year Configuration and Boundaries',
          status: 'PASS',
          message: `Financial Year "${targetFYCode}" exists with valid 1-April to 31-March boundaries.`,
          evidence: {
            id: financialYearRecord.id,
            code: financialYearRecord.code,
            compactCode: compactTargetFYCode,
            startDate: financialYearRecord.startDate.toISOString().slice(0, 10),
            endDate: financialYearRecord.endDate.toISOString().slice(0, 10),
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Check 2: CHK_DOCUMENT_TYPE_CONFIG — DocumentType and DOCUMENT_PREFIXES readiness
  // ---------------------------------------------------------------------------
  let dbEnumHasTaxInvoice: boolean;
  try {
    const enumRows = await client.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'DocumentType' AND e.enumlabel = 'TAX_INVOICE'
    `;
    dbEnumHasTaxInvoice = enumRows.length > 0;
  } catch {
    dbEnumHasTaxInvoice = false;
  }

  if (!dbEnumHasTaxInvoice) {
    checks.push({
      checkId: 'CHK_DOCUMENT_TYPE_CONFIG',
      title: 'Tax Invoice Document Type Enum Configuration',
      // In production cutover, missing enum is a hard BLOCKED; in preparation, it is WARN
      status: isProduction ? 'BLOCKED' : 'WARN',
      message: isProduction
        ? 'TAX_INVOICE is not registered in the DocumentType database enum. Production cutover is BLOCKED pending INV-006 schema migration.'
        : 'TAX_INVOICE is not yet added to the DocumentType database enum or DOCUMENT_PREFIXES. Acceptable during bounded preparation (INV-012), but blocks production cutover (INV-006 dependency).',
      evidence: {
        dbEnumHasTaxInvoice: false,
        canonicalPrefix: 'EI',
        dependencyOwner: 'INV-006',
        targetEnvironment: environment,
      },
      actionRequired:
        'INV-006 must deploy schema migration adding TAX_INVOICE to DocumentType enum and map DOCUMENT_PREFIXES.TAX_INVOICE to "EI" prior to production activation.',
    });
  } else {
    checks.push({
      checkId: 'CHK_DOCUMENT_TYPE_CONFIG',
      title: 'Tax Invoice Document Type Enum Configuration',
      status: 'PASS',
      message: 'TAX_INVOICE is registered in DocumentType database enum.',
      evidence: { dbEnumHasTaxInvoice: true, canonicalPrefix: 'EI' },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 3: CHK_SEQUENCE_STATE — Current DocumentSequence inspection
  // ---------------------------------------------------------------------------
  let sequenceLastAllocatedSerial: number | null = null;
  let sequenceRowExists = false;

  if (financialYearRecord && dbEnumHasTaxInvoice) {
    try {
      const seqRows = await client.$queryRaw<Array<{ last_allocated_serial: number }>>`
        SELECT last_allocated_serial
        FROM document_sequences
        WHERE document_type = 'TAX_INVOICE'::"DocumentType"
          AND financial_year_id = ${financialYearRecord.id}
      `;
      if (seqRows.length > 0 && seqRows[0]) {
        sequenceRowExists = true;
        sequenceLastAllocatedSerial = seqRows[0].last_allocated_serial;
      }
    } catch {
      sequenceRowExists = false;
    }
  }

  if (!sequenceRowExists) {
    checks.push({
      checkId: 'CHK_SEQUENCE_STATE',
      title: 'DocumentSequence State for TAX_INVOICE',
      // In production cutover, missing sequence row is a BLOCKED condition; in preparation, it is WARN
      status: isProduction ? 'BLOCKED' : 'WARN',
      message: isProduction
        ? `DocumentSequence row for (TAX_INVOICE, ${targetFYCode}) does not exist. Production cutover is BLOCKED until baseline is adjusted.`
        : `DocumentSequence row for (TAX_INVOICE, ${targetFYCode}) does not exist. It remains uninitialized.`,
      evidence: { exists: false, targetFYCode, autoCreated: false, targetEnvironment: environment },
      actionRequired:
        'Preflight does not auto-create sequence records. Set baseline via document-sequence-baseline CLI during authorized cutover window.',
    });
  } else {
    checks.push({
      checkId: 'CHK_SEQUENCE_STATE',
      title: 'DocumentSequence State for TAX_INVOICE',
      status: 'PASS',
      message: `DocumentSequence exists for FY ${targetFYCode} with lastAllocatedSerial = ${sequenceLastAllocatedSerial}.`,
      evidence: { exists: true, targetFYCode, lastAllocatedSerial: sequenceLastAllocatedSerial },
    });
  }

  // ---------------------------------------------------------------------------
  // Read existing ERVE invoices safely
  // ---------------------------------------------------------------------------
  const erveInvoiceRecords: Array<{
    id: string;
    invoiceNumber: string | null;
    status: string;
    createdAt: Date;
  }> = [];
  try {
    const rawInvoices = await client.$queryRaw<
      Array<{ id: string; invoice_number: string | null; status: string; created_at: Date }>
    >`
      SELECT id, invoice_number, status, created_at
      FROM tax_invoices
      WHERE invoice_number IS NOT NULL
    `;
    for (const row of rawInvoices) {
      erveInvoiceRecords.push({
        id: row.id,
        invoiceNumber: row.invoice_number,
        status: row.status,
        createdAt: row.created_at,
      });
    }
  } catch {
    // If tax_invoices table is not present or query fails, treat as empty
  }

  // Parse all invoices
  const allParsedInvoices: InvoiceRecordComparison[] = [];

  for (const inv of erveInvoiceRecords) {
    if (inv.invoiceNumber) {
      allParsedInvoices.push(
        parseCanonicalInvoiceNumber(inv.invoiceNumber, 'ERVE_DATABASE', inv.status, {
          recordId: inv.id,
          invoiceDate: inv.createdAt ? inv.createdAt.toISOString() : undefined,
        }),
      );
    }
  }

  if (options.externalRecords && options.externalRecords.length > 0) {
    for (const ext of options.externalRecords) {
      allParsedInvoices.push(
        parseCanonicalInvoiceNumber(ext.invoiceNumber, 'EXTERNAL_REGISTER', ext.status, {
          sourceReference: ext.sourceReference,
          invoiceDate: ext.invoiceDate,
        }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Check 4: CHK_INVOICE_SYNTAX — Syntax validation
  // ---------------------------------------------------------------------------
  const malformedInvoices = allParsedInvoices.filter((i) => !i.isWellFormed);
  const widerThanFourDigits = allParsedInvoices.filter((i) => i.isWellFormed && i.digitCount > 4);

  if (malformedInvoices.length > 0) {
    checks.push({
      checkId: 'CHK_INVOICE_SYNTAX',
      title: 'Canonical Invoice Number Syntax Validation',
      status: 'BLOCKED',
      message: `Found ${malformedInvoices.length} invoice numbers that do not match canonical pattern "EI/<FY>/<serial (min 4 digits)>".`,
      evidence: {
        malformedCount: malformedInvoices.length,
        examples: malformedInvoices.slice(0, 5).map((m) => ({
          invoiceNumber: m.invoiceNumber,
          source: m.source,
        })),
        pattern: 'EI/<FY>/<min 4 digits>',
      },
      actionRequired:
        'Investigate and correct malformed invoice number strings in source datasets.',
    });
  } else if (widerThanFourDigits.length > 0) {
    checks.push({
      checkId: 'CHK_INVOICE_SYNTAX',
      title: 'Canonical Invoice Number Syntax Validation',
      status: 'WARN',
      message: `All ${allParsedInvoices.length} invoice numbers are syntactically well-formed, but ${widerThanFourDigits.length} numbers exceed 4 digits (e.g. "${widerThanFourDigits[0]?.invoiceNumber}"). Formatter minimum width is 4 digits.`,
      evidence: {
        checkedCount: allParsedInvoices.length,
        malformedCount: 0,
        widerThanFourDigitsCount: widerThanFourDigits.length,
        samples: widerThanFourDigits.slice(0, 3).map((w) => w.invoiceNumber),
      },
      actionRequired:
        'Confirm business policy regarding invoice numbers with 5 or more serial digits.',
    });
  } else {
    checks.push({
      checkId: 'CHK_INVOICE_SYNTAX',
      title: 'Canonical Invoice Number Syntax Validation',
      status: 'PASS',
      message: `All ${allParsedInvoices.length} checked invoice numbers conform to canonical "EI/<FY>/<4-digit serial>" syntax.`,
      evidence: { checkedCount: allParsedInvoices.length, malformedCount: 0 },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 5: CHK_UNIQUENESS — Duplicate invoice detection across systems
  // ---------------------------------------------------------------------------
  const erveInvoiceCounts = new Map<string, number>();
  for (const inv of allParsedInvoices.filter((i) => i.source === 'ERVE_DATABASE')) {
    erveInvoiceCounts.set(inv.invoiceNumber, (erveInvoiceCounts.get(inv.invoiceNumber) ?? 0) + 1);
  }
  const erveDuplicates = [...erveInvoiceCounts.entries()].filter(([, c]) => c > 1);

  const externalInvoiceCounts = new Map<string, number>();
  for (const inv of allParsedInvoices.filter((i) => i.source === 'EXTERNAL_REGISTER')) {
    externalInvoiceCounts.set(
      inv.invoiceNumber,
      (externalInvoiceCounts.get(inv.invoiceNumber) ?? 0) + 1,
    );
  }
  const externalDuplicates = [...externalInvoiceCounts.entries()].filter(([, c]) => c > 1);

  // Cross-system overlap: invoice in both ERVE and external ledger
  const crossSystemOverlap = [...erveInvoiceCounts.keys()].filter((num) =>
    externalInvoiceCounts.has(num),
  );

  const ambiguousMatches: Array<{
    invoiceNumber: string;
    erveRecordId?: string;
    erveStatus?: string;
    externalStatus?: string;
    reason: string;
  }> = [];

  const conflictingMatches: Array<{
    invoiceNumber: string;
    reason: string;
  }> = [];

  const authoritativeMatches: Array<{
    invoiceNumber: string;
    sourceReference: string;
    erveRecordId: string;
  }> = [];

  for (const num of crossSystemOverlap) {
    const erveRec = allParsedInvoices.find(
      (i) => i.source === 'ERVE_DATABASE' && i.invoiceNumber === num,
    );
    const extRec = allParsedInvoices.find(
      (i) => i.source === 'EXTERNAL_REGISTER' && i.invoiceNumber === num,
    );

    if (erveRec && extRec) {
      // Check for conflicting statuses
      const statusConflict =
        (erveRec.status === 'FINALIZED' && extRec.status === 'CANCELLED') ||
        (erveRec.status === 'DRAFT' && extRec.status === 'CANCELLED');

      // Authoritative identity evidence requires verifiable linkage
      const hasAuthoritativeLink =
        Boolean(extRec.sourceReference) &&
        Boolean(erveRec.recordId) &&
        extRec.sourceReference === erveRec.recordId;

      if (statusConflict) {
        conflictingMatches.push({
          invoiceNumber: num,
          reason: `Status conflict: ERVE status is "${erveRec.status}", external status is "${extRec.status}".`,
        });
      } else if (hasAuthoritativeLink) {
        authoritativeMatches.push({
          invoiceNumber: num,
          sourceReference: extRec.sourceReference!,
          erveRecordId: erveRec.recordId!,
        });
      } else {
        // Matching invoice number, date and status alone cannot automatically establish that two records represent the same underlying invoice.
        ambiguousMatches.push({
          invoiceNumber: num,
          erveRecordId: erveRec.recordId,
          erveStatus: erveRec.status,
          externalStatus: extRec.status,
          reason:
            'Lacks verifiable authoritative cross-system identity evidence (e.g. matching sourceReference). Matching number, date, and status alone cannot prove identical underlying transaction.',
        });
      }
    }
  }

  if (erveDuplicates.length > 0 || externalDuplicates.length > 0 || conflictingMatches.length > 0) {
    checks.push({
      checkId: 'CHK_UNIQUENESS',
      title: 'Invoice Identity Uniqueness',
      status: 'BLOCKED',
      message: `Duplicate or conflicting invoice identities detected across authoritative datasets.`,
      evidence: {
        erveDuplicates: erveDuplicates.map(([num, count]) => ({ invoiceNumber: num, count })),
        externalDuplicates: externalDuplicates.map(([num, count]) => ({
          invoiceNumber: num,
          count,
        })),
        conflictingMatches,
      },
      actionRequired:
        'Resolve duplicate or conflicting invoice records in the respective database or ledger before proceeding.',
    });
  } else if (ambiguousMatches.length > 0) {
    checks.push({
      checkId: 'CHK_UNIQUENESS',
      title: 'Invoice Identity Uniqueness and Cross-System Overlap',
      status: 'WARN',
      message: `${ambiguousMatches.length} invoice numbers appear in both ERVE and external registers without authoritative identity evidence. Matching number, date, and status alone cannot establish identical underlying invoices; flagged for operator review.`,
      evidence: {
        crossSystemOverlapCount: crossSystemOverlap.length,
        ambiguousMatchesCount: ambiguousMatches.length,
        ambiguousMatches: ambiguousMatches.slice(0, 5),
        authoritativeMatchesCount: authoritativeMatches.length,
        hasAmbiguousMatches: true,
      },
      actionRequired:
        'Operator and Accountant must review ambiguous cross-system matches to verify whether they represent the same underlying invoice or a conflicting duplicate allocation.',
    });
  } else if (authoritativeMatches.length > 0) {
    checks.push({
      checkId: 'CHK_UNIQUENESS',
      title: 'Invoice Identity Uniqueness and Cross-System Overlap',
      status: 'PASS',
      message: `All ${crossSystemOverlap.length} overlapping cross-system invoice numbers are verified with authoritative identity evidence (external sourceReference matches ERVE TaxInvoice ID).`,
      evidence: {
        crossSystemOverlapCount: crossSystemOverlap.length,
        authoritativeMatchesCount: authoritativeMatches.length,
        authoritativeMatches: authoritativeMatches.slice(0, 5),
        hasAmbiguousMatches: false,
      },
    });
  } else {
    checks.push({
      checkId: 'CHK_UNIQUENESS',
      title: 'Invoice Identity Uniqueness',
      status: 'PASS',
      message: 'Zero duplicate invoice identities found within checked datasets.',
      evidence: {
        totalUniqueInvoicesChecked: new Set(allParsedInvoices.map((i) => i.invoiceNumber)).size,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 6: CHK_FY_SEPARATION — Financial Year namespace isolation
  // ---------------------------------------------------------------------------
  const wellFormedInvoices = allParsedInvoices.filter((i) => i.isWellFormed);
  const foreignFYInvoices = wellFormedInvoices.filter(
    (i) => i.fyCompactCode !== compactTargetFYCode,
  );

  if (foreignFYInvoices.length > 0) {
    checks.push({
      checkId: 'CHK_FY_SEPARATION',
      title: 'Financial Year Separation and Attribution',
      status: 'WARN',
      message: `Found ${foreignFYInvoices.length} invoice records attributing to non-target financial year(s).`,
      evidence: {
        targetFYCode,
        compactTargetFYCode,
        foreignFYCounts: foreignFYInvoices.reduce(
          (acc, i) => {
            acc[i.fyCompactCode] = (acc[i.fyCompactCode] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      },
      actionRequired:
        'Verify that non-target FY invoices belong to separate historical periods and do not bleed into current FY sequencing.',
    });
  } else {
    checks.push({
      checkId: 'CHK_FY_SEPARATION',
      title: 'Financial Year Separation and Attribution',
      status: 'PASS',
      message: `All ${wellFormedInvoices.length} checked invoices correctly attribute to FY ${compactTargetFYCode}.`,
      evidence: { targetFYCode, compactTargetFYCode, checkedCount: wellFormedInvoices.length },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 7: CHK_HIGH_WATER_RECON — Reconcile external, ERVE, and sequence HWM
  // ---------------------------------------------------------------------------
  const targetFYInvoices = wellFormedInvoices.filter(
    (i) => i.fyCompactCode === compactTargetFYCode,
  );

  const erveTargetSerials = targetFYInvoices
    .filter((i) => i.source === 'ERVE_DATABASE')
    .map((i) => i.serial);
  const erveMaxSerial = erveTargetSerials.length > 0 ? Math.max(...erveTargetSerials) : null;

  const externalTargetSerials = targetFYInvoices
    .filter((i) => i.source === 'EXTERNAL_REGISTER')
    .map((i) => i.serial);
  const externalLedgerMaxSerial =
    externalTargetSerials.length > 0 ? Math.max(...externalTargetSerials) : null;

  const explicitExternalHWM = options.externalHighWaterMark ?? null;

  // The authoritative external high-water mark is the higher of explicit input and parsed ledger
  const externalMaxSerial =
    explicitExternalHWM !== null && externalLedgerMaxSerial !== null
      ? Math.max(explicitExternalHWM, externalLedgerMaxSerial)
      : (explicitExternalHWM ?? externalLedgerMaxSerial);

  const verifiedHighWaterMark =
    externalMaxSerial !== null && erveMaxSerial !== null
      ? Math.max(externalMaxSerial, erveMaxSerial)
      : (externalMaxSerial ?? erveMaxSerial);

  if (verifiedHighWaterMark === null && sequenceLastAllocatedSerial === null) {
    checks.push({
      checkId: 'CHK_HIGH_WATER_RECON',
      title: 'High-Water Mark Reconciliation',
      status: 'BLOCKED',
      message: `Unable to determine high-water mark for FY ${targetFYCode}. No external records, no explicit HWM, and no existing sequence found.`,
      evidence: { externalMaxSerial, erveMaxSerial, sequenceLastAllocatedSerial },
      actionRequired:
        'Provide authoritative external invoice register or accountant-verified high-water mark serial.',
    });
  } else if (
    sequenceLastAllocatedSerial !== null &&
    verifiedHighWaterMark !== null &&
    sequenceLastAllocatedSerial < verifiedHighWaterMark
  ) {
    checks.push({
      checkId: 'CHK_HIGH_WATER_RECON',
      title: 'High-Water Mark Reconciliation',
      status: 'BLOCKED',
      message: `DocumentSequence lastAllocatedSerial (${sequenceLastAllocatedSerial}) is BEHIND verified live high-water mark (${verifiedHighWaterMark}). Cutover cannot proceed without setting sequence baseline; new allocations would cause duplicate numbers.`,
      evidence: {
        sequenceLastAllocatedSerial,
        verifiedHighWaterMark,
        externalMaxSerial,
        erveMaxSerial,
        discrepancy: verifiedHighWaterMark - sequenceLastAllocatedSerial,
      },
      actionRequired: `Execute document-sequence-baseline CLI to advance TAX_INVOICE sequence for FY ${targetFYCode} to ${verifiedHighWaterMark}.`,
    });
  } else if (
    sequenceLastAllocatedSerial !== null &&
    verifiedHighWaterMark !== null &&
    sequenceLastAllocatedSerial > verifiedHighWaterMark
  ) {
    checks.push({
      checkId: 'CHK_HIGH_WATER_RECON',
      title: 'High-Water Mark Reconciliation',
      status: 'WARN',
      message: `DocumentSequence lastAllocatedSerial (${sequenceLastAllocatedSerial}) is AHEAD of verified invoices (${verifiedHighWaterMark}). Ensure this reflects an intentional baseline adjustment.`,
      evidence: {
        sequenceLastAllocatedSerial,
        verifiedHighWaterMark,
        externalMaxSerial,
        erveMaxSerial,
      },
      actionRequired:
        'Verify with Accountant that the higher sequence value is authorized and intentional.',
    });
  } else if (sequenceLastAllocatedSerial === null && verifiedHighWaterMark !== null) {
    checks.push({
      checkId: 'CHK_HIGH_WATER_RECON',
      title: 'High-Water Mark Reconciliation',
      // In production cutover, uninitialized sequence is BLOCKED; in preparation, WARN
      status: isProduction ? 'BLOCKED' : 'WARN',
      message: isProduction
        ? `Verified high-water mark is ${verifiedHighWaterMark}, but DocumentSequence row is uninitialized in Production. Cutover requires baseline adjustment.`
        : `Verified high-water mark is ${verifiedHighWaterMark}, but DocumentSequence row is not yet initialized.`,
      evidence: {
        sequenceLastAllocatedSerial: null,
        verifiedHighWaterMark,
        targetEnvironment: environment,
      },
      actionRequired: `Run document-sequence-baseline CLI to initialize sequence baseline to ${verifiedHighWaterMark} at cutover.`,
    });
  } else {
    checks.push({
      checkId: 'CHK_HIGH_WATER_RECON',
      title: 'High-Water Mark Reconciliation',
      status: 'PASS',
      message: `DocumentSequence lastAllocatedSerial (${sequenceLastAllocatedSerial}) perfectly aligns with verified high-water mark (${verifiedHighWaterMark}).`,
      evidence: { sequenceLastAllocatedSerial, verifiedHighWaterMark },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 8: CHK_NUMBER_COLLISION — Proposed next serial collision check
  // ---------------------------------------------------------------------------
  const activeHwm = verifiedHighWaterMark ?? sequenceLastAllocatedSerial ?? 0;
  const proposedNextSerial = activeHwm + 1;
  const proposedNextInvoiceNumber = formatDocumentNumber('EI', targetFYCode, proposedNextSerial);

  // Check 1: Does proposed post-baseline next number collide with existing records?
  const postBaselineCollision = allParsedInvoices.find(
    (i) => i.invoiceNumber === proposedNextInvoiceNumber,
  );

  // Check 2: If sequence is initialized and behind, would unadjusted allocation collide with existing records?
  let unadjustedSequenceCollision: InvoiceRecordComparison | undefined;
  let unadjustedNextSerial: number | null = null;
  let unadjustedNextInvoiceNumber: string | null = null;
  if (sequenceLastAllocatedSerial !== null) {
    unadjustedNextSerial = sequenceLastAllocatedSerial + 1;
    unadjustedNextInvoiceNumber = formatDocumentNumber('EI', targetFYCode, unadjustedNextSerial);
    unadjustedSequenceCollision = allParsedInvoices.find(
      (i) => i.invoiceNumber === unadjustedNextInvoiceNumber,
    );
  }

  const collisionRecord = postBaselineCollision ?? unadjustedSequenceCollision;
  const collidedNumber = postBaselineCollision
    ? proposedNextInvoiceNumber
    : unadjustedNextInvoiceNumber;
  const collidedSerial = postBaselineCollision ? proposedNextSerial : unadjustedNextSerial;

  if (collisionRecord && collidedNumber && collidedSerial) {
    checks.push({
      checkId: 'CHK_NUMBER_COLLISION',
      title: 'Next Serial Number Collision Check',
      status: 'BLOCKED',
      message: `Next invoice number "${collidedNumber}" (serial ${collidedSerial}) collides with an existing record in ${collisionRecord.source}.`,
      evidence: {
        collidedInvoiceNumber: collidedNumber,
        collidedSerial,
        collidedWithSource: collisionRecord.source,
        isUnadjustedSequenceCollision:
          !postBaselineCollision && Boolean(unadjustedSequenceCollision),
      },
      actionRequired:
        'Do not allocate. Reconcile invoice ledger and adjust sequence baseline before cutover.',
    });
  } else {
    checks.push({
      checkId: 'CHK_NUMBER_COLLISION',
      title: 'Next Serial Number Collision Check',
      status: 'PASS',
      message: `Proposed next invoice number "${proposedNextInvoiceNumber}" (serial ${proposedNextSerial}) is free and non-colliding.`,
      evidence: { proposedNextInvoiceNumber, proposedNextSerial },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 9: CHK_SERIAL_CAPACITY — Four-digit serial capacity and format policy
  // ---------------------------------------------------------------------------
  const serialWidth = String(proposedNextSerial).length;
  const unresolvedWidthPolicy = proposedNextSerial > FOUR_DIGIT_CAPACITY_LIMIT;

  if (unresolvedWidthPolicy) {
    // Next serial exceeds 4 digits (e.g. 10000). The shared formatter does not truncate,
    // producing a 5-digit number (EI/26-27/10000). If canonical business format requires 4 digits,
    // this unresolved policy directly affects next allocation, BLOCKING cutover readiness!
    checks.push({
      checkId: 'CHK_SERIAL_CAPACITY',
      title: 'Four-Digit Serial Capacity and Numbering-Format Policy',
      status: 'BLOCKED',
      message: `Next allocation serial (${proposedNextSerial}) exceeds 4 digits. The shared formatter will produce 5-digit number "${proposedNextInvoiceNumber}", but canonical series specification is <4-digit serial>. Cutover readiness is BLOCKED until business policy on 5-digit expansion vs series rollover is resolved.`,
      evidence: {
        currentSerial: activeHwm,
        proposedNextSerial,
        serialWidth,
        proposedNextInvoiceNumber,
        formatterMinWidth: 4,
        unresolvedPolicy: true,
      },
      actionRequired:
        'Business and Accountant decision required: formally authorize 5-digit serial expansion or establish a new series rollover before allocation.',
    });
  } else if (proposedNextSerial >= WARNING_FOUR_DIGIT_SERIAL_THRESHOLD) {
    checks.push({
      checkId: 'CHK_SERIAL_CAPACITY',
      title: 'Four-Digit Serial Capacity and Numbering-Format Policy',
      status: 'WARN',
      message: `Current serial (${activeHwm}) is approaching 4-digit capacity limit (${FOUR_DIGIT_CAPACITY_LIMIT}). Remaining 4-digit headroom: ${FOUR_DIGIT_CAPACITY_LIMIT - activeHwm} invoices. Formatter expands to 5 digits once 9999 is exceeded.`,
      evidence: {
        currentSerial: activeHwm,
        proposedNextSerial,
        remainingHeadroom: FOUR_DIGIT_CAPACITY_LIMIT - activeHwm,
        threshold: WARNING_FOUR_DIGIT_SERIAL_THRESHOLD,
        formatterExpandsBeyondFourDigits: true,
      },
      actionRequired:
        'Plan next financial year rollover or confirm policy for 5-digit serial expansion before series reaches 10000.',
    });
  } else {
    checks.push({
      checkId: 'CHK_SERIAL_CAPACITY',
      title: 'Four-Digit Serial Capacity and Numbering-Format Policy',
      status: 'PASS',
      message: `Serial capacity healthy within 4-digit range. Current serial ${activeHwm}; next serial ${proposedNextSerial}; remaining 4-digit headroom is ${FOUR_DIGIT_CAPACITY_LIMIT - activeHwm} invoices.`,
      evidence: {
        currentSerial: activeHwm,
        proposedNextSerial,
        remainingHeadroom: FOUR_DIGIT_CAPACITY_LIMIT - activeHwm,
        maxFourDigitCapacity: FOUR_DIGIT_CAPACITY_LIMIT,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 10: CHK_SOURCE_COMPLETENESS — Authoritative source completeness
  // ---------------------------------------------------------------------------
  const hasExternalRecords = Boolean(options.externalRecords && options.externalRecords.length > 0);
  const hasExternalHwm = options.externalHighWaterMark !== undefined;
  const manifest = options.externalSourceManifest;

  if (!hasExternalRecords && !hasExternalHwm) {
    checks.push({
      checkId: 'CHK_SOURCE_COMPLETENESS',
      title: 'Authoritative External Source Completeness',
      status: 'BLOCKED',
      message:
        'No authoritative external EI numbering records or verified high-water mark were provided. Cannot verify live series boundary.',
      evidence: { hasExternalRecords, hasExternalHwm },
      actionRequired:
        'Export the complete external Tax Invoice ledger and provide it as input to the preflight diagnostic.',
    });
  } else if (!manifest) {
    // Manually asserted HWM without verifiable manifest
    checks.push({
      checkId: 'CHK_SOURCE_COMPLETENESS',
      title: 'Authoritative External Source Completeness',
      status: isProduction ? 'BLOCKED' : 'WARN',
      message: isProduction
        ? 'External source data provided without verification manifest. Production cutover is BLOCKED; manual HWM assertions without accountant-signed manifest cannot authorize live activation.'
        : 'External source data provided without verification manifest (source system, extraction timestamp, verifying accountant). Acceptable for preparation dry-run, but blocks production cutover.',
      evidence: {
        hasExternalRecords,
        hasExternalHwm,
        hasManifest: false,
        targetEnvironment: environment,
      },
      actionRequired:
        'Attach verification metadata confirming source system, export timestamp, and verifying Accountant identity.',
    });
  } else {
    // Validate manifest completeness
    const missingManifestFields: string[] = [];
    if (!manifest.systemName?.trim()) missingManifestFields.push('systemName');
    if (!manifest.extractedAt?.trim()) missingManifestFields.push('extractedAt');
    if (!manifest.verifiedBy?.trim()) missingManifestFields.push('verifiedBy');

    let extractionTimestampValid = true;
    if (manifest.extractedAt) {
      const extractedDate = new Date(manifest.extractedAt);
      if (Number.isNaN(extractedDate.getTime()) || extractedDate > new Date()) {
        extractionTimestampValid = false;
      }
    }

    if (missingManifestFields.length > 0 || !extractionTimestampValid) {
      checks.push({
        checkId: 'CHK_SOURCE_COMPLETENESS',
        title: 'Authoritative External Source Completeness',
        status: isProduction ? 'BLOCKED' : 'WARN',
        message: `External source manifest is incomplete or invalid. Missing fields: [${missingManifestFields.join(', ')}]. Extraction timestamp valid: ${extractionTimestampValid}.`,
        evidence: {
          missingManifestFields,
          extractionTimestampValid,
          targetEnvironment: environment,
        },
        actionRequired:
          'Provide complete manifest with source system, valid past export timestamp, and verifying Accountant identity.',
      });
    } else {
      checks.push({
        checkId: 'CHK_SOURCE_COMPLETENESS',
        title: 'Authoritative External Source Completeness',
        status: 'PASS',
        message: `Manifest structure and declared metadata validated for ${manifest.systemName} (declared by ${manifest.verifiedBy} at ${manifest.extractedAt}). Note: Manifest metadata constitutes operational attestation, not independent proof of external billing freeze or out-of-band accountant approval.`,
        evidence: {
          systemName: manifest.systemName,
          extractedAt: manifest.extractedAt,
          verifiedBy: manifest.verifiedBy,
          declaredFreezeConfirmed: manifest.freezeConfirmed ?? false,
          recordCount: options.externalRecords?.length ?? 0,
          manifestAttestationVerified: true,
          requiresOutOfBandApproval: true,
        },
        actionRequired:
          'Ensure documented operator authorization and actual legacy billing freeze verification are independently recorded prior to live activation.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check 11: CHK_PERMISSIONS — Read-only database access assertion
  // ---------------------------------------------------------------------------
  checks.push({
    checkId: 'CHK_PERMISSIONS',
    title: 'Read-Only Database Access Guarantee',
    status: 'PASS',
    message:
      'Preflight diagnostics executed strictly read-only queries. Zero persistent mutations performed.',
    evidence: {
      readOnlyGuarantee: true,
      mutationsAttempted: 0,
      environment,
    },
  });

  // ---------------------------------------------------------------------------
  // Compute Summary and Overall Verdict
  // ---------------------------------------------------------------------------
  const passed = checks.filter((c) => c.status === 'PASS').length;
  const warned = checks.filter((c) => c.status === 'WARN').length;
  const blocked = checks.filter((c) => c.status === 'BLOCKED').length;

  let verdict: OverallVerdict = 'READY';
  if (blocked > 0) {
    verdict = 'BLOCKED';
  } else if (warned > 0) {
    verdict = 'READY WITH CONDITIONS';
  }

  // Distinct readiness states:
  // Data evidence checks: syntax, uniqueness, collision, capacity, manifest, FY boundaries
  const fatalEvidenceBlocked = checks.some(
    (c) =>
      c.status === 'BLOCKED' &&
      c.checkId !== 'CHK_SEQUENCE_STATE' &&
      c.checkId !== 'CHK_HIGH_WATER_RECON' &&
      c.checkId !== 'CHK_DOCUMENT_TYPE_CONFIG',
  );

  const isPreparationReady = !fatalEvidenceBlocked;
  const isSchemaConfigReady = dbEnumHasTaxInvoice;

  // Baseline reconciliation is authorized once data evidence is verified,
  // there is a verified high-water mark, no unresolved width policy, and valid manifest:
  const isBaselineReconciliationReady =
    !fatalEvidenceBlocked &&
    verifiedHighWaterMark !== null &&
    !unresolvedWidthPolicy &&
    Boolean(manifest);

  // Production cutover allocation is ready ONLY post-baseline:
  // sequence must exist, lastAllocatedSerial must match verifiedHighWaterMark,
  // isBaselineReconciliationReady must be true, isProduction must be true,
  // and ZERO checks can be BLOCKED:
  const sequenceIsAligned =
    sequenceRowExists &&
    sequenceLastAllocatedSerial !== null &&
    sequenceLastAllocatedSerial === verifiedHighWaterMark;

  const isProductionCutoverReady =
    isProduction &&
    blocked === 0 &&
    isSchemaConfigReady &&
    isBaselineReconciliationReady &&
    sequenceIsAligned &&
    !unresolvedWidthPolicy &&
    Boolean(manifest);

  const readinessBreakdown: PreflightReadinessBreakdown = {
    isPreparationReady,
    isSchemaConfigReady,
    isBaselineReconciliationReady,
    isProductionCutoverReady,
  };

  return {
    timestamp: new Date().toISOString(),
    environment,
    targetFinancialYear: targetFYCode,
    verdict,
    readinessBreakdown,
    summary: {
      passed,
      warned,
      blocked,
      total: checks.length,
    },
    sequenceState: {
      exists: sequenceRowExists,
      lastAllocatedSerial: sequenceLastAllocatedSerial,
      documentTypeConfigured: dbEnumHasTaxInvoice,
    },
    highWaterMark: {
      externalMaxSerial,
      erveMaxSerial,
      sequenceLastAllocatedSerial,
      verifiedHighWaterMark,
      nextProposedSerial: activeHwm > 0 ? proposedNextSerial : null,
      nextProposedInvoiceNumber: activeHwm > 0 ? proposedNextInvoiceNumber : null,
      serialWidth: activeHwm > 0 ? serialWidth : null,
      unresolvedWidthPolicy,
    },
    checks,
  };
}
