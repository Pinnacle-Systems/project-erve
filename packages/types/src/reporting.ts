import type { QualityRuntimeStatus } from './operations.js';

// ---------------------------------------------------------------------------
// Record Origin (RPT0 2.2)
// ---------------------------------------------------------------------------

/** The persisted origin of a Job Order (and other historical-import-eligible records). */
export type RecordOrigin = 'LIVE_WORKFLOW' | 'HISTORICAL_IMPORT';

/**
 * A reporting query's Record Origin filter. Adds `ALL` to the persisted
 * RecordOrigin values, meaning "no origin filter, include both." Every V1
 * reporting endpoint defaults to `LIVE_WORKFLOW` (RPT0 2.2): imported Job
 * Orders are PRODUCTION_COMPLETE with no prepared/QA/downstream rows, which
 * would otherwise distort current operational comparisons. Reports never
 * hide this split — see `filtersApplied`/origin breakdowns in the report
 * response shapes.
 */
export type ReportRecordOriginFilter = RecordOrigin | 'ALL';

export const DEFAULT_REPORT_RECORD_ORIGIN: ReportRecordOriginFilter = 'LIVE_WORKFLOW';

// ---------------------------------------------------------------------------
// Shared filter dimensions (RPT0 4.1)
// ---------------------------------------------------------------------------

export type ReportPurchaseMode = 'OUTRIGHT' | 'SALE_RETURN';

/**
 * Reusable reporting filter dimensions. No endpoint is required to support
 * every field — each report documents its own supported subset (RPT0 4.1).
 */
export interface ReportFilters {
  financialYearId?: string;
  fromDate?: string;
  toDate?: string;
  seasonId?: string;
  factoryId?: string;
  distributorId?: string;
  styleId?: string;
  purchaseMode?: ReportPurchaseMode;
  recordOrigin?: ReportRecordOriginFilter;
  status?: string[];
}

// ---------------------------------------------------------------------------
// QA work status (RPT0 2.4 / QW1) — reuses the existing QualityRuntimeStatus
// union rather than inventing a parallel one, and never synthesizes a
// "QA Pending" bucket.
// ---------------------------------------------------------------------------

export interface QaWorkStatusBreakdown {
  byStatus: Record<QualityRuntimeStatus, number>;
  reconciliationConflict: number;
}

// ---------------------------------------------------------------------------
// Reporting section omission (RPT0 4.6 / RPT1 6.13)
// ---------------------------------------------------------------------------

/**
 * The source domains a V1 reporting aggregate can read from. A viewer who
 * cannot see a given section's underlying domain never receives that key —
 * the API omits it and lists it in `sectionsOmitted` instead of returning a
 * zero or an empty placeholder. Mirrors the `ReportSection` role gate in
 * `@erve/shared`'s rbac.ts (the source of truth for which roles satisfy
 * each section); duplicated here only as a plain string-literal union so
 * `packages/types` does not need to depend on `@erve/shared`.
 */
export type ReportSection =
  | 'production'
  | 'qa'
  | 'packingPending'
  | 'packingAudit'
  | 'delivery'
  | 'saleReturn'
  | 'factoryInvoice';
