/**
 * EI Numbering Preflight Types and Diagnostic Contracts.
 * Story: INV-012 — EI Numbering Cutover Preparation.
 */

export type CheckStatus = 'PASS' | 'WARN' | 'BLOCKED';

export type OverallVerdict = 'READY' | 'READY WITH CONDITIONS' | 'BLOCKED';

export type TargetEnvironment = 'LOCAL' | 'DEV' | 'STAGING' | 'PRODUCTION' | 'TEST';

export interface AuthoritativeExternalRecord {
  /** Invoice number, e.g. "EI/26-27/0042" or "EI/26-27/10000" */
  invoiceNumber: string;
  /** ISO date or calendar date string */
  invoiceDate?: string;
  /** Status in external ledger: ISSUED, CANCELLED, or VOID. All count toward HWM. */
  status?: 'ISSUED' | 'CANCELLED' | 'VOID';
  /** External identifier or voucher number */
  sourceReference?: string;
}

export interface ExternalSourceManifest {
  /** Name of source accounting system (e.g., "Tally Prime ERP", "Physical Register Book 2") */
  systemName: string;
  /** ISO timestamp when the source data was extracted */
  extractedAt: string;
  /** Name or email of the verifying Accountant */
  verifiedBy: string;
  /** Whether the billing freeze on the external system was verified active */
  freezeConfirmed?: boolean;
  /** Additional audit commentary or filing reference */
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
  serialWidth: number | null;
  unresolvedWidthPolicy: boolean;
}

export interface PreflightReadinessBreakdown {
  /** Whether bounded preparation deliverables (INV-012) are verified */
  isPreparationReady: boolean;
  /** Whether database schema and enum prerequisites (INV-006) are deployed */
  isSchemaConfigReady: boolean;
  /** Whether prerequisite data evidence is verified, authorizing sequence baseline reconciliation */
  isBaselineReconciliationReady: boolean;
  /** Whether production live cutover sequence is aligned and ready for active invoice allocation */
  isProductionCutoverReady: boolean;
}

export interface PreflightReport {
  timestamp: string;
  environment: TargetEnvironment;
  targetFinancialYear: string;
  verdict: OverallVerdict;
  readinessBreakdown: PreflightReadinessBreakdown;
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
