/**
 * EI Numbering Preflight Types and Diagnostic Contracts.
 * Story: INV-012 — EI Numbering Cutover Preparation.
 */

export type CheckStatus = 'PASS' | 'WARN' | 'BLOCKED';

export type OverallVerdict = 'READY' | 'READY WITH CONDITIONS' | 'BLOCKED';

export type TargetEnvironment = 'LOCAL' | 'DEV' | 'STAGING' | 'PRODUCTION' | 'TEST';

export interface AuthoritativeExternalRecord {
  /** Canonical invoice number, e.g. "EI/26-27/0042" */
  invoiceNumber: string;
  /** ISO date or calendar date string */
  invoiceDate?: string;
  /** Status in external ledger: ISSUED, CANCELLED, or VOID. All count toward HWM. */
  status?: 'ISSUED' | 'CANCELLED' | 'VOID';
  /** External identifier or voucher number */
  sourceReference?: string;
}

export interface ExternalSourceManifest {
  /** Name of source accounting system (e.g., "Tally Prime", "Physical Register") */
  systemName: string;
  /** ISO timestamp when the source data was extracted */
  extractedAt: string;
  /** Name/email of the verifying Accountant */
  verifiedBy: string;
  /** Notes or commentary from verification */
  notes?: string;
}

export interface PreflightOptions {
  /** Target Financial Year code, e.g. "2026-27" */
  targetFinancialYearCode: string;
  /** Explicit high-water mark serial number, verified by accountant */
  externalHighWaterMark?: number;
  /** Authoritative records exported from legacy/external register */
  externalRecords?: AuthoritativeExternalRecord[];
  /** Verification metadata for external source */
  externalSourceManifest?: ExternalSourceManifest;
  /** Execution environment marker */
  environment?: TargetEnvironment;
}

export interface PreflightCheckResult {
  checkId: string;
  title: string;
  status: CheckStatus;
  message: string;
  evidence: Record<string, unknown>;
  actionRequired?: string;
}

export interface PreflightSequenceState {
  exists: boolean;
  lastAllocatedSerial: number | null;
  documentTypeConfigured: boolean;
}

export interface PreflightHighWaterMarkSummary {
  externalMaxSerial: number | null;
  erveMaxSerial: number | null;
  sequenceLastAllocatedSerial: number | null;
  verifiedHighWaterMark: number | null;
  nextProposedSerial: number | null;
  nextProposedInvoiceNumber: string | null;
}

export interface PreflightReport {
  timestamp: string;
  environment: TargetEnvironment;
  targetFinancialYear: string;
  verdict: OverallVerdict;
  summary: {
    passed: number;
    warned: number;
    blocked: number;
    total: number;
  };
  sequenceState: PreflightSequenceState;
  highWaterMark: PreflightHighWaterMarkSummary;
  checks: PreflightCheckResult[];
}
