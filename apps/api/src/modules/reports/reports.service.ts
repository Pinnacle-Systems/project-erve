import { canViewReportSection, canViewReports, type ReportSection } from '@erve/shared';
import type {
  DistributorReturnReportRow,
  FactoryProductionWorkload,
  FactoryQuantityFlow,
  JobOrderPipelineBucket,
  ReportDistributorReturns,
  ReportFilters,
  ReportFulfillment,
  ReportOperationsSummary,
  ReportProduction,
  ReportSaleOrReturn,
  SaleOrReturnReportRow,
} from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import {
  buildDelayedJobOrderWhere,
  OPEN_PRODUCTION_STATUSES,
} from '../job-orders/job-order-operational-state.js';
import { toBusinessCalendarDate } from '../master-data/financial-year.util.js';
import { computeQualityWorkSummary } from '../job-orders/job-orders.service.js';
import { getPooledFactoryInventory } from '../job-orders/pooled-inventory.service.js';
import { getPhysicalPackedQuantitiesForLines } from '../fulfillment/packing-reconciliation.js';
import { listSaleOrReturnPositions } from '../fulfillment/distributor-sales-report.service.js';
import { computeAvailability } from '../fulfillment/sale-or-return-quantities.js';
import { listSeasonOptions } from '../master-data/master-data.service.js';

function requireReportAccess(user: CurrentUser): void {
  if (!canViewReports(user)) {
    throw HttpError.forbidden('You do not have permission to view reports');
  }
}

/** A JobOrder recordOrigin `where` fragment. `ALL`/undefined means no filter. */
function recordOriginWhere(recordOrigin?: string): 'LIVE_WORKFLOW' | 'HISTORICAL_IMPORT' | undefined {
  return recordOrigin === 'LIVE_WORKFLOW' || recordOrigin === 'HISTORICAL_IMPORT'
    ? recordOrigin
    : undefined;
}

// Every V1 reporting endpoint defaults Record Origin to LIVE_WORKFLOW (RPT0
// 2.2) unless the caller explicitly asks for HISTORICAL_IMPORT or ALL.
function resolveRecordOriginFilter(filters: ReportFilters): string {
  return filters.recordOrigin ?? 'LIVE_WORKFLOW';
}

function jobOrderScopeWhere(filters: ReportFilters): Prisma.JobOrderWhereInput {
  const recordOrigin = resolveRecordOriginFilter(filters);
  return {
    factoryId: filters.factoryId,
    recordOrigin: recordOriginWhere(recordOrigin),
    financialYearId: filters.financialYearId,
    lines: filters.seasonId ? { some: { style: { seasonId: filters.seasonId } } } : undefined,
  };
}

// ---------------------------------------------------------------------------
// RPT1 6.1 — Operations Summary
// ---------------------------------------------------------------------------

async function computeProductionSection(filters: ReportFilters) {
  const where = jobOrderScopeWhere(filters);
  const [openGroups, delayed] = await Promise.all([
    prisma.jobOrder.groupBy({
      by: ['status'],
      where: { ...where, status: { in: [...OPEN_PRODUCTION_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.jobOrder.count({
      where: { ...where, ...buildDelayedJobOrderWhere(toBusinessCalendarDate(new Date())) },
    }),
  ]);
  const openByStatus: Record<string, number> = {};
  let openTotal = 0;
  for (const group of openGroups) {
    openByStatus[group.status] = group._count._all;
    openTotal += group._count._all;
  }
  return { openByStatus, openTotal, delayed };
}

async function computeQaSection(filters: ReportFilters) {
  const recordOrigin = resolveRecordOriginFilter(filters);
  const [summary, pooled] = await Promise.all([
    computeQualityWorkSummary({ factoryId: filters.factoryId }),
    getPooledFactoryInventory(prisma, {
      factoryId: filters.factoryId,
      seasonId: filters.seasonId,
      recordOrigin: recordOriginWhere(recordOrigin),
    }),
  ]);
  const availableStockPieces = pooled.reduce((sum, row) => sum + row.availableQuantity, 0);
  return {
    workByStatus: summary.byStatus,
    reconciliationConflicts: summary.reconciliationConflict,
    availableStockPieces,
  };
}

async function computePiecesAwaitingPacking(factoryId?: string): Promise<number> {
  const lines = await prisma.saleOrderLine.findMany({
    where: factoryId ? { saleOrder: { factoryId } } : undefined,
    select: { id: true, quantity: true },
  });
  if (lines.length === 0) return 0;
  const packedByLine = await getPhysicalPackedQuantitiesForLines(prisma, lines.map((l) => l.id));
  return lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity - (packedByLine.get(line.id) ?? 0)),
    0,
  );
}

interface CartonAuditCounts {
  neverAudited: number;
  needingReinspection: number;
  currentlyPassed: number;
}

/**
 * Classifies every active (non-retired) carton of a DRAFT Factory Dispatch
 * by its current-audit state, mirroring finalizeFactoryDispatch's own
 * blocker classification (factory-dispatch.service.ts) exactly: a carton
 * with no audit at cartonVersion === carton.version is "needs
 * reinspection" if it has any audit history at all (a stale audit from
 * before the last material change), else "never audited"; otherwise it
 * currently has a passing audit.
 */
async function computeCartonAuditCounts(factoryId?: string): Promise<CartonAuditCounts> {
  const cartons = await prisma.factoryPackingCarton.findMany({
    where: {
      retiredAt: null,
      factoryDispatch: { status: 'DRAFT', factoryId },
    },
    select: { version: true, audits: { select: { cartonVersion: true } } },
  });
  let neverAudited = 0;
  let needingReinspection = 0;
  let currentlyPassed = 0;
  for (const carton of cartons) {
    const hasCurrentAudit = carton.audits.some((audit) => audit.cartonVersion === carton.version);
    if (hasCurrentAudit) currentlyPassed += 1;
    else if (carton.audits.length > 0) needingReinspection += 1;
    else neverAudited += 1;
  }
  return { neverAudited, needingReinspection, currentlyPassed };
}

async function computeDeliverySection(): Promise<{ awaitingConfirmation: number }> {
  const awaitingConfirmation = await prisma.erveDispatch.count({ where: { status: 'DISPATCHED' } });
  return { awaitingConfirmation };
}

async function computeSaleReturnSection(
  user: CurrentUser,
  filters: ReportFilters,
): Promise<{ remainingWithDistributors: number }> {
  const rows = await listSaleOrReturnPositions(user, { distributorId: filters.distributorId });
  const remainingWithDistributors = rows.reduce((sum, row) => sum + row.remainingWithDistributor, 0);
  return { remainingWithDistributors };
}

async function maybeSection<T>(
  user: CurrentUser,
  section: ReportSection,
  sectionsOmitted: string[],
  compute: () => Promise<T>,
): Promise<T | undefined> {
  if (!canViewReportSection(user, section)) {
    sectionsOmitted.push(section);
    return undefined;
  }
  return compute();
}

export async function getOperationsSummary(
  user: CurrentUser,
  filters: ReportFilters,
): Promise<ReportOperationsSummary> {
  requireReportAccess(user);
  const businessDate = toBusinessCalendarDate(new Date());
  const sectionsOmitted: string[] = [];

  const [production, qa, packing, delivery, saleReturn] = await Promise.all([
    maybeSection(user, 'production', sectionsOmitted, () => computeProductionSection(filters)),
    maybeSection(user, 'qa', sectionsOmitted, () => computeQaSection(filters)),
    (async () => {
      const canPending = canViewReportSection(user, 'packingPending');
      const canAudit = canViewReportSection(user, 'packingAudit');
      if (!canPending && !canAudit) {
        sectionsOmitted.push('packing');
        return undefined;
      }
      const [piecesAwaitingPacking, packingListsAwaitingCompletion, auditCounts] = await Promise.all([
        canPending ? computePiecesAwaitingPacking(filters.factoryId) : undefined,
        canPending
          ? prisma.factoryDispatch.count({ where: { status: 'DRAFT', factoryId: filters.factoryId } })
          : undefined,
        canAudit ? computeCartonAuditCounts(filters.factoryId) : undefined,
      ]);
      if (!canPending) sectionsOmitted.push('packing.pending');
      if (!canAudit) sectionsOmitted.push('packing.audit');
      return {
        piecesAwaitingPacking,
        packingListsAwaitingCompletion,
        cartonsNeverAudited: auditCounts?.neverAudited,
        cartonsNeedingReinspection: auditCounts?.needingReinspection,
      };
    })(),
    maybeSection(user, 'delivery', sectionsOmitted, () => computeDeliverySection()),
    maybeSection(user, 'saleReturn', sectionsOmitted, () => computeSaleReturnSection(user, filters)),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    businessDate: businessDate.toISOString().slice(0, 10),
    filtersApplied: filters,
    sectionsOmitted,
    production,
    qa,
    packing,
    delivery,
    saleReturn,
  };
}

// ---------------------------------------------------------------------------
// RPT1 6.8 — Production report (pipeline / factoryWorkload / quantityFlow)
// ---------------------------------------------------------------------------

async function getPipeline(filters: ReportFilters): Promise<JobOrderPipelineBucket[]> {
  const groups = await prisma.jobOrder.groupBy({
    by: ['status', 'recordOrigin'],
    where: jobOrderScopeWhere(filters),
    _count: { _all: true },
  });
  return groups.map((group) => ({
    status: group.status,
    recordOrigin: group.recordOrigin,
    count: group._count._all,
  }));
}

async function getFactoryWorkload(filters: ReportFilters): Promise<FactoryProductionWorkload[]> {
  const where = jobOrderScopeWhere(filters);
  const [openGroups, delayedGroups] = await Promise.all([
    prisma.jobOrder.groupBy({
      by: ['factoryId'],
      where: { ...where, status: { in: [...OPEN_PRODUCTION_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.jobOrder.groupBy({
      by: ['factoryId'],
      where: { ...where, ...buildDelayedJobOrderWhere(toBusinessCalendarDate(new Date())) },
      _count: { _all: true },
    }),
  ]);
  const openByFactory = new Map(openGroups.map((g) => [g.factoryId, g._count._all]));
  const delayedByFactory = new Map(delayedGroups.map((g) => [g.factoryId, g._count._all]));
  const factoryIds = [...new Set([...openByFactory.keys(), ...delayedByFactory.keys()])];
  if (factoryIds.length === 0) return [];
  const factories = await prisma.factory.findMany({
    where: { id: { in: factoryIds } },
    select: { id: true, code: true, name: true },
  });
  const factoriesById = new Map(factories.map((f) => [f.id, f]));
  return factoryIds.map((factoryId) => ({
    factory: factoriesById.get(factoryId) ?? { id: factoryId, code: '—', name: 'Unknown factory' },
    openJobOrders: openByFactory.get(factoryId) ?? 0,
    delayedJobOrders: delayedByFactory.get(factoryId) ?? 0,
  }));
}

interface FactoryOrderedPreparedRow {
  factory_id: string;
  cancelled: boolean;
  ordered: bigint | number | null;
  prepared: bigint | number | null;
}

async function getQuantityFlow(filters: ReportFilters): Promise<FactoryQuantityFlow[]> {
  const recordOrigin = resolveRecordOriginFilter(filters);
  const recordOriginFilter = recordOriginWhere(recordOrigin);

  // Ordered/Prepared/CancelledOrdered per Factory — job_order_lines is a
  // continually-growing table, so this is aggregated in Postgres (GROUP BY)
  // rather than fetched row-by-row into application memory (RPT1 6.15).
  const orderedPreparedRows = await prisma.$queryRaw<FactoryOrderedPreparedRow[]>(Prisma.sql`
    SELECT
      jo.factory_id AS factory_id,
      (jo.status = 'CANCELLED') AS cancelled,
      SUM(jols.ordered_quantity) AS ordered,
      SUM(jols.prepared_quantity) AS prepared
    FROM job_order_line_sizes jols
    INNER JOIN job_order_lines jol ON jol.id = jols.job_order_line_id
    INNER JOIN job_orders jo ON jo.id = jol.job_order_id
    WHERE
      (${filters.factoryId ?? null}::text IS NULL OR jo.factory_id = ${filters.factoryId ?? null})
      AND (${recordOriginFilter ?? null}::text IS NULL OR jo.record_origin = ${recordOriginFilter ?? null}::"RecordOrigin")
      AND (${filters.financialYearId ?? null}::text IS NULL OR jo.financial_year_id = ${filters.financialYearId ?? null})
      AND (
        ${filters.seasonId ?? null}::text IS NULL
        OR EXISTS (
          SELECT 1 FROM styles s WHERE s.id = jol.style_id AND s.season_id = ${filters.seasonId ?? null}
        )
      )
    GROUP BY jo.factory_id, cancelled
  `);

  // Factory Dispatched — non-retired FactoryPackingCartonLine quantities
  // where the owning Factory Dispatch is READY_FOR_ERVE (RPT1 6.8: never
  // FactoryDispatchLine.packedQuantity). Also a continually-growing table.
  const dispatchedRows = await prisma.$queryRaw<Array<{ factory_id: string; dispatched: bigint | number | null }>>(
    Prisma.sql`
      SELECT fd.factory_id AS factory_id, SUM(fpcl.quantity) AS dispatched
      FROM factory_packing_carton_lines fpcl
      INNER JOIN factory_packing_cartons fpc ON fpc.id = fpcl.carton_id
      INNER JOIN factory_dispatches fd ON fd.id = fpc.factory_dispatch_id
      WHERE
        fpc.retired_at IS NULL
        AND fd.status = 'READY_FOR_ERVE'
        AND (${filters.factoryId ?? null}::text IS NULL OR fd.factory_id = ${filters.factoryId ?? null})
      GROUP BY fd.factory_id
    `,
  );

  const pooled = await getPooledFactoryInventory(prisma, {
    factoryId: filters.factoryId,
    seasonId: filters.seasonId,
    recordOrigin: recordOriginFilter,
  });
  const qaPassedByFactory = new Map<string, number>();
  for (const row of pooled) {
    qaPassedByFactory.set(row.factoryId, (qaPassedByFactory.get(row.factoryId) ?? 0) + row.releasedQuantity);
  }

  const byFactory = new Map<
    string,
    { orderedPieces: number; cancelledOrderedPieces: number; preparedPieces: number }
  >();
  for (const row of orderedPreparedRows) {
    const entry = byFactory.get(row.factory_id) ?? {
      orderedPieces: 0,
      cancelledOrderedPieces: 0,
      preparedPieces: 0,
    };
    const ordered = Number(row.ordered ?? 0);
    const prepared = Number(row.prepared ?? 0);
    if (row.cancelled) {
      entry.cancelledOrderedPieces += ordered;
    } else {
      entry.orderedPieces += ordered;
      entry.preparedPieces += prepared;
    }
    byFactory.set(row.factory_id, entry);
  }
  const dispatchedByFactory = new Map(
    dispatchedRows.map((row) => [row.factory_id, Number(row.dispatched ?? 0)]),
  );

  const factoryIds = new Set([
    ...byFactory.keys(),
    ...dispatchedByFactory.keys(),
    ...qaPassedByFactory.keys(),
  ]);
  if (factoryIds.size === 0) return [];
  const factories = await prisma.factory.findMany({
    where: { id: { in: [...factoryIds] } },
    select: { id: true, code: true, name: true },
  });
  const factoriesById = new Map(factories.map((f) => [f.id, f]));

  return [...factoryIds].map((factoryId) => {
    const flow = byFactory.get(factoryId) ?? {
      orderedPieces: 0,
      cancelledOrderedPieces: 0,
      preparedPieces: 0,
    };
    return {
      factory: factoriesById.get(factoryId) ?? { id: factoryId, code: '—', name: 'Unknown factory' },
      orderedPieces: flow.orderedPieces,
      cancelledOrderedPieces: flow.cancelledOrderedPieces,
      preparedPieces: flow.preparedPieces,
      qaPassedPieces: qaPassedByFactory.get(factoryId) ?? 0,
      factoryDispatchedPieces: dispatchedByFactory.get(factoryId) ?? 0,
    };
  });
}

export async function getProductionReport(
  user: CurrentUser,
  filters: ReportFilters,
): Promise<ReportProduction> {
  requireReportAccess(user);
  if (!canViewReportSection(user, 'production')) {
    throw HttpError.forbidden('You do not have permission to view the production report');
  }
  const [pipeline, factoryWorkload, quantityFlow] = await Promise.all([
    getPipeline(filters),
    getFactoryWorkload(filters),
    getQuantityFlow(filters),
  ]);
  return { filtersApplied: filters, pipeline, factoryWorkload, quantityFlow };
}

// ---------------------------------------------------------------------------
// RPT1 6.9 — Fulfillment report (entity families kept separate)
// ---------------------------------------------------------------------------

export async function getFulfillmentReport(
  user: CurrentUser,
  filters: ReportFilters,
): Promise<ReportFulfillment> {
  requireReportAccess(user);

  const [
    dispatchGroups,
    auditCounts,
    invoiceGroups,
    packingListGroups,
    dispatchStatusGroups,
    deliveryGroups,
  ] = await Promise.all([
    canViewReportSection(user, 'packingPending')
      ? prisma.factoryDispatch.groupBy({
          by: ['status'],
          where: { factoryId: filters.factoryId },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    canViewReportSection(user, 'packingAudit')
      ? computeCartonAuditCounts(filters.factoryId)
      : Promise.resolve({ neverAudited: 0, needingReinspection: 0, currentlyPassed: 0 }),
    canViewReportSection(user, 'factoryInvoice')
      ? prisma.factoryInvoice.groupBy({
          by: ['status'],
          where: { factoryId: filters.factoryId },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    canViewReportSection(user, 'delivery')
      ? prisma.ervePackingList.groupBy({
          by: ['status'],
          where: { distributorId: filters.distributorId },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    canViewReportSection(user, 'delivery')
      ? prisma.erveDispatch.groupBy({
          by: ['status'],
          where: { distributorId: filters.distributorId },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    canViewReportSection(user, 'delivery')
      ? prisma.erveDispatch.groupBy({
          by: ['deliveryConfirmationSource'],
          where: { status: 'DELIVERED', distributorId: filters.distributorId },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const toCountRecord = (groups: Array<{ status: string; _count: { _all: number } }>) => {
    const record: Record<string, number> = {};
    for (const group of groups) record[group.status] = group._count._all;
    return record;
  };

  const delivery = { userConfirmed: 0, legacyAssumedFullReceipt: 0 };
  for (const group of deliveryGroups) {
    if (group.deliveryConfirmationSource === 'USER_CONFIRMED') delivery.userConfirmed = group._count._all;
    if (group.deliveryConfirmationSource === 'LEGACY_ASSUMED_FULL_RECEIPT')
      delivery.legacyAssumedFullReceipt = group._count._all;
  }

  return {
    filtersApplied: filters,
    factoryDispatch: toCountRecord(dispatchGroups),
    packingAudit: auditCounts,
    factoryInvoice: toCountRecord(invoiceGroups),
    ervePackingList: toCountRecord(packingListGroups),
    erveDispatch: toCountRecord(dispatchStatusGroups),
    delivery,
  };
}

// ---------------------------------------------------------------------------
// RPT1 6.10 — Sale-or-Return report (reuses computeAvailability)
// ---------------------------------------------------------------------------

export async function getSaleOrReturnReport(
  user: CurrentUser,
  filters: ReportFilters & { groupByStyle?: boolean },
): Promise<ReportSaleOrReturn> {
  requireReportAccess(user);
  if (!canViewReportSection(user, 'saleReturn')) {
    throw HttpError.forbidden('You do not have permission to view the sale-or-return report');
  }
  const positions = await listSaleOrReturnPositions(user, { distributorId: filters.distributorId });

  interface Accumulator {
    distributor: { id: string; code: string; name: string };
    style?: { id: string; styleNumber: string; styleName: string };
    receivedQuantity: number;
    actualSoldQuantity: number;
    returnedQuantity: number;
    approvedAwaitingReceiptQuantity: number;
    pendingRequestedQuantity: number;
  }
  const byKey = new Map<string, Accumulator>();
  for (const row of positions) {
    const key = filters.groupByStyle
      ? `${row.distributor.id}:${row.styleNumber}`
      : row.distributor.id;
    const existing = byKey.get(key);
    if (existing) {
      existing.receivedQuantity += row.receivedQuantity;
      existing.actualSoldQuantity += row.actualSoldQuantity;
      existing.returnedQuantity += row.returnedQuantity;
      existing.approvedAwaitingReceiptQuantity += row.approvedAwaitingReceiptQuantity;
      existing.pendingRequestedQuantity += row.pendingRequestedQuantity;
      continue;
    }
    byKey.set(key, {
      distributor: row.distributor,
      style: filters.groupByStyle
        ? { id: row.saleOrderLineId, styleNumber: row.styleNumber, styleName: row.styleName }
        : undefined,
      receivedQuantity: row.receivedQuantity,
      actualSoldQuantity: row.actualSoldQuantity,
      returnedQuantity: row.returnedQuantity,
      approvedAwaitingReceiptQuantity: row.approvedAwaitingReceiptQuantity,
      pendingRequestedQuantity: row.pendingRequestedQuantity,
    });
  }

  const rows: SaleOrReturnReportRow[] = [...byKey.values()].map((accumulator) => {
    const availability = computeAvailability(accumulator);
    return {
      distributor: accumulator.distributor,
      style: accumulator.style,
      received: accumulator.receivedQuantity,
      sold: accumulator.actualSoldQuantity,
      returned: accumulator.returnedQuantity,
      approvedAwaitingReceipt: accumulator.approvedAwaitingReceiptQuantity,
      pendingRequested: accumulator.pendingRequestedQuantity,
      remainingWithDistributor: availability.remainingWithDistributor,
      availableForNewReturn: availability.availableForNewReturn,
    };
  });

  return { filtersApplied: filters, rows };
}

// ---------------------------------------------------------------------------
// RPT1 6.12 — Distributor Returns report
// ---------------------------------------------------------------------------

export async function getDistributorReturnsReport(
  user: CurrentUser,
  filters: ReportFilters & { groupBy?: 'status' | 'distributor' | 'both' },
): Promise<ReportDistributorReturns> {
  requireReportAccess(user);
  if (!canViewReportSection(user, 'saleReturn')) {
    throw HttpError.forbidden('You do not have permission to view the distributor returns report');
  }
  const groupBy = filters.groupBy ?? 'both';

  const returns = await prisma.distributorReturn.findMany({
    where: {
      distributorId: filters.distributorId,
      returnDate: filters.fromDate || filters.toDate
        ? { gte: filters.fromDate ? new Date(filters.fromDate) : undefined, lte: filters.toDate ? new Date(filters.toDate) : undefined }
        : undefined,
    },
    select: {
      id: true,
      status: true,
      distributor: { select: { id: true, code: true, name: true } },
    },
  });
  if (returns.length === 0) return { filtersApplied: filters, rows: [] };

  const lineSums = await prisma.distributorReturnLine.groupBy({
    by: ['distributorReturnId'],
    where: { distributorReturnId: { in: returns.map((r) => r.id) } },
    _sum: { requestedQuantity: true, approvedQuantity: true, receivedQuantity: true },
  });
  const sumsByReturnId = new Map(lineSums.map((row) => [row.distributorReturnId, row]));

  interface Accumulator {
    distributor?: { id: string; code: string; name: string };
    status?: string;
    requested: number;
    approvedActive: number;
    received: number;
  }
  const byKey = new Map<string, Accumulator>();
  for (const distributorReturn of returns) {
    const sums = sumsByReturnId.get(distributorReturn.id);
    const requested = sums?._sum.requestedQuantity ?? 0;
    // A return CANCELLED after approval retains its lines' approvedQuantity
    // — that stale value must never be exposed as currently-approved
    // exposure (RPT1 6.12), so it only contributes here for the two
    // statuses where it is still live: APPROVED and RECEIVED.
    const approvedActive =
      distributorReturn.status === 'APPROVED' || distributorReturn.status === 'RECEIVED'
        ? (sums?._sum.approvedQuantity ?? 0)
        : 0;
    const received = distributorReturn.status === 'RECEIVED' ? (sums?._sum.receivedQuantity ?? 0) : 0;

    const key =
      groupBy === 'status'
        ? distributorReturn.status
        : groupBy === 'distributor'
          ? distributorReturn.distributor.id
          : `${distributorReturn.distributor.id}:${distributorReturn.status}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.requested += requested;
      existing.approvedActive += approvedActive;
      existing.received += received;
      continue;
    }
    byKey.set(key, {
      distributor: groupBy === 'status' ? undefined : distributorReturn.distributor,
      status: groupBy === 'distributor' ? undefined : distributorReturn.status,
      requested,
      approvedActive,
      received,
    });
  }

  const rows: DistributorReturnReportRow[] = [...byKey.values()];
  return { filtersApplied: filters, rows };
}

// ---------------------------------------------------------------------------
// RPT2 filter-bar lookup — Season options for the reporting audience (see
// reports.routes.ts's doc comment for why this is not a widened
// GET /seasons/options).
// ---------------------------------------------------------------------------

export async function getSeasonFilterOptions(user: CurrentUser) {
  requireReportAccess(user);
  return listSeasonOptions();
}
