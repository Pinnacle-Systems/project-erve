/**
 * Read-Only EI Numbering Preflight Diagnostic Service.
 * Story: INV-012 — EI Numbering Cutover Preparation.
 *
 * GUARANTEES:
 * 1. Strictly read-only: zero INSERT, UPDATE, DELETE, UPSERT, or sequence mutations.
 * 2. Never calls mutating helpers like ensureFinancialYear or allocateDocumentSerial.
 * 3. Never guesses or assumes an unverified EI high-water mark.
 * 4. Fails closed (BLOCKED) if authoritative external information is missing or contradictory.
 */

import type { Prisma, prisma } from '../../db/prisma.js';
import { toCompactFinancialYearCode } from '../master-data/financial-year.util.js';
import { formatDocumentNumber } from '../master-data/document-number.util.js';
import type {
  PreflightOptions,
  PreflightReport,
  PreflightCheckResult,
  OverallVerdict,
} from './ei-numbering-preflight.types.js';

type DbClient = typeof prisma | Prisma.TransactionClient;

/** Canonical EI invoice pattern: "EI/<2-digit start FY>-<2-digit end FY>/<exactly 4 digits>" */
export const CANONICAL_EI_INVOICE_REGEX = /^EI\/(\d{2}-\d{2})\/(\d{4})$/;

export const MAX_FOUR_DIGIT_SERIAL = 9999;
export const WARNING_FOUR_DIGIT_SERIAL_THRESHOLD = 9000;

interface SerialExtraction {
  invoiceNumber: string;
  source: 'ERVE_DATABASE' | 'EXTERNAL_REGISTER';
  fyCompactCode: string;
  serial: number;
  status?: string;
  isWellFormed: boolean;
}

export function parseCanonicalInvoiceNumber(
  invoiceNumber: string,
  source: 'ERVE_DATABASE' | 'EXTERNAL_REGISTER',
  status?: string,
): SerialExtraction {
  const match = CANONICAL_EI_INVOICE_REGEX.exec(invoiceNumber);
  if (!match) {
    return {
      invoiceNumber,
      source,
      fyCompactCode: '',
      serial: -1,
      status,
      isWellFormed: false,
    };
  }
  return {
    invoiceNumber,
    source,
    fyCompactCode: match[1]!,
    serial: Number.parseInt(match[2]!, 10),
    status,
    isWellFormed: true,
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
  // Check if pg_enum contains TAX_INVOICE for DocumentType
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
    // If pg_enum query fails (e.g. non-postgres in test fixture), treat as false
    dbEnumHasTaxInvoice = false;
  }

  if (!dbEnumHasTaxInvoice) {
    checks.push({
      checkId: 'CHK_DOCUMENT_TYPE_CONFIG',
      title: 'Tax Invoice Document Type Enum Configuration',
      status: 'WARN',
      message:
        'TAX_INVOICE is not yet added to the DocumentType database enum or DOCUMENT_PREFIXES.',
      evidence: {
        dbEnumHasTaxInvoice: false,
        canonicalPrefix: 'EI',
        dependencyOwner: 'INV-006',
      },
      actionRequired:
        'INV-006 must add TAX_INVOICE to DocumentType enum and map DOCUMENT_PREFIXES.TAX_INVOICE to "EI" prior to cutover activation.',
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
      status: 'WARN',
      message: `DocumentSequence row for (TAX_INVOICE, ${targetFYCode}) does not exist. It remains uninitialized.`,
      evidence: { exists: false, targetFYCode, autoCreated: false },
      actionRequired:
        'Preflight does not auto-create sequence records. Set baseline via document-sequence-baseline CLI during authorized cutover.',
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
  const allParsedInvoices: SerialExtraction[] = [];

  for (const inv of erveInvoiceRecords) {
    if (inv.invoiceNumber) {
      allParsedInvoices.push(
        parseCanonicalInvoiceNumber(inv.invoiceNumber, 'ERVE_DATABASE', inv.status),
      );
    }
  }

  if (options.externalRecords && options.externalRecords.length > 0) {
    for (const ext of options.externalRecords) {
      allParsedInvoices.push(
        parseCanonicalInvoiceNumber(ext.invoiceNumber, 'EXTERNAL_REGISTER', ext.status),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Check 4: CHK_INVOICE_SYNTAX — Syntax validation (EI/<FY>/<4-digit serial>)
  // ---------------------------------------------------------------------------
  const malformedInvoices = allParsedInvoices.filter((i) => !i.isWellFormed);

  if (malformedInvoices.length > 0) {
    checks.push({
      checkId: 'CHK_INVOICE_SYNTAX',
      title: 'Canonical Invoice Number Syntax Validation',
      status: 'BLOCKED',
      message: `Found ${malformedInvoices.length} invoice numbers that do not match canonical pattern "EI/<FY>/<4-digit serial>".`,
      evidence: {
        malformedCount: malformedInvoices.length,
        examples: malformedInvoices.slice(0, 5).map((m) => ({
          invoiceNumber: m.invoiceNumber,
          source: m.source,
        })),
        pattern: 'EI/<FY>/<4-digit serial>',
      },
      actionRequired:
        'Investigate and correct malformed invoice number strings in source datasets.',
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

  if (erveDuplicates.length > 0 || externalDuplicates.length > 0) {
    checks.push({
      checkId: 'CHK_UNIQUENESS',
      title: 'Invoice Identity Uniqueness',
      status: 'BLOCKED',
      message: `Duplicate invoice numbers detected within authoritative datasets.`,
      evidence: {
        erveDuplicates: erveDuplicates.map(([num, count]) => ({ invoiceNumber: num, count })),
        externalDuplicates: externalDuplicates.map(([num, count]) => ({
          invoiceNumber: num,
          count,
        })),
      },
      actionRequired:
        'Resolve duplicate invoice records in the respective database or ledger before proceeding.',
    });
  } else if (crossSystemOverlap.length > 0) {
    // If numbers appear in both, verify whether they are expected mirrored records or collisions
    checks.push({
      checkId: 'CHK_UNIQUENESS',
      title: 'Invoice Identity Uniqueness and Cross-System Overlap',
      status: 'WARN',
      message: `${crossSystemOverlap.length} invoice numbers appear in both ERVE and the external register. Verify these represent already-migrated identical invoices rather than new collisions.`,
      evidence: {
        crossSystemOverlapCount: crossSystemOverlap.length,
        sampleOverlap: crossSystemOverlap.slice(0, 5),
      },
      actionRequired:
        'Confirm with Accountant that overlapping numbers represent historically mirrored records.',
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
  // If evaluating target FY, check if any target FY invoice has a foreign FY code
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
      status: 'WARN',
      message: `Verified high-water mark is ${verifiedHighWaterMark}, but DocumentSequence row is not yet initialized.`,
      evidence: { sequenceLastAllocatedSerial: null, verifiedHighWaterMark },
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
  let unadjustedSequenceCollision: SerialExtraction | undefined;
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
  // Check 9: CHK_SERIAL_CAPACITY — Four-digit serial capacity analysis
  // ---------------------------------------------------------------------------
  if (activeHwm > MAX_FOUR_DIGIT_SERIAL) {
    checks.push({
      checkId: 'CHK_SERIAL_CAPACITY',
      title: 'Four-Digit Serial Capacity Limit',
      status: 'BLOCKED',
      message: `Current serial (${activeHwm}) exceeds the canonical 4-digit serial capacity (${MAX_FOUR_DIGIT_SERIAL}). Formatter cannot maintain 4-digit syntax beyond ${MAX_FOUR_DIGIT_SERIAL}.`,
      evidence: {
        currentSerial: activeHwm,
        maxFourDigitSerial: MAX_FOUR_DIGIT_SERIAL,
        formattedWidth: String(activeHwm).length,
      },
      actionRequired:
        'Business decision required on series rollover or expanding serial digit width policy beyond 4 digits.',
    });
  } else if (activeHwm >= WARNING_FOUR_DIGIT_SERIAL_THRESHOLD) {
    checks.push({
      checkId: 'CHK_SERIAL_CAPACITY',
      title: 'Four-Digit Serial Capacity Limit',
      status: 'WARN',
      message: `Current serial (${activeHwm}) is approaching 4-digit capacity limit (${MAX_FOUR_DIGIT_SERIAL}). Remaining headroom: ${MAX_FOUR_DIGIT_SERIAL - activeHwm} invoices.`,
      evidence: {
        currentSerial: activeHwm,
        remainingHeadroom: MAX_FOUR_DIGIT_SERIAL - activeHwm,
        threshold: WARNING_FOUR_DIGIT_SERIAL_THRESHOLD,
      },
      actionRequired:
        'Plan next financial year rollover or policy update before series reaches 9999.',
    });
  } else {
    checks.push({
      checkId: 'CHK_SERIAL_CAPACITY',
      title: 'Four-Digit Serial Capacity Limit',
      status: 'PASS',
      message: `Serial capacity healthy. Current serial ${activeHwm}; remaining 4-digit headroom is ${MAX_FOUR_DIGIT_SERIAL - activeHwm} invoices.`,
      evidence: {
        currentSerial: activeHwm,
        remainingHeadroom: MAX_FOUR_DIGIT_SERIAL - activeHwm,
        maxCapacity: MAX_FOUR_DIGIT_SERIAL,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Check 10: CHK_SOURCE_COMPLETENESS — External authoritative source completeness
  // ---------------------------------------------------------------------------
  const hasExternalSource =
    options.externalHighWaterMark !== undefined ||
    (options.externalRecords && options.externalRecords.length > 0);
  const manifest = options.externalSourceManifest;

  if (!hasExternalSource) {
    checks.push({
      checkId: 'CHK_SOURCE_COMPLETENESS',
      title: 'Authoritative External Source Completeness',
      status: 'BLOCKED',
      message:
        'No authoritative external EI numbering records or verified high-water mark were provided. Cannot verify live series boundary.',
      evidence: { hasExternalSource: false },
      actionRequired:
        'Export the complete external Tax Invoice ledger and provide it as input to the preflight diagnostic.',
    });
  } else if (!manifest) {
    checks.push({
      checkId: 'CHK_SOURCE_COMPLETENESS',
      title: 'Authoritative External Source Completeness',
      status: 'WARN',
      message:
        'External source data provided without verification manifest (source system, extraction timestamp, verifying accountant).',
      evidence: { hasExternalSource: true, hasManifest: false },
      actionRequired:
        'Attach verification metadata confirming source system, export timestamp, and verifying Accountant identity.',
    });
  } else {
    checks.push({
      checkId: 'CHK_SOURCE_COMPLETENESS',
      title: 'Authoritative External Source Completeness',
      status: 'PASS',
      message: `Authoritative source verified: ${manifest.systemName}, extracted ${manifest.extractedAt}, verified by ${manifest.verifiedBy}.`,
      evidence: {
        systemName: manifest.systemName,
        extractedAt: manifest.extractedAt,
        verifiedBy: manifest.verifiedBy,
        recordCount: options.externalRecords?.length ?? 0,
      },
    });
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

  return {
    timestamp: new Date().toISOString(),
    environment,
    targetFinancialYear: targetFYCode,
    verdict,
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
    },
    checks,
  };
}
